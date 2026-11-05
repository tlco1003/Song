/* WITHU private delivery. No demo IDs or URL tokens can grant access. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const stage=$('player-stage'),cover=$('detail-cover'),coverFallback=$('detail-cover-fallback'),
 video=$('detail-video'),audio=$('detail-audio'),play=$('detail-play'),seek=$('detail-seek');
let track=null,player=audio,coverURL=null,candidateURL=null,candidateBlob=null,hideTimer=null,playing=false,mediaReady=false;
let verifiedEmail='';
const simpleName=s=>typeof s==='string'&&/^[a-z0-9_.-]{1,110}$/i.test(s);
const safeAssetPath=s=>typeof s==='string'&&/^\/api\/delivery-assets\/[A-Za-z0-9/_-]+(?:\?[A-Za-z0-9%=&_-]+)?$/.test(s)&&new URL(s,location.origin).origin===location.origin;
function notice(text){$('detail-status').textContent=text}
function format(sec){if(!Number.isFinite(sec)||sec<0)return '0:00';const n=Math.floor(sec);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')}
function progress(){const duration=Number.isFinite(player.duration)?player.duration:Number(track?.durationSeconds)||0;const time=player.currentTime||0;$('detail-time').textContent=format(time);$('detail-duration').textContent=format(duration);seek.value=duration?Math.round(1000*time/duration):0;}
function clearHideTimer(){if(hideTimer)clearTimeout(hideTimer);hideTimer=null;}
function showControls(){stage.classList.remove('controls-hidden');clearHideTimer();if(playing)hideTimer=setTimeout(()=>stage.classList.add('controls-hidden'),2800);}
function updatePlay(){playing=!player.paused&&!player.ended;play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?'일시정지':'재생');showControls()}
async function togglePlay(){
 if(!mediaReady){notice('이메일 인증 후 구매한 노래를 선택해 주세요.');return}
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
function loadTrack(item){
 if(!verifiedEmail)throw Error('Verified customer session required');
 track={...item,id:item.id||item.orderId+'-'+item.index};
 $('detail-title').textContent=item.title||'나만의 노래';
 $('detail-genre').textContent=item.genre||'나만의 음악';
 $('detail-kind').textContent=item.mediaKind==='video'?'내 뮤직비디오 선물':'내 음원 선물';
 $('detail-private-note').textContent='결제 이메일을 인증한 구매자만 이용할 수 있는 음원입니다.';
 const isVideo=item.mediaKind==='video';
 player=isVideo?video:audio;
 audio.pause();video.pause();
 audio.removeAttribute('src');video.removeAttribute('src');
 video.hidden=!isVideo;
 if(!safeAssetPath(item.playUrl)||!safeAssetPath(item.downloadUrl))throw Error('Invalid private asset route');
 player.src=item.playUrl;
 mediaReady=true;
 $('detail-not-ready').hidden=true;
 const art=safeAssetPath(item.coverUrl)?item.coverUrl:null;
 setArt(art);
 void applyStoredCover();
 $('detail-lyrics-text').textContent=typeof item.lyrics==='string'?item.lyrics:'가사 전달을 준비하고 있어요.';
 const download=$('download-track');
 download.href=item.downloadUrl;
 download.download=simpleName(item.file)?item.file:'withu-music.mp3';
 download.hidden=false;
 if(isVideo){$('detail-art').hidden=true;video.poster=art||''}
 else $('detail-art').hidden=false;
 $('customer-content').hidden=false;
 notice('인증된 구매자의 노래입니다. 재생하거나 원본 파일을 받을 수 있어요.');
 progress();showControls();
}
async function api(url,options={}){
 const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
 if(!res.ok)throw Object.assign(new Error('request failed'),{status:res.status});
 return res.status===204?{}:res.json();
}
function authMessage(text){$('customer-auth-status').textContent=text}
function lockPortal(){
 verifiedEmail='';mediaReady=false;track=null;
 audio.pause();video.pause();audio.removeAttribute('src');video.removeAttribute('src');
 $('download-track').hidden=true;$('download-track').removeAttribute('href');
 $('customer-content').hidden=true;$('customer-portal').hidden=true;$('customer-access').hidden=false;
}
function showLibrary(orders){
 const root=$('customer-order-list');root.replaceChildren();
 for(const order of orders){
  if(!Array.isArray(order.songs)||order.status!=='delivered')continue;
  for(const song of order.songs){
   const button=document.createElement('button');button.type='button';button.className='detail-outline customer-song-button';
   button.textContent=(song.title||'나의 노래')+' · '+(song.genre||'')+' · 재생 및 다운로드';
   button.addEventListener('click',()=>void openPurchasedSong(order.id,song.index));
   root.append(button);
  }
 }
 $('customer-library-status').textContent=root.children.length?'감상할 곡을 선택해 주세요.':'아직 전달 완료된 노래가 없습니다. 제작 완료 후 결제 이메일로 안내해 드립니다.';
}
async function openPurchasedSong(orderId,index){
 if(!verifiedEmail)return;
 try{
  const number=Number(index);
  if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)||!Number.isSafeInteger(number)||number<1)throw Error('Invalid order');
  const answer=await api('api/delivery/orders/'+encodeURIComponent(orderId)+'/tracks/'+number);
  if(answer?.status!=='delivered'||!answer.track)throw Error('Not delivered');
  loadTrack({...answer.track,orderId,index:number});
 }catch(_){$('customer-content').hidden=true;notice('선택한 곡의 소유권 또는 파일 상태를 확인할 수 없습니다.')}
}
async function restoreSession(){
 try{
  const identity=await api('api/delivery/session');
  if(identity.authenticated!==true||identity.emailVerified!==true||typeof identity.email!=='string')throw Error('Not verified');
  verifiedEmail=identity.email;
  const library=await api('api/delivery/orders');
  if(!Array.isArray(library.orders))throw Error('Invalid library');
  $('customer-access').hidden=true;$('customer-portal').hidden=false;
  showLibrary(library.orders);
 }catch(error){
  lockPortal();
  if(error.status===503)authMessage('현재 안전한 고객 인증·전달 서버 연결을 준비하고 있습니다. 실제 인증 메일은 발송되지 않습니다.');
  else authMessage('결제 이메일로 인증한 후 구매한 노래를 확인할 수 있어요.');
 }
}
$('customer-email-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const email=$('customer-email').value.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return authMessage('올바른 이메일 주소를 입력해 주세요.');
 const button=event.currentTarget.querySelector('button');button.disabled=true;
 try{
  await api('api/delivery/access/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  $('customer-code-form').hidden=false;
  authMessage('이메일이 등록된 결제 정보와 일치하면 인증번호가 발송됩니다. 받은편지함을 확인해 주세요.');
 }catch(error){authMessage(error.status===503?'고객 인증 메일 서비스는 아직 연결되지 않았습니다.':'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
 finally{button.disabled=false}
});
$('customer-code-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const code=$('customer-code').value.trim(),email=$('customer-email').value.trim().toLowerCase();
 if(!/^[0-9]{6}$/.test(code))return authMessage('6자리 인증번호를 입력해 주세요.');
 const button=event.currentTarget.querySelector('button');button.disabled=true;
 try{
  await api('api/delivery/access/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,code})});
  $('customer-code').value='';
  await restoreSession();
 }catch(error){authMessage(error.status===503?'인증 서버가 아직 연결되지 않았습니다.':'인증번호가 유효하지 않거나 만료되었습니다.')}
 finally{button.disabled=false}
});
$('customer-logout').addEventListener('click',async()=>{
 try{await api('api/delivery/logout',{method:'POST'});}catch(_){}
 lockPortal();authMessage('인증이 종료되었습니다.');
});
async function init(){
 // Never interpret a demo ID, order ID, or bearer token in the URL as authorization.
 if(location.search||location.hash)history.replaceState(null,'',location.pathname);
 lockPortal();
 await restoreSession();
}
play.addEventListener('click',event=>{event.stopPropagation();void togglePlay()});
stage.addEventListener('pointermove',showControls);
stage.addEventListener('pointerdown',event=>{if(!event.target.closest('button,input'))showControls()});
stage.addEventListener('keydown',event=>{if((event.key===' '||event.key==='Enter')&&event.target===stage){event.preventDefault();void togglePlay()}});
for(const p of [audio,video]){
 p.addEventListener('play',updatePlay);p.addEventListener('pause',updatePlay);p.addEventListener('ended',updatePlay);
 p.addEventListener('timeupdate',progress);p.addEventListener('loadedmetadata',progress);
 p.addEventListener('error',()=>{if(p===player)notice('파일 재생에 실패했어요. 구매 권한과 인터넷 연결을 확인해 주세요.')});
}
seek.addEventListener('input',()=>{if(Number.isFinite(player.duration)&&player.duration>0)player.currentTime=player.duration*Number(seek.value)/1000;showControls()});
$('detail-mute').addEventListener('click',()=>{player.muted=!player.muted;$('detail-mute').textContent=player.muted?'소리 켜기':'음소거';showControls()});
$('detail-fullscreen').addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else if(stage.requestFullscreen)await stage.requestFullscreen();
  else if(player===video&&typeof video.webkitEnterFullscreen==='function')video.webkitEnterFullscreen();
  else notice('이 기기에서는 전체화면 전환을 지원하지 않을 수 있어요.');
 }catch(_){notice('전체화면 전환이 제한됐어요.')}
 showControls();
});
function showDialog(){if(!track){notice('노래를 먼저 선택해 주세요.');return}
 $('cover-message').textContent='이미지를 선택하면 바로 미리 볼 수 있어요. 변경한 커버는 이 기기에만 저장됩니다.';
 $('cover-prompt').value=(track.title||'')+' · '+(track.genre||'')+' · '+(track.coverTheme||track.subtitle||'');
 $('cover-dialog').showModal();
}
function newCandidate(blob){if(candidateURL)URL.revokeObjectURL(candidateURL);candidateBlob=blob;candidateURL=URL.createObjectURL(blob);
 $('cover-preview').src=candidateURL;$('cover-preview').hidden=false;$('cover-preview-empty').hidden=true;$('save-cover').disabled=false;}
$('cover-edit-button').addEventListener('click',showDialog);
$('close-cover-dialog').addEventListener('click',()=>$('cover-dialog').close());
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
 try{await window.WithuCovers.remove(track.id);setArt(safeAssetPath(track.coverUrl)?track.coverUrl:null);
 $('cover-dialog').close();notice('기본 커버로 되돌렸어요.')}
 catch(_){$('cover-message').textContent='기본 커버 복원에 실패했어요.'}
});
$('generate-cover').addEventListener('click',async()=>{
 const prompt=$('cover-prompt').value.trim();
 if(prompt.length<5){$('cover-message').textContent='원하는 이미지 느낌을 5자 이상 적어 주세요.';return}
 const btn=$('generate-cover');btn.disabled=true;$('cover-message').textContent='이미지 생성 서버 연결을 확인하고 있어요…';
 try{
  const res=await fetch('api/covers/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:track?.title||'',genre:track?.genre||'',prompt})});
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
  const url=saved?URL.createObjectURL(saved):safeAssetPath(track.coverUrl)?track.coverUrl:null;
  if(!url){notice('커버가 아직 게시되지 않았어요.');return}
  const a=document.createElement('a');a.href=url;a.download=(track.id||'withu')+'-cover.webp';document.body.appendChild(a);a.click();a.remove();
  if(saved)setTimeout(()=>URL.revokeObjectURL(url),3000);
 }catch(_){notice('커버를 받을 수 없어요.')}
});
window.addEventListener('pagehide',()=>{if(coverURL)URL.revokeObjectURL(coverURL);if(candidateURL)URL.revokeObjectURL(candidateURL);clearHideTimer()});
void init();
})();