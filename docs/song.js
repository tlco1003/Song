/* WITHU music-letter player.
 * Public demo samples are selected only from the checked-in manifest.
 * Delivery tokens never grant access to public demo assets or another order.
 * Private deliveries will require a validated server implementation.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const stage=$('player-stage'),cover=$('detail-cover'),coverFallback=$('detail-cover-fallback'),
 video=$('detail-video'),audio=$('detail-audio'),play=$('detail-play'),seek=$('detail-seek');
let track=null,player=audio,coverURL=null,candidateURL=null,candidateBlob=null,hideTimer=null,playing=false,mediaReady=false;
let isPrivate=false,repeatOne=false;
function syncVideo(){
 if(video.hidden||!video.getAttribute('src'))return;
 if(document.visibilityState==='hidden'||player.paused||player.ended){
  if(!video.paused)video.pause();
  return;
 }
 if(video.readyState>=1 && Math.abs(video.currentTime-player.currentTime)>0.65){
  try{video.currentTime=player.currentTime}catch(_){}
 }
 if(video.paused)void video.play().catch(()=>{/* Audio continues independently. */});
}
function updateRepeat(){
 player.loop=repeatOne;
 const button=$('detail-repeat');
 button.textContent=repeatOne?'한 곡 반복':'반복 끔';
 button.setAttribute('aria-label',repeatOne?'한 곡 반복 끄기':'한 곡 반복 켜기');
 button.setAttribute('aria-pressed',String(repeatOne));
}
function updateMediaSession(){
 if(!('mediaSession' in navigator)||!track)return;
 try{
  const art=coverPath(track.coverImage)?new URL(track.coverImage,location.href).href:null;
  navigator.mediaSession.metadata=new MediaMetadata({
   title:track.title||'WITHU',artist:'WITHU',album:'WITHU Music Letters',
   artwork:art?[{src:art,type:'image/webp',sizes:'512x512'}]:[]
  });
  navigator.mediaSession.playbackState=player.paused?'paused':'playing';
 }catch(_){}
}
if('mediaSession' in navigator){
 for(const [action,handler] of Object.entries({
  play:()=>void player.play().catch(()=>{}),
  pause:()=>player.pause(),
  seekto:details=>{
   if(Number.isFinite(details.seekTime)&&Number.isFinite(player.duration))
    player.currentTime=Math.max(0,Math.min(details.seekTime,player.duration));
  }
 })){
  try{navigator.mediaSession.setActionHandler(action,handler)}catch(_){}
 }
}
const simpleName=s=>typeof s==='string'&&/^[a-z0-9_.-]{1,110}$/i.test(s);
const coverPath=s=>typeof s==='string'&&/^covers\/[a-z0-9-]+\.webp$/i.test(s);
function notice(text){$('detail-status').textContent=text}
function format(sec){if(!Number.isFinite(sec)||sec<0)return '0:00';const n=Math.floor(sec);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')}
function progress(){const duration=Number.isFinite(player.duration)?player.duration:Number(track?.durationSeconds)||0;const time=player.currentTime||0;$('detail-time').textContent=format(time);$('detail-duration').textContent=format(duration);seek.value=duration?Math.round(1000*time/duration):0;}
function clearHideTimer(){if(hideTimer)clearTimeout(hideTimer);hideTimer=null;}
function showControls(){stage.classList.remove('controls-hidden');clearHideTimer();if(playing)hideTimer=setTimeout(()=>stage.classList.add('controls-hidden'),2800);}
function updatePlay(){playing=!player.paused&&!player.ended;play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?'일시정지':'재생');showControls();updateMediaSession();syncVideo()}
async function togglePlay(){
 if(!mediaReady){notice('재생할 파일이 없습니다. 공개 예시를 선택하거나 전달 링크를 확인해 주세요.');return}
 try{if(player.paused)await player.play();else player.pause()}catch(_){notice('재생을 시작할 수 없어요. 다시 눌러 주세요.')}
 updatePlay();
}
function setArt(url){
 cover.hidden=true;coverFallback.hidden=false;
 if(!url){cover.removeAttribute('src');return}
 cover.onload=()=>{cover.hidden=false;coverFallback.hidden=true};
 cover.onerror=()=>{cover.hidden=true;coverFallback.hidden=false};
 cover.src=url;
}
async function applyStoredCover(){
 if(!track||!window.WithuCovers)return;
 try{const blob=await window.WithuCovers.get(track.id);
 if(blob){if(coverURL)URL.revokeObjectURL(coverURL);coverURL=URL.createObjectURL(blob);setArt(coverURL);}
 }catch(_){}
}
async function fetchLyrics(url){
 if(!url)return;
 try{
  const resp=await fetch(url,{cache:'no-store'});if(!resp.ok)throw Error('failed');
  const text=await resp.text();
  const pure=text.replace(/\r\n?/g,'\n').split('\n').filter(s=>!!s.trim()&&!/^\[.*\]\s*$/.test(s.trim())&&!/^(?:버전\s*\d+|반복|브릿지)\s*$/i.test(s.trim())).join('\n');
  $('detail-lyrics-text').textContent=pure||'가사가 등록되지 않았습니다.';
 }catch(_){$('detail-lyrics-text').textContent='가사를 불러오지 못했어요.'}
}
function loadTrack(item,publicDemo){
 track=item;isPrivate=!publicDemo;
 $('detail-title').textContent=item.title||'나만의 노래';
 $('detail-genre').textContent=item.genre||'나만의 음악';
 $('detail-kind').textContent=publicDemo?'WITHU 공개 예시곡':item.productType==='audio_video'?'나의 뮤직비디오 선물':'나의 음원 선물';
 $('detail-private-note').textContent=publicDemo?'공개된 WITHU 예시 작품입니다. 커버 수정은 내 기기에만 저장돼요.':'이 선물은 확인된 수령자만 감상할 수 있습니다.';
 const isVideo=item.mediaKind==='video'||(item.productType==='audio_video'&&!!item.videoFile);
 // Sound always comes from an audio element: lock-screen playback must never
 // depend on continued video rendering.
 audio.pause();video.pause();
 player=audio;video.hidden=!isVideo;
 if(!isVideo){video.removeAttribute('src');video.load();}
 if(!simpleName(item.file)){mediaReady=false;notice('음원 파일 정보가 올바르지 않습니다.');return}
 const mediaPath=publicDemo?'media/'+encodeURIComponent(item.file):item.privateMediaUrl;
 // Never trust media URL text supplied by public query parameters. A private URL
 // must originate from the authenticated delivery API and be same-origin.
 if(!publicDemo && (!mediaPath||new URL(mediaPath,location.href).origin!==location.origin)){
  mediaReady=false;notice('개인 음원 인증이 필요합니다.');return;
 }
 const privateAudio=item.privateAudioUrl?new URL(item.privateAudioUrl,location.href):null;
 if(!publicDemo && privateAudio &&
   (privateAudio.origin!==location.origin||!privateAudio.pathname.startsWith('/api/delivery-assets/'))){
  mediaReady=false;notice('오디오 파일 접근 권한을 확인할 수 없어요.');return;
 }
 const audioPath=publicDemo&&simpleName(item.audioFile)?
  'media/'+encodeURIComponent(item.audioFile):
  (!publicDemo&&privateAudio?privateAudio.href:mediaPath);
 if(isVideo){
  video.muted=true;video.defaultMuted=true;video.controls=false;video.loop=true;video.playsInline=true;
  video.src=mediaPath;
 }
 player.src=audioPath;player.loop=repeatOne;mediaReady=true;
 updateRepeat();updateMediaSession();
 const art=publicDemo&&coverPath(item.coverImage)?item.coverImage:null;
 setArt(art);
 void applyStoredCover();
 if(item.lyricsFile&&publicDemo&&simpleName(item.lyricsFile))void fetchLyrics('media/'+encodeURIComponent(item.lyricsFile));
 else if(typeof item.lyrics==='string')$('detail-lyrics-text').textContent=item.lyrics;
 else $('detail-lyrics-text').textContent='가사 공개를 준비하고 있어요.';
 // Download is only permitted for the public sample file; authenticated deliveries
 // will need an expiring, server-minted download ticket.
 const download=$('download-track');
 if(publicDemo){download.href=mediaPath;download.download=item.file;download.hidden=false;}
 else download.hidden=true;
 if(isVideo){$('detail-art').hidden=true;video.poster=art||'';}
 else $('detail-art').hidden=false;
 progress();showControls();
}
async function loadDemo(id){
 try{
  const res=await fetch('media/tracks.json',{cache:'no-store'});if(!res.ok)throw Error('playlist');
  const catalog=await res.json(),item=catalog.tracks?.find(t=>t.id===id);
  if(!item||!simpleName(item.file))throw Error('unknown track');
  loadTrack(item,true);
 }catch(_){
  $('detail-title').textContent='노래를 찾을 수 없어요';
  $('detail-lyrics-text').textContent='홈페이지의 다른 노래를 선택해 주세요.';
  $('detail-not-ready').hidden=false;
  notice('공개된 곡 목록에서 선택해 주세요.');
 }
}
async function loadPrivate(token){
 // No paid customer content is bundled into public GitHub Pages.
 // The endpoint will be provided only on an authenticated HTTPS backend.
 try{
  const r=await fetch('api/delivery/'+encodeURIComponent(token),{credentials:'same-origin',cache:'no-store'});
  if(!r.ok)throw Error('unavailable');
  const j=await r.json();
  if(j?.status!=='delivered'||typeof j?.track?.file!=='string')throw Error('not delivered');
  // Private media must be supplied only via server-generated signed URL.
  const t=j.track,u=new URL(t.privateMediaUrl||'',location.origin);
  if(u.origin!==location.origin||!u.pathname.startsWith('/api/delivery-assets/'))throw Error('invalid asset path');
  loadTrack(t,false);
 }catch(_){
  $('detail-title').textContent='음악 선물 전달 준비 중';
  $('detail-kind').textContent='고객 전용 전달 페이지';
  $('detail-genre').textContent='인증된 배송 링크가 필요해요';
  $('detail-not-ready').hidden=false;
  $('detail-lyrics-text').textContent='결제 완료 후 인증된 전용 링크로 노래와 커버를 받을 수 있도록 준비 중입니다.';
  notice('현재 고객 인증·파일 전달 서버는 아직 연결되지 않았습니다. 공개 예시만 감상할 수 있습니다.');
 }
}
async function init(){
 const params=new URLSearchParams(location.search);
 const delivered=new URLSearchParams(location.hash.slice(1)).get('delivery');
 if(delivered){
  if(!/^[A-Za-z0-9_-]{24,160}$/.test(delivered)){notice('유효하지 않은 배송 링크예요.');return;}
  await loadPrivate(delivered);return;
 }
 const requested=params.get('demo')||'song-mother';
 if(!/^song-[a-z0-9-]{1,90}$/.test(requested)){notice('잘못된 예시곡 주소예요.');return;}
 await loadDemo(requested);
}
play.addEventListener('click',event=>{event.stopPropagation();void togglePlay()});
stage.addEventListener('pointermove',showControls);
stage.addEventListener('pointerdown',event=>{if(!event.target.closest('button,input'))showControls()});
stage.addEventListener('keydown',event=>{if((event.key===' '||event.key==='Enter')&&event.target===stage){event.preventDefault();void togglePlay()}});
audio.addEventListener('play',updatePlay);
audio.addEventListener('pause',updatePlay);
audio.addEventListener('ended',updatePlay);
audio.addEventListener('timeupdate',()=>{progress();syncVideo()});
audio.addEventListener('loadedmetadata',progress);
audio.addEventListener('seeking',syncVideo);
audio.addEventListener('error',()=>notice('오디오 재생에 실패했어요. MP4에 소리가 있는지 또는 별도 MP3가 있는지 확인해 주세요.'));
video.addEventListener('loadedmetadata',syncVideo);
video.addEventListener('error',()=>{if(!video.hidden)notice('영상 화면에 오류가 있어요. 오디오 재생은 계속 이용할 수 있어요.')});
document.addEventListener('visibilitychange',syncVideo);
$('detail-repeat').addEventListener('click',()=>{repeatOne=!repeatOne;updateRepeat()});
seek.addEventListener('input',()=>{if(Number.isFinite(player.duration)&&player.duration>0)player.currentTime=player.duration*Number(seek.value)/1000;showControls()});
$('detail-mute').addEventListener('click',()=>{player.muted=!player.muted;$('detail-mute').textContent=player.muted?'소리 켜기':'음소거';showControls()});
$('detail-fullscreen').addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else if(stage.requestFullscreen)await stage.requestFullscreen();
  else if(!video.hidden&&typeof video.webkitEnterFullscreen==='function')video.webkitEnterFullscreen();
  else notice('이 기기에서는 전체화면 전환을 지원하지 않을 수 있어요.');
 }catch(_){notice('전체화면 전환이 제한됐어요.')}
 showControls();
});
$('share-button').addEventListener('click',async()=>{
 if(isPrivate){notice('고객 전용 링크는 공유할 수 없어요.');return}
 const link=location.origin+location.pathname+'?demo='+encodeURIComponent(track?.id||'song-mother');
 try{if(navigator.share)await navigator.share({title:track?.title||'WITHU',url:link});
 else await navigator.clipboard.writeText(link)}
 catch(_){notice('공유가 취소되었거나 사용할 수 없습니다.');return}
 notice('공개 감상 링크를 공유했어요.');
});
function showDialog(){if(!track){notice('노래를 먼저 선택해 주세요.');return}
 $('cover-message').textContent='이미지를 선택하면 바로 미리 볼 수 있어요. 변경한 커버는 이 기기에만 저장됩니다.';
 $('cover-prompt').value=(track.title||'')+' · '+(track.genre||'')+' · '+(track.coverTheme||track.subtitle||'');
 $('cover-dialog').showModal();
}
function newCandidate(blob){if(candidateURL)URL.revokeObjectURL(candidateURL);candidateBlob=blob;candidateURL=URL.createObjectURL(blob);
 $('cover-preview').src=candidateURL;$('cover-preview').hidden=false;$('cover-preview-empty').hidden=true;$('save-cover').disabled=false;}
$('cover-edit-button').addEventListener('click',showDialog);
$('close-cover-dialog').addEventListener('click',()=>{$('cover-dialog').close()});
$('cover-file').addEventListener('change',e=>{
 const f=e.target.files?.[0];if(!f)return;
 if(!['image/webp','image/jpeg','image/png'].includes(f.type)||f.size>10*1024*1024){$('cover-message').textContent='JPG·PNG·WebP 10MB 이하 파일을 선택해 주세요.';return}
 newCandidate(f);$('cover-message').textContent='새 이미지가 선택됐어요. 저장하면 이 기기의 커버가 바뀝니다.';
 e.target.value='';
});
$('save-cover').addEventListener('click',async()=>{
 if(!track||!candidateBlob)return;
 try{
  await window.WithuCovers.put(track.id,candidateBlob);
  const stored=await window.WithuCovers.get(track.id);
  if(coverURL)URL.revokeObjectURL(coverURL);
  coverURL=URL.createObjectURL(stored);cover.src=coverURL;cover.hidden=false;coverFallback.hidden=true;
  $('cover-dialog').close();notice('새 커버가 이 기기에 저장됐어요. 다른 방문자에게 공개되지는 않아요.');
 }catch(e){$('cover-message').textContent=e.message||'저장에 실패했어요.'}
});
$('reset-cover').addEventListener('click',async()=>{
 if(!track)return;
 try{await window.WithuCovers.remove(track.id);setArt(coverPath(track.coverImage)?track.coverImage:null);
 $('cover-dialog').close();notice('기본 커버로 되돌렸어요.')}
 catch(_){$('cover-message').textContent='기본 커버 복원에 실패했어요.'}
});
$('generate-cover').addEventListener('click',async()=>{
 const prompt=$('cover-prompt').value.trim();
 if(prompt.length<5){$('cover-message').textContent='원하는 이미지 느낌을 5자 이상 적어 주세요.';return}
 const btn=$('generate-cover');btn.disabled=true;$('cover-message').textContent='이미지 생성 서버 연결을 확인하고 있어요…';
 try{

  const headers={'Content-Type':'application/json'};

  const res=await fetch('api/covers/generate',{method:'POST',headers,body:JSON.stringify({title:track?.title||'',genre:track?.genre||'',prompt})});
  if(!res.ok)throw Error(res.status===404||res.status===503?'AI 이미지 생성 서버가 아직 연결되지 않았어요.':'이미지 생성 인증이 필요하거나 요청을 처리할 수 없어요.');
  const d=await res.json();if(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(d.image||''))throw Error('이미지 응답을 확인할 수 없어요.');
  const f=await (await fetch(d.image)).blob();newCandidate(f);$('cover-message').textContent='이미지를 생성했어요. 마음에 들면 이 이미지를 사용해 주세요.';
 }catch(e){$('cover-message').textContent=e.message}
 finally{btn.disabled=false}
});
$('download-cover').addEventListener('click',async()=>{
 if(!track)return;
 try{
  const saved=await window.WithuCovers.get(track.id);
  const url=saved?URL.createObjectURL(saved):coverPath(track.coverImage)?track.coverImage:null;
  if(!url){notice('커버가 아직 게시되지 않았어요.');return}
  const a=document.createElement('a');a.href=url;a.download=(track.id||'withu')+'-cover.webp';document.body.appendChild(a);a.click();a.remove();
  if(saved)setTimeout(()=>URL.revokeObjectURL(url),3000);
 }catch(_){notice('커버를 받을 수 없어요.')}
});
window.addEventListener('pagehide',()=>{if(coverURL)URL.revokeObjectURL(coverURL);if(candidateURL)URL.revokeObjectURL(candidateURL);clearHideTimer()});
updateRepeat();void init();
})();