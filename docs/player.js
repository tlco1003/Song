/* WITHU public music letters. Only approved self-hosted audio is played. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const audio=$('music-audio');
let tracks=[],current=0,requestId=0,rawLyrics='',visibleLyrics=[],activeLine=-1;
const deviceAudio=[],deviceVideo=[];
const fileOK=s=>typeof s==='string'&&/^[a-zA-Z0-9가-힣_.-]{1,110}$/.test(s);
const fileURL=(root,s)=>root+encodeURIComponent(s);
const shortName=s=>s.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,95);
const fallback=[
 {id:'song-nara',title:'나라는 사람',subtitle:'삶과 사랑을 돌아보는 노래',file:'nara.mp3',lyricsFile:'lyrics-nara.txt',durationSeconds:257.544},
 {id:'song-taehwan',title:'구태환에게',subtitle:'연인에게 보내는 편지 같은 노래',file:'taehwan.mp3',lyricsFile:'lyrics-taehwan.txt',durationSeconds:320.04},
 {id:'song-jeongmi',title:'내사랑김정미',subtitle:'소중한 친구에게 전하는 노래',file:'jeongmi.mp3',lyricsFile:'lyrics-jeongmi.txt',durationSeconds:350.04}
];
async function readText(url){
 const result=await fetch(url,{cache:'no-store'});
 if(!result.ok)throw Error('file not available');
 return result.text();
}
async function available(url){
 try{const result=await fetch(url,{method:'HEAD',cache:'no-store'});return result.ok}
 catch(_){return false}
}
function status(text){$('playback-message').textContent=text}
function filterLyricLines(text){
 return String(text||'').replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(s=>{
  if(!s)return false;
  // Arrangement commands, prompt labels and section headers are not lyrics.
  if(/^\[[^\]]*\]$/u.test(s))return false;
  if(/^(?:version|버전)\s*\d+\s*\]?$/iu.test(s))return false;
  if(/^(?:verse(?:\s*\d+)?|chorus|pre[- ]?chorus(?:\s*\d+)?|bridge|intro|outro|finale|refrain|instrumental|interlude|repeat|반복|브릿지|인트로|아웃트로|간주)\s*\]?$/iu.test(s))return false;
  if(/^(?:\/\/|#)\s*(?:version|verse|chorus|bridge|반복|브릿지)/iu.test(s))return false;
  return true;
 });
}
function setActiveLine(index,force=false){
 if(!visibleLyrics.length)return;
 const next=Math.max(0,Math.min(visibleLyrics.length-1,index));
 if(next===activeLine&&!force)return;
 const root=$('lyrics-content'),view=$('lyrics-scroll'),children=root.children;
 if(!children.length)return;
 if(activeLine>=0&&children[activeLine])children[activeLine].classList.remove('is-active');
 activeLine=next;
 const el=children[activeLine];
 el.classList.add('is-active');
 // Keep the active lyric centered inside a 3-line viewport.
 const top=Math.max(0,el.offsetTop-root.offsetTop-(view.clientHeight-el.clientHeight)/2);
 if(typeof view.scrollTo==='function')view.scrollTo({top,behavior:force?'instant':'smooth'});
 else view.scrollTop=top;
}
function drawLyrics(text){
 const root=$('lyrics-content');root.replaceChildren();
 visibleLyrics=filterLyricLines(text);activeLine=-1;
 if(!visibleLyrics.length){root.textContent='표시할 가사가 아직 등록되지 않았어요.';return}
 for(const line of visibleLyrics){
  const p=document.createElement('p');p.className='lyric-line';p.textContent=line;root.appendChild(p);
 }
 setActiveLine(0,true);
}
function advanceLyrics(){
 if(!visibleLyrics.length||audio.hidden)return;
 const t=tracks[current];
 const duration=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:t.durationSeconds;
 if(!duration||!Number.isFinite(duration))return;
 // True line-level synchronization needs confirmed per-line timestamps (.LRC or cues).
 // Until then the three-line window follows APPROXIMATE audio progress, not word timing.
 const intro=Math.min(14,Math.max(4,duration*0.035));
 const outro=Math.min(13,duration*0.025);
 const pos=Math.max(0,Math.min(1,(audio.currentTime-intro)/Math.max(1,duration-intro-outro)));
 let target=Math.floor(pos*visibleLyrics.length);
 if(Array.isArray(t.lyricCueSeconds)&&t.lyricCueSeconds.length===visibleLyrics.length){
  target=0;
  for(let n=1;n<t.lyricCueSeconds.length;n++){
   if(Number(t.lyricCueSeconds[n])<=audio.currentTime)target=n;else break;
  }
 }
 setActiveLine(target);
}
function showAudio(yes){
 audio.hidden=!yes;
 $('no-audio').hidden=yes;
}
async function select(index,autoPlay=false){
 if(!tracks.length)return;
 current=(index+tracks.length)%tracks.length;
 const track=tracks[current],token=++requestId;
 audio.pause();audio.removeAttribute('src');audio.load();
 $('track-title').textContent=track.title;
 $('track-subtitle').textContent=track.subtitle||'소중한 이야기를 담은 노래';
 $('lyrics-track-title').textContent=track.title;
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
   if(token!==requestId)return;rawLyrics=text;drawLyrics(rawLyrics);
  }).catch(()=>{if(token===requestId)drawLyrics('')});
 }
 if(track.deviceURL||track.available){
  audio.src=track.deviceURL||fileURL('media/',track.file);
  showAudio(true);
  status(track.deviceURL?'내 기기에서 선택한 음악을 듣고 있어요.':'노래를 재생하면 가사가 함께 이동해요.');
  if(autoPlay)audio.play().catch(()=>status('다음 곡은 재생 버튼을 눌러 주세요.'));
 }else{
  showAudio(false);
  status('이 곡의 음원 파일이 아직 게시되지 않았어요. 음악 파일을 등록하면 여기에서 직접 재생할 수 있어요.');
 }
}
function showTracks(){
 const root=$('track-list');root.replaceChildren();
 for(const [idx,track] of tracks.entries()){
  const b=document.createElement('button');b.type='button';b.className='track-item';b.dataset.position=String(idx);
  const num=document.createElement('span');num.textContent=String(idx+1).padStart(2,'0');
  const info=document.createElement('span');info.className='track-name';
  const title=document.createElement('strong');title.textContent=track.title;
  const subtitle=document.createElement('small');subtitle.textContent=track.subtitle||'음악 선물';
  const duration=document.createElement('span');duration.className='track-length';
  duration.textContent=track.durationSeconds?Math.floor(track.durationSeconds/60)+':'+String(Math.round(track.durationSeconds)%60).padStart(2,'0'):'♪';
  info.append(title,subtitle);b.append(num,info,duration);
  b.addEventListener('click',()=>select(idx));root.appendChild(b);
 }
}
async function start(){
 try{
  const manifest=JSON.parse(await readText('media/tracks.json'));
  tracks=manifest.tracks.filter(t=>t&&fileOK(t.file)&&(!t.lyricsFile||fileOK(t.lyricsFile)));
 }catch(_){tracks=fallback.map(t=>({...t}))}
 await Promise.all(tracks.map(async track=>{track.available=await available(fileURL('media/',track.file))}));
 showTracks();await select(0);
}
$('previous-track').addEventListener('click',()=>select(current-1));
$('next-track').addEventListener('click',()=>select(current+1));
audio.addEventListener('timeupdate',advanceLyrics);
audio.addEventListener('seeking',advanceLyrics);
audio.addEventListener('loadedmetadata',advanceLyrics);
audio.addEventListener('ended',()=>select(current+1,true));
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
$('copy-lyrics').addEventListener('click',async()=>{
 if(!visibleLyrics.length)return;
 try{
  await navigator.clipboard.writeText(visibleLyrics.join('\n'));
  $('copy-lyrics').textContent='복사했어요';
  setTimeout(()=>$('copy-lyrics').textContent='가사 복사',1800);
 }catch(_){$('local-file-notice').textContent='복사 권한을 확인해 주세요.'}
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
 const video=$('mother-featured-video'),placeholder=$('mother-video-pending');
 video.src='media/mother-song.mp4';
 video.hidden=false;placeholder.hidden=true;
 video.addEventListener('error',()=>{
  video.hidden=true;placeholder.hidden=false;
  const explanation=placeholder.querySelector('p');
  if(explanation)explanation.textContent='영상 재생을 준비하고 있어요. 새로고침 후 다시 확인해 주세요.';
 },{once:true});
}
window.addEventListener('pagehide',()=>[...deviceAudio,...deviceVideo].forEach(URL.revokeObjectURL));
void start();void reviews();featured();
})();