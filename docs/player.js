/* WITHU public music letters. Line sync requires real timestamps. */
import {filterLyricLines,parseLyricDocument,cueIndexAt} from './lyric-timing.mjs';
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const audio=$('music-audio'),videoPlayer=$('music-video');
const musicVisual=$('music-visual'),musicVisualStage=$('music-visual-stage'),albumArt=$('album-art');
let tracks=[],current=0,requestId=0,rawLyrics='',visibleLyrics=[],activeLine=-1,lyricCueSeconds=null;
let repeatMode='off';
const featuredAudio=$('mother-featured-audio'),featuredVideo=$('mother-featured-video');
let mediaSessionAudio=audio;
const deviceAudio=[],deviceVideo=[];
const fileOK=s=>typeof s==='string'&&/^[a-zA-Z0-9가-힣_.-]{1,110}$/.test(s);
const fileURL=(root,s)=>root+encodeURIComponent(s);
const coverOK=s=>typeof s==='string'&&/^covers\/[a-z0-9-]+\.webp$/i.test(s);
const coversById={'song-mother':'mother-thanks.webp','song-cinderella-laundry':'cinderella-laundry.webp','song-nara':'self-lantern.webp','song-taehwan':'taehwan-main.webp','song-jeongmi':'friend-memory.webp','song-romantic-wedding':'romantic-wedding.webp','song-sprout':'sprout.webp','song-am630':'am630.webp'};
const coverFor=t=>coverOK(t.coverImage)?t.coverImage:(coversById[t.id]?'covers/'+coversById[t.id]:null);
const shortName=s=>s.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,95);
const fallback=[
 {id:'song-mother',title:'엄마에게 전하는 노래',genre:'감성 발라드',subtitle:'사랑과 감사를 담은 영상 편지',file:'mother-song.mp4',mediaKind:'video',durationSeconds:436.8,lyricsFile:'lyrics-mother-song.txt'},
 {id:'song-papa',title:'아빠의 계절',genre:'어쿠스틱 감성 발라드',subtitle:'아빠에게 전하는 사랑과 위로',file:'Papa.mp4',mediaKind:'video',lyricsFile:'lyrics-papa.txt'},
 {id:'song-cinderella-laundry',title:'세탁소의 신데렐라',genre:'뮤지컬 팝 · 재즈 스윙',subtitle:'동전 하나만 더!',file:'cinderella-laundry.mp3',visualFile:'cinderella-laundry-loop.mp4',visualMode:'silent-loop',durationSeconds:221.64,lyricsFile:'lyrics-cinderella-laundry.txt'},
 {id:'song-nara',title:'나라는 사람',genre:'어쿠스틱 팝',subtitle:'삶과 사랑을 돌아보는 노래',file:'nara.mp3',lyricsFile:'lyrics-nara.txt',durationSeconds:257.544},
 {id:'song-taehwan',title:'구태환에게',genre:'로맨틱 발라드',subtitle:'연인에게 보내는 편지 같은 노래',file:'taehwan.mp3',lyricsFile:'lyrics-taehwan.txt',durationSeconds:320.04},
 {id:'song-jeongmi',title:'내사랑김정미',genre:'감성 발라드',subtitle:'소중한 친구에게 전하는 노래',file:'jeongmi-new.mp3',lyricsFile:'lyrics-jeongmi.txt',durationSeconds:350.04},
 {id:'song-romantic-wedding',title:'로맨틱 웨딩',genre:'웨딩 발라드 · 듀엣',subtitle:'특별한 결혼식날 서로의 약속을 담은 듀엣곡',file:'romantic-wedding.mp3',lyricsFile:'lyrics-wedding.txt'},
 {id:'song-sprout',title:'씨앗을심어',genre:'희망 팝 발라드',subtitle:'작은 희망을 심고 다시 일어서는 이야기',file:'sprout.mp3',lyricsFile:'lyrics-sprout.txt',durationSeconds:274.944},
 {id:'song-am630',title:'새벽여섯시반',genre:'새벽 감성 발라드',subtitle:'비 내리는 새벽, 다시 시작하는 마음',file:'am630.mp3',lyricsFile:'lyrics-am630.txt',durationSeconds:428.04}
];
async function readText(url){
 const result=await fetch(url,{cache:'no-store'});
 if(!result.ok)throw Error('file not available');
 return result.text();
}
async function available(url){
 // HEAD may be blocked or temporarily unavailable on some CDNs.
 // Only a confirmed missing or implausibly short file is treated as missing.
 try{
  const result=await fetch(url,{method:'HEAD',cache:'no-store'});
  const header=result.headers.get('content-length');
  const bytes=header===null?NaN:Number(header);
  if(result.ok)return Number.isFinite(bytes)&&bytes>0&&bytes<=1024?'missing':'ready';
  if(result.status===404||result.status===410)return 'missing';
 }catch(_){}
 return 'unchecked';
}
function status(text){$('playback-message').textContent=text}
function syncSilentVideo(visual,sound){
 if(visual.hidden||!visual.getAttribute('src'))return;
 if(document.visibilityState==='hidden'||sound.paused||sound.ended){
  if(!visual.paused)visual.pause();
  return;
 }
 if(visual.readyState>=1 && Number.isFinite(sound.currentTime) &&
   Math.abs(visual.currentTime-sound.currentTime)>0.65){
  try{visual.currentTime=sound.currentTime}catch(_){}
 }
 if(visual.paused)void visual.play().catch(()=>{/* Sound is independent. */});
}
function setMediaSession(track,sound){
 mediaSessionAudio=sound;
 if(!('mediaSession' in navigator))return;
 try{
  const coverPath=coverFor(track);
  navigator.mediaSession.metadata=new MediaMetadata({
   title:track.title||'WITHU',artist:'WITHU',album:'WITHU Music Letters',
   artwork:coverPath?[{src:new URL(coverPath,location.href).href,sizes:'512x512',type:'image/webp'}]:[]
  });
  navigator.mediaSession.playbackState=sound.paused?'paused':'playing';
 }catch(_){}
}
if('mediaSession' in navigator){
 const actions={
  play:()=>void mediaSessionAudio.play().catch(()=>{}),
  pause:()=>mediaSessionAudio.pause(),
  nexttrack:()=>void select(current+1,true),
  previoustrack:()=>void select(current-1,true),
  seekto:details=>{
   if(Number.isFinite(details.seekTime)&&Number.isFinite(mediaSessionAudio.duration))
    mediaSessionAudio.currentTime=Math.max(0,Math.min(details.seekTime,mediaSessionAudio.duration));
  }
 };
 for(const [action,handler] of Object.entries(actions)){
  try{navigator.mediaSession.setActionHandler(action,handler)}catch(_){}
 }
}
function updateRepeat(){
 const button=$('repeat-mode');
 const names={off:'반복 끔',one:'한 곡 반복',all:'전체 반복'};
 button.textContent=names[repeatMode];
 button.setAttribute('aria-label',names[repeatMode]);
 button.setAttribute('aria-pressed',String(repeatMode!=='off'));
 audio.loop=repeatMode==='one';
 featuredAudio.loop=repeatMode!=='off';
}
$('repeat-mode').addEventListener('click',()=>{
 repeatMode=repeatMode==='off'?'one':repeatMode==='one'?'all':'off';
 updateRepeat();
});
function setActiveLine(index,force=false){
 if(!visibleLyrics.length)return;
 const next=index<0?-1:Math.max(0,Math.min(visibleLyrics.length-1,index));
 if(next===activeLine&&!force)return;
 const root=$('lyrics-content'),view=$('lyrics-scroll'),children=root.children;
 if(!children.length)return;
 if(activeLine>=0&&children[activeLine])children[activeLine].classList.remove('is-active');
 activeLine=next;
 if(next<0){view.scrollTop=0;return}
 const el=children[activeLine];
 el.classList.add('is-active');
 // Keep the active lyric centered inside a 3-line viewport.
 const top=Math.max(0,el.offsetTop-root.offsetTop-(view.clientHeight-el.clientHeight)/2);
 if(typeof view.scrollTo==='function')view.scrollTo({top,behavior:force?'auto':'smooth'});
 else view.scrollTop=top;
}
function drawLyrics(text){
 const root=$('lyrics-content');root.replaceChildren();
 const parsed=parseLyricDocument(text);
 visibleLyrics=parsed.lines;lyricCueSeconds=parsed.cues;activeLine=-1;
 const hint=$('lyrics-sync-hint');
 if(!visibleLyrics.length){
  root.textContent='표시할 가사가 아직 등록되지 않았어요.';
  if(hint)hint.textContent='';
  return;
 }
 for(const line of visibleLyrics){
  const p=document.createElement('p');p.className='lyric-line';p.textContent=line;root.appendChild(p);
 }
 if(hint)hint.textContent=lyricCueSeconds?'실제 구절 시작 시각에 맞춰 가사가 이동해요.':'가사 시간 정보가 없어 자동 이동하지 않아요. 위아래로 스크롤해 보세요.';
 if(lyricCueSeconds)advanceLyrics();
}
function advanceLyrics(){
 // Audio is the master clock for both MP3 and MP4 songs.
 if(!lyricCueSeconds||!visibleLyrics.length||audio.hidden)return;
 setActiveLine(cueIndexAt(lyricCueSeconds,audio.currentTime));
}
function showPlayer(kind){
 audio.hidden=kind==='none';
 videoPlayer.hidden=kind!=='video';
 $('no-audio').hidden=kind!=='none';
}
async function select(index,autoPlay=false){
 if(!tracks.length)return;
 current=(index+tracks.length)%tracks.length;
 const track=tracks[current],token=++requestId;
 featuredAudio.pause();
 audio.pause();audio.removeAttribute('src');audio.load();
 videoPlayer.pause();videoPlayer.removeAttribute('src');videoPlayer.load();
 musicVisual.pause();musicVisual.removeAttribute('src');musicVisual.load();
 musicVisualStage.hidden=true;albumArt.hidden=false;
 const cover=$('current-cover'),fallbackCover=$('cover-fallback'),coverPath=coverFor(track);
 cover.onload=()=>{cover.hidden=false;fallbackCover.hidden=true};
 cover.onerror=()=>{cover.hidden=true;fallbackCover.hidden=false};
 cover.hidden=true;fallbackCover.hidden=false;
 cover.removeAttribute('src');
 if(coverPath)cover.src=coverPath;
 $('cover-detail-link').href='song.html?demo='+encodeURIComponent(track.id||'');
 $('track-title').textContent=track.title;
 $('track-subtitle').textContent=track.subtitle||'소중한 이야기를 담은 노래';
 $('track-genre').textContent=track.genre||'장르 정보 준비 중';
 $('track-position').textContent=String(current+1).padStart(2,'0')+' / '+String(tracks.length).padStart(2,'0');
 $('track-counter').textContent=String(current+1).padStart(2,'0')+' — '+String(tracks.length).padStart(2,'0');
 document.querySelectorAll('[data-position]').forEach(el=>{
  const selected=Number(el.dataset.position)===current;
  el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));
 });
 rawLyrics='';drawLyrics('');
 if(track.lyricsText){rawLyrics=track.lyricsText;drawLyrics(rawLyrics)}
 else if(track.lyricsFile&&fileOK(track.lyricsFile)){
  readText(fileURL('media/',track.lyricsFile)).then(text=>{
   if(token!==requestId)return;rawLyrics=text;drawLyrics(rawLyrics);advanceLyrics();
  }).catch(()=>{if(token===requestId)drawLyrics('')});
 }
 // A short decorative video runs silently and loops independently of the full MP3.
 // It is NOT a second audio source, so the song and its lyric timing stay on music-audio.
 if(track.visualMode==='silent-loop'&&fileOK(track.visualFile||'')){
  musicVisual.muted=true;musicVisual.defaultMuted=true;musicVisual.volume=0;
  musicVisual.controls=false;musicVisual.loop=true;
  musicVisual.src=fileURL('media/',track.visualFile);
  musicVisualStage.hidden=false;albumArt.hidden=true;
  void musicVisual.play().catch(()=>{/* Muted autoplay may require a later user gesture. */});
 }
 if(track.deviceURL||track.availability!=='missing'){
  const isVideo=track.mediaKind==='video'||/\.mp4$/i.test(track.file||'');
  const mediaURL=track.deviceURL||fileURL('media/',track.file);
  // Audio owns the sound and lock-screen controls, even when the source is MP4.
  const soundName=fileOK(track.audioFile||'')?track.audioFile:track.file;
  audio.src=track.deviceURL||fileURL('media/',soundName);
  audio.loop=repeatMode==='one';
  if(isVideo){
   videoPlayer.muted=true;videoPlayer.defaultMuted=true;
   videoPlayer.controls=false;videoPlayer.loop=true;videoPlayer.playsInline=true;
   videoPlayer.src=mediaURL;
  }
  showPlayer(isVideo?'video':'audio');
  setMediaSession(track,audio);
  status(isVideo?'영상과 노래를 함께 감상하세요. 소리는 아래 오디오 플레이어에서 재생돼요.':track.visualMode==='silent-loop'?'영상은 무음으로 반복되고, 아래 재생 버튼으로 원곡을 들을 수 있어요.':'노래를 재생하고 아래에서 가사를 확인해 주세요.');
  if(autoPlay)void audio.play().catch(()=>status('재생 버튼을 눌러 노래를 감상해 주세요.'));
 }else{
  showPlayer('none');
  status('이 곡은 아직 MP3가 업로드되지 않았어요. 노래 파일을 등록하면 직접 재생할 수 있어요.');
 }
}
function showTracks(){
 const root=$('track-list');root.replaceChildren();
 for(const [idx,track] of tracks.entries()){
  const b=document.createElement('button');b.type='button';b.className='track-item';b.dataset.position=String(idx);
  const num=document.createElement('span');num.textContent=String(idx+1).padStart(2,'0');
  const info=document.createElement('span');info.className='track-name';
  const title=document.createElement('strong');title.textContent=track.title;
  const genre=document.createElement('small');genre.className='track-genre';genre.textContent=track.genre||'장르 정보 준비 중';
  const subtitle=document.createElement('small');subtitle.className='track-subtitle';subtitle.textContent=track.subtitle||'음악 선물';
  const duration=document.createElement('span');duration.className='track-length';
  duration.textContent=track.availability==='missing'&&!track.deviceURL?'준비 중':(track.durationSeconds?Math.floor(track.durationSeconds/60)+':'+String(Math.round(track.durationSeconds)%60).padStart(2,'0'):'▶');
  info.append(title,genre,subtitle);b.append(num,info,duration);
  b.addEventListener('click',()=>select(idx,true));
  const tile=document.createElement('div');tile.className='track-tile';
  const mini=document.createElement('span');mini.className='track-tile-cover';
  const coverPath=coverFor(track);
  if(coverPath){
    const image=document.createElement('img');image.alt='';image.loading='lazy';image.src=coverPath;
    image.onerror=()=>{image.remove();mini.textContent='♪'};
    mini.appendChild(image);
  }else mini.textContent='♪';
  const more=document.createElement('a');more.className='track-detail-link';
  more.href='song.html?demo='+encodeURIComponent(track.id||'');
  more.textContent='자세히 보기';more.setAttribute('aria-label',track.title+' 상세 재생 페이지 열기');
  tile.append(mini,b,more);root.appendChild(tile);
 }
}
async function start(){
 let usingFallback=false;
 try{
  // Bust stale manifest caches when a new music gift is published.
  const manifest=JSON.parse(await readText('media/tracks.json?updated='+Date.now()));
  if(!Array.isArray(manifest.tracks))throw Error('invalid playlist');
  tracks=manifest.tracks.filter(t=>t&&fileOK(t.file)&&(!t.lyricsFile||fileOK(t.lyricsFile)));
 }catch(_){
  usingFallback=true;
  tracks=fallback.map(t=>({...t}));
 }
 await Promise.all(tracks.map(async track=>{track.availability=await available(fileURL('media/',track.file))}));
 // Keep approved manifest entries visible; show unavailable audio as "준비 중".
 // Otherwise a temporary HEAD failure can silently remove a song and its lyrics.
 showTracks();await select(0);
 if(usingFallback)status('최신 곡 목록을 불러오지 못해 임시 목록을 표시하고 있어요. 인터넷 연결을 확인하고 새로고침해 주세요.');
}
$('previous-track').addEventListener('click',()=>select(current-1,true));
$('next-track').addEventListener('click',()=>select(current+1,true));
// Audio is the sole audible master for lyric timing, video and lock-screen controls.
audio.addEventListener('play',()=>{
 featuredAudio.pause();
 setMediaSession(tracks[current],audio);
 if(!musicVisualStage.hidden)void musicVisual.play().catch(()=>{});
 syncSilentVideo(videoPlayer,audio);
});
audio.addEventListener('pause',()=>syncSilentVideo(videoPlayer,audio));
audio.addEventListener('seeking',()=>syncSilentVideo(videoPlayer,audio));
videoPlayer.addEventListener('loadedmetadata',()=>syncSilentVideo(videoPlayer,audio));
document.addEventListener('visibilitychange',()=>{
 syncSilentVideo(videoPlayer,audio);
 syncSilentVideo(featuredVideo,featuredAudio);
});
musicVisual.addEventListener('error',()=>{
 if(!musicVisualStage.hidden)status('노래는 계속 재생할 수 있어요. 반복 영상만 불러오지 못했어요.');
});
audio.addEventListener('timeupdate',()=>{
 advanceLyrics();
 syncSilentVideo(videoPlayer,audio);
});
audio.addEventListener('seeking',advanceLyrics);
audio.addEventListener('loadedmetadata',advanceLyrics);
audio.addEventListener('ended',()=>{
 if(repeatMode==='one'){
  audio.currentTime=0;
  void audio.play().catch(()=>status('반복하려면 다시 재생 버튼을 눌러 주세요.'));
 }else if(repeatMode==='all')void select(current+1,true);
});
audio.addEventListener('error',()=>{
 if(audio.hidden||!audio.currentSrc)return;
 status('오디오를 재생할 수 없어요. MP4에 소리가 있는지 확인하거나 별도 MP3를 연결해 주세요.');
});
videoPlayer.addEventListener('error',()=>{
 if(!videoPlayer.hidden)status('영상 화면을 불러오지 못했지만 오디오는 아래에서 재생할 수 있어요.');
});
$('local-song').addEventListener('change',async event=>{
 const files=[...(event.target.files||[])],initial=tracks.length;
 for(const f of files){
  if(!/\.(mp3|m4a|wav|ogg)$/i.test(f.name)||f.size>100*1024*1024)continue;
  const url=URL.createObjectURL(f);deviceAudio.push(url);
  tracks.push({id:'device-'+Date.now()+'-'+tracks.length,title:shortName(f.name),subtitle:'내 기기에서 불러온 음악',deviceURL:url});
 }
 if(tracks.length>initial){
  showTracks();await select(initial);
  $('local-file-notice').textContent='이 기기에서만 재생되는 음악이에요. 웹사이트에 자동으로 게시되지는 않아요.';
 }else $('local-file-notice').textContent='100MB 이하의 MP3·M4A·WAV·OGG 파일을 선택해 주세요.';
 event.target.value='';
});
$('local-lyrics').addEventListener('change',async event=>{
 const f=event.target.files?.[0];if(!f)return;
 if(!/\.txt$/i.test(f.name)||f.size>200000){
  $('local-file-notice').textContent='200KB 이하 TXT 가사 파일을 선택해 주세요.';return;
 }
 rawLyrics=await f.text();tracks[current].lyricsText=rawLyrics;
 drawLyrics(rawLyrics);advanceLyrics();
 $('local-file-notice').textContent='이 기기에서 가사 세 줄씩 감상할 수 있어요.';
 event.target.value='';
});

async function reviews(){
 try{
  const data=JSON.parse(await readText('reviews/reviews.json'));
  const approved=(data.reviews||[]).filter(v=>v?.consentConfirmed===true&&fileOK(v.file)&&/\.(mp4|webm)$/i.test(v.file));
  if(!approved.length)return;
  const gallery=$('review-gallery');gallery.replaceChildren();
  for(const v of approved){
   const card=document.createElement('article');card.className='review-card';
   const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';
   video.src=fileURL('reviews/',v.file);
   const title=document.createElement('h3');title.textContent=String(v.title||'음악 후기').slice(0,100);
   card.append(video,title);gallery.append(card);
  }
 }catch(_){}
}
$('local-review').addEventListener('change',event=>{
 const f=event.target.files?.[0];if(!f)return;
 if(!/\.(mp4|webm)$/i.test(f.name)||f.size>300*1024*1024){
  $('review-file-notice').textContent='300MB 이하 MP4·WebM 영상을 선택해 주세요.';return;
 }
 const url=URL.createObjectURL(f);deviceVideo.push(url);
 const card=document.createElement('article');card.className='review-card';
 const video=document.createElement('video');video.controls=true;video.playsInline=true;video.src=url;
 const title=document.createElement('h3');title.textContent=shortName(f.name)+' · 기기 미리보기';
 card.append(video,title);$('review-gallery').prepend(card);
 $('review-file-notice').textContent='이 영상은 내 기기에서만 재생돼요.';
 event.target.value='';
});
function featured(){
 const video=featuredVideo,sound=featuredAudio,placeholder=$('mother-video-pending');
 video.src='media/mother-song.mp4';
 video.muted=true;video.defaultMuted=true;video.controls=false;video.loop=true;
 sound.src='media/mother-song.mp4';
 video.hidden=false;sound.hidden=false;placeholder.hidden=true;
 sound.loop=repeatMode!=='off';
 sound.addEventListener('play',()=>{
  audio.pause();
  setMediaSession(fallback[0],sound);
  syncSilentVideo(video,sound);
 });
 sound.addEventListener('pause',()=>syncSilentVideo(video,sound));
 sound.addEventListener('timeupdate',()=>syncSilentVideo(video,sound));
 sound.addEventListener('seeking',()=>syncSilentVideo(video,sound));
 video.addEventListener('loadedmetadata',()=>syncSilentVideo(video,sound));
 video.addEventListener('click',()=>{if(sound.paused)void sound.play().catch(()=>{});else sound.pause()});
 video.addEventListener('error',()=>{
  video.hidden=true;placeholder.hidden=false;
  const explanation=placeholder.querySelector('p');
  if(explanation)explanation.textContent='영상 화면을 준비하고 있어요. 오디오는 아래에서 들어 주세요.';
 },{once:true});
}
window.addEventListener('pagehide',()=>[...deviceAudio,...deviceVideo].forEach(URL.revokeObjectURL));
updateRepeat();void start();void reviews();featured();
})();