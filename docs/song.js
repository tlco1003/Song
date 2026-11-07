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
let privateDeliveryToken=null,privateTrackChoices=[],privateLicense=null;
let privateShareUrl=null;
const isCustomerLibrary=document.body?.dataset.withuView==='customer';
function syncVideo(){
 if(player===video||video.hidden||!video.getAttribute('src'))return;
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
 const hasSeparateAudio=isVideo&&(
  (publicDemo&&simpleName(item.audioFile))||
  (!publicDemo&&privateAudio)
 );
 const audioPath=publicDemo&&simpleName(item.audioFile)?
  'media/'+encodeURIComponent(item.audioFile):
  (!publicDemo&&privateAudio?privateAudio.href:mediaPath);
 if(isVideo){
  video.src=mediaPath;video.playsInline=true;
  video.muted=hasSeparateAudio;video.defaultMuted=hasSeparateAudio;
  video.controls=false;video.loop=hasSeparateAudio||repeatOne;
 }
 player=hasSeparateAudio||!isVideo?audio:video;
 player.src=player===video?mediaPath:audioPath;
 // An MP4 without separate audio must stay audible, and may not continue
 // playing when the screen locks. Do not claim background audio support.
 player.loop=repeatOne;
 mediaReady=true;
 updateRepeat();updateMediaSession();
 if(isVideo&&!hasSeparateAudio)notice('영상과 소리를 함께 재생할 수 있어요. 화면 잠금 재생에는 별도 오디오 파일이 필요합니다.');
 const art=publicDemo&&coverPath(item.coverImage)?item.coverImage:null;
 setArt(art);
 void applyStoredCover();
 if(item.lyricsFile&&publicDemo&&simpleName(item.lyricsFile))void fetchLyrics('media/'+encodeURIComponent(item.lyricsFile)+'?lyricsUpdated='+Date.now());
 else if(typeof item.lyrics==='string')$('detail-lyrics-text').textContent=item.lyrics;
 else $('detail-lyrics-text').textContent='가사 공개를 준비하고 있어요.';
 // Never make a public sample or a stream URL directly downloadable from the UI.
 // The only eligible file URL comes from a verified entitlement response.
 $('download-track').hidden=true;
 $('download-track').removeAttribute('href');
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
function configurePrivateLicense(response,item){
 const panel=$('commercial-upgrade-panel');
 panel.hidden=false;
 const data=item?.commercialUpgrade||response?.commercialUpgrade||{};
 const eligible=data.status==='available'&&data.rightsVerified===true
  &&data.amountKrw===10000;
 const entitled=data.status==='active'&&data.paymentVerified===true
  &&data.rightsVerified===true;
 privateLicense=data;
 const buy=$('commercial-upgrade-buy');
 buy.disabled=!eligible;
 buy.textContent=eligible?'상업적 이용 + 음원 파일 · 10,000원 결제':'상업적 이용 옵션 준비 중';
 $('commercial-upgrade-status').textContent=entitled?
  '원본 음원 이용권 결제가 확인됐어요. 감상 링크가 유효한 동안 여러 번 다운로드할 수 있어요.':
  eligible?'선택한 곡의 권리를 확인했어요. 결제 후 이용권과 원본 음원을 제공합니다.':
  '이 음원은 상업적 이용 권리와 결제 준비가 확인되면 옵션을 구매할 수 있어요.';
 const download=$('download-track');
 download.hidden=true;download.removeAttribute('href');
 const source=item?.privateDownloadUrl;
 if(!entitled||typeof source!=='string')return;
 try{
  const url=new URL(source,location.href);
  if(url.origin!==location.origin||!/^\/api\/delivery-downloads\/[A-Za-z0-9_-]{16,180}$/.test(url.pathname))
   return;
  download.href=url.href;
  download.download='withu-commercial-'+String(item.index||1)+'.'+(String(item.file||'').split('.').at(-1)||'mp3');
  download.hidden=false;
 }catch(_){}
}
function renderPrivateTrackChoices(response){
 privateTrackChoices=Array.isArray(response?.tracks)&&response.tracks.length>0?
  response.tracks:[response.track];
 const select=$('private-track-choice');
 const list=$('private-track-list');
 select.replaceChildren();
 if(privateTrackChoices.length<=1){list.hidden=true;return;}
 for(let i=0;i<privateTrackChoices.length;i++){
  const opt=document.createElement('option');
  opt.value=String(i);
  opt.textContent=String(i+1)+'곡 · '+(privateTrackChoices[i]?.title||'나의 노래');
  select.appendChild(opt);
 }
 list.hidden=false;
}
async function loadPrivate(token=null){
 // Emailed link: /my-music.html#delivery=<random-token>. A customer who already
 // verified on this device can revisit /my-music.html with the HttpOnly session.
 // A link, query string or browser-side state is NEVER proof of payment.
 privateDeliveryToken=token;
 privateShareUrl=/^[A-Za-z0-9_-]{43}$/.test(token||'')?
  location.origin+'/gift.html#delivery='+token:null;
 $('commercial-upgrade-panel').hidden=true;
 $('private-track-list').hidden=true;
 const guest=$('my-music-guest'),customer=$('my-music-customer');
 if(isCustomerLibrary){
  customer.hidden=true;
  guest.hidden=false;
  $('my-music-guest-title').textContent='나의 노래를 확인하고 있어요.';
  $('my-music-guest-description').textContent='구매한 노래의 접근 권한을 확인하고 있어요.';
 }
 try{
  const url=token?'api/delivery/resolve':'api/delivery/library';
  const options=token?{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({token}),
   credentials:'same-origin',cache:'no-store'
  }:{
   method:'GET',credentials:'same-origin',cache:'no-store'
  };
  const r=await fetch(url,options);
  if(!r.ok)throw Error('not_authenticated');
  const j=await r.json();
  if(j?.status!=='delivered'||typeof j?.track?.file!=='string')throw Error('not_delivered');
  const t=j.track,u=new URL(t.privateMediaUrl||'',location.origin);
  if(u.origin!==location.origin||!u.pathname.startsWith('/api/delivery-assets/'))
   throw Error('invalid_asset_path');
  renderPrivateTrackChoices(j);
  for(const song of privateTrackChoices){
   if(!simpleName(song?.file)||typeof song.privateMediaUrl!=='string')
    throw Error('invalid_track');
   const asset=new URL(song.privateMediaUrl,location.origin);
   if(asset.origin!==location.origin||!asset.pathname.startsWith('/api/delivery-assets/'))
    throw Error('invalid_track_asset');
  }
  loadTrack(t,false);
  if(!mediaReady)throw Error('not_ready');
  configurePrivateLicense(j,t);
  if(!privateShareUrl){
   try{
    const shared=await fetch('/api/delivery/share-link',{
     credentials:'same-origin',cache:'no-store'
    });
    if(shared.ok){
     const result=await shared.json();
     const link=new URL(result.shareUrl,location.href);
     if(link.origin===location.origin&&link.pathname.endsWith('/gift.html')
       &&/^[A-Za-z0-9_-]{43}$/.test(new URLSearchParams(link.hash.slice(1)).get('delivery')||''))
      privateShareUrl=link.href;
    }
   }catch(_){/* Not critical to playback. */}
  }
  void loadGiftComments();
  if(j.testOnly===true){
   $('detail-private-note').textContent='[로컬 시연] 이 노래는 실제 결제 상품이 아닌 시험 주문의 음원입니다.';
   if(j.commercialUpgrade?.status==='active')
    $('commercial-upgrade-status').textContent='[시연용] 관리자 모의 10,000원 결제 상태입니다. 실제 상업적 이용권이 부여된 것은 아닙니다.';
  }
  const select=$('private-track-choice');
  select.onchange=()=>{
   const index=Number(select.value);
   if(!Number.isSafeInteger(index)||index<0||index>=privateTrackChoices.length)return;
   loadTrack(privateTrackChoices[index],false);
   configurePrivateLicense(j,privateTrackChoices[index]);
  };
  if(isCustomerLibrary){
   guest.hidden=true;
   customer.hidden=false;
  }
  // Keep the email access code out of visible navigation/history after resolve.
  if(token&&location.hash.startsWith('#delivery='))
   history.replaceState(null,'',location.pathname+location.search);
 }catch(_){
  audio.pause();video.pause();
  audio.removeAttribute('src');video.removeAttribute('src');
  track=null;mediaReady=false;isPrivate=false;
  privateLicense=null;privateTrackChoices=[];privateShareUrl=null;
  $('download-track').hidden=true;
  $('download-track').removeAttribute('href');
  $('commercial-upgrade-panel').hidden=true;
  $('private-track-list').hidden=true;
  if(isCustomerLibrary){
   customer.hidden=true;guest.hidden=false;
   $('my-music-guest-title').textContent='아직 표시할 나의 노래가 없어요.';
   $('my-music-guest-description').textContent=
    '구매한 곡은 이메일로 받은 고객 전용 감상 링크에서 확인할 수 있어요. 이 기기에서 인증되지 않았거나 링크가 만료되었다면, 해당 이메일 링크를 다시 열어 주세요.';
  }else{
   $('detail-title').textContent='음악 선물 전달 준비 중';
   $('detail-kind').textContent='고객 전용 전달 페이지';
   $('detail-genre').textContent='인증된 전달 링크가 필요해요';
   $('detail-not-ready').hidden=false;
   $('detail-lyrics-text').textContent=
    '결제 후 제작이 완료되면 이메일로 받은 전용 링크에서 감상할 수 있어요.';
   notice('현재 고객 인증·이메일·음원 전달 서버는 아직 연결되지 않았습니다.');
  }
 }
}
$('commercial-upgrade-buy').addEventListener('click',async()=>{
 const button=$('commercial-upgrade-buy');
 if(button.disabled||privateLicense?.status!=='available'
   ||privateLicense?.rightsVerified!==true||privateLicense?.amountKrw!==10000)return;
 button.disabled=true;
 $('commercial-upgrade-status').textContent='안전한 추가 결제 연결을 확인하는 중이에요.';
 try{
  const response=await fetch('api/commerce/commercial-upgrade/checkout',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(privateDeliveryToken?
    {deliveryToken:privateDeliveryToken}:{orderRef:track?.orderRef})
  });
  if(!response.ok)throw Error('payment-unavailable');
  const data=await response.json();
  if(data?.status!=='checkout_ready'||data.amountKrw!==10000
    ||typeof data.checkoutUrl!=='string')throw Error('bad-checkout');
  const url=new URL(data.checkoutUrl,location.href);
  // Payment authorization must begin at a protected same-origin callback.
  if(url.origin!==location.origin||!url.pathname.startsWith('/commercial-upgrade/'))
   throw Error('external-checkout');
  location.assign(url.href);
 }catch(_){
  button.disabled=false;
  $('commercial-upgrade-status').textContent='상업적 이용권 결제는 현재 준비 중입니다. 별도 요금은 청구되지 않았어요.';
 }
});
async function init(){
 const params=new URLSearchParams(location.search);
 const delivered=new URLSearchParams(location.hash.slice(1)).get('delivery');
 if(isCustomerLibrary){
  // A public demo query never turns an unauthenticated library into a demo.
  if(delivered&&!/^[A-Za-z0-9_-]{43}$/.test(delivered)){
   $('my-music-guest-title').textContent='감상 링크를 확인해 주세요.';
   $('my-music-guest-description').textContent='유효한 이메일 전용 감상 링크로 다시 접속해 주세요.';
   return;
  }
  await loadPrivate(delivered||null);
  return;
 }
 if(delivered){
  if(!/^[A-Za-z0-9_-]{43}$/.test(delivered)){
   notice('유효하지 않은 전달 링크예요.');return;
  }
  await loadPrivate(delivered);return;
 }
 const requested=params.get('demo')||'song-mother';
 if(!/^song-[a-z0-9-]{1,90}$/.test(requested)){
  notice('잘못된 예시곡 주소예요.');return;
 }
 await loadDemo(requested);
}
play.addEventListener('click',event=>{event.stopPropagation();void togglePlay()});
stage.addEventListener('pointermove',showControls);
stage.addEventListener('pointerdown',event=>{if(!event.target.closest('button,input'))showControls()});
stage.addEventListener('keydown',event=>{if((event.key===' '||event.key==='Enter')&&event.target===stage){event.preventDefault();void togglePlay()}});
for(const p of [audio,video]){
 p.addEventListener('play',()=>{if(p===player)updatePlay()});
 p.addEventListener('pause',()=>{if(p===player)updatePlay()});
 p.addEventListener('ended',()=>{if(p===player)updatePlay()});
 p.addEventListener('timeupdate',()=>{if(p===player){progress();syncVideo()}});
 p.addEventListener('loadedmetadata',()=>{if(p===player)progress()});
 p.addEventListener('seeking',()=>{if(p===player)syncVideo()});
}
audio.addEventListener('error',()=>{
 if(player!==audio)return;
 if(!isPrivate&&track?.mediaKind==='video'&&video.getAttribute('src')){
  // Unsupported MP4 inside audio: recover with its original audible video.
  player=video;video.muted=false;video.defaultMuted=false;video.loop=repeatOne;
  updateRepeat();updatePlay();
  notice('별도 음원을 재생할 수 없어 MP4 영상으로 전환했어요.');
  return;
 }
 notice('오디오 재생에 실패했어요. 음원 파일을 확인해 주세요.');
});
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
function sharingLink(){
 if(isPrivate)return privateShareUrl;
 return location.origin+location.pathname+'?demo='+encodeURIComponent(track?.id||'song-mother');
}
async function shareSong({preferCopy=false,platform=''}={}){
 const link=sharingLink();
 if(!link){notice('공유 링크를 확인하는 중이에요. 다시 열어 주세요.');return;}
 try{
  if(preferCopy){
   if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
   await navigator.clipboard.writeText(link);
  }else if(navigator.share){
   await navigator.share({
    title:(track?.title||'WITHU')+' · 음악 선물',
    text:'소중한 이야기가 담긴 노래를 함께 들어주세요.',
    url:link
   });
  }else if(navigator.clipboard?.writeText){
   await navigator.clipboard.writeText(link);
  }else throw Error('Share unavailable');
  notice(platform?
   platform+'에 게시물을 자동 올린 것은 아니에요. 앱에서 공유 대상을 선택하거나 복사한 링크를 붙여넣어 주세요.':
   '이 노래의 무료 공유 링크를 준비했어요.');
 }catch(error){
  if(error?.name!=='AbortError')
   notice('공유를 열 수 없어요. 브라우저의 주소 복사를 이용해 주세요.');
 }
}
$('share-button').addEventListener('click',()=>{void shareSong()});
for(const [id,action] of [
 ['gift-share-native',{}],
 ['gift-share-copy',{preferCopy:true}],
 ['gift-share-instagram',{platform:'인스타그램'}],
 ['gift-share-tiktok',{platform:'틱톡'}]
]){
 const button=$(id);
 if(button)button.addEventListener('click',()=>{void shareSong(action)});
}
async function loadGiftComments(){
 const pane=$('gift-comments-list');
 if(!pane)return;
 pane.replaceChildren();
 try{
  const response=await fetch('/api/gift/comments',{
   credentials:'same-origin',cache:'no-store'
  });
  if(!response.ok)throw Error('not_live');
  const result=await response.json();
  const comments=Array.isArray(result.comments)?result.comments:[];
  if(!comments.length){
   const message=document.createElement('p');
   message.textContent='아직 등록된 댓글이 없어요. 첫 마음을 남겨 보세요.';
   pane.appendChild(message);return;
  }
  for(const item of comments){
   const row=document.createElement('article');row.className='gift-comment';
   const name=document.createElement('strong');
   name.textContent=String(item.nickname||'익명').slice(0,24);
   const content=document.createElement('p');
   content.textContent=String(item.text||'').slice(0,300);
   row.append(name,content);pane.appendChild(row);
  }
 }catch(_){
  const fallback=document.createElement('p');
  fallback.textContent='댓글을 불러올 수 없어요. 운영 서버 연결을 확인해 주세요.';
  pane.appendChild(fallback);
 }
}
const guestCommentForm=$('gift-comment-form');
if(guestCommentForm)guestCommentForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const button=$('gift-comment-submit');
 const message=$('gift-comment-status');
 if(button.disabled)return;
 button.disabled=true;
 try{
  const nickname=$('gift-comment-nickname').value.trim();
  const text=$('gift-comment-text').value.trim();
  const response=await fetch('/api/gift/comments',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({nickname,text,publicConsent:$('gift-comment-consent').checked})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'댓글을 등록하지 못했어요.');
  message.textContent='댓글이 접수됐어요. 관리자 확인 후 이 노래에 표시됩니다.';
  $('gift-comment-text').value='';
  $('gift-comment-consent').checked=false;
  void loadGiftComments();
 }catch(error){message.textContent=error.message;}
 finally{button.disabled=false;}
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
window.addEventListener('pagehide',()=>{if(coverURL)URL.revokeObjectURL(coverURL);if(candidateURL)URL.revokeObjectURL(candidateURL);clearHideTimer()});
updateRepeat();void init();
})();