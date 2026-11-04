(()=>{
'use strict';
const $=id=>document.getElementById(id),au=$('music-audio'),frame=$('embedded-player');
let songs=[],current=0,lyricText='',version=0;
const local=[],videos=[];
const fallback=[
{id:'song-nara',title:'나라는 사람',subtitle:'삶과 사랑을 돌아보는 노래',file:'nara.mp3',lyricsFile:'lyrics-nara.txt',sunoId:'6723268c-9e91-4647-a8da-ed06d6b32b8c',durationSeconds:258},
{id:'song-taehwan',title:'구태환에게',subtitle:'연인에게 보내는 편지 같은 노래',file:'taehwan.mp3',lyricsFile:'lyrics-taehwan.txt',sunoId:'98a47c4c-ad1b-4bff-8f21-8afb55a4278a',durationSeconds:320},
{id:'song-jeongmi',title:'내사랑김정미',subtitle:'소중한 친구에게 보내는 노래',file:'jeongmi.mp3',lyricsFile:'lyrics-jeongmi.txt',sunoId:'f2f182c2-06e1-4c2d-927f-d26dfac7243b',durationSeconds:350}
];
const safe=x=>typeof x==='string'&&/^[\w가-힣.-]{1,110}$/.test(x);
const path=(dir,x)=>dir+encodeURIComponent(x);
const fileTitle=x=>x.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,90);
const fetchText=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('not found');return r.text()};
const status=x=>$('playback-message').textContent=x;
function displayLyrics(text){
 const root=$('lyrics-content');root.replaceChildren();
 const lines=(text||'가사가 등록되지 않았습니다.').replace(/\r\n?/g,'\n').split('\n');
 for(const line of lines){const item=document.createElement('div');
  const v=line.trim();item.className=!v?'lyric-gap':/^\[.+\]$|^Verse \d+\]$/.test(v)?'lyric-section':'lyric-line';
  item.textContent=item.className==='lyric-section'?v.replace(/^\[/,'').replace(/\]$/,''):line;
  root.append(item);
 }
 $('lyrics-scroll').scrollTop=0;
}
function show(kind){
 au.hidden=kind!=='audio';$('embedded-zone').hidden=kind!=='embed';$('no-audio').hidden=kind!=='none';
}
async function select(i,play=false){
 if(!songs.length)return;
 current=(i+songs.length)%songs.length;const t=songs[current],ticket=++version;
 au.pause();au.removeAttribute('src');au.load();frame.src='about:blank';
 $('track-title').textContent=t.title;$('track-subtitle').textContent=t.subtitle||'나의 음악';
 $('lyrics-track-title').textContent=t.title;
 $('track-position').textContent=String(current+1).padStart(2,'0')+' / '+String(songs.length).padStart(2,'0');
 $('track-counter').textContent=String(current+1).padStart(2,'0')+' — '+String(songs.length).padStart(2,'0');
 document.querySelectorAll('[data-position]').forEach(b=>{let selected=Number(b.dataset.position)===current;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
 lyricText='';displayLyrics('가사를 불러오는 중이에요.');
 if(t.lyricsText){lyricText=t.lyricsText;displayLyrics(lyricText);}
 else if(t.lyricsFile&&safe(t.lyricsFile))fetchText(path('media/',t.lyricsFile)).then(x=>{if(ticket!==version)return;lyricText=x;displayLyrics(x)}).catch(()=>{if(ticket===version)displayLyrics('가사를 불러오지 못했습니다.')});
 else displayLyrics('이 음악에는 가사가 등록되지 않았습니다.');
 if(t.localUrl||t.available){
  au.src=t.localUrl||path('media/',t.file);show('audio');status('재생 버튼을 눌러 음악과 가사를 함께 감상해 보세요.');
  if(play)au.play().catch(()=>status('재생 버튼을 눌러 다음 곡을 감상해 주세요.'));
 }else if(/^[0-9a-f-]{36}$/i.test(t.sunoId||'')){
  frame.src='https://suno.com/embed/'+t.sunoId;show('embed');status('재생 버튼을 눌러 노래를 감상해 보세요.');
 }else{show('none');status('음원 공개를 준비하고 있습니다.')}
}
function playlist(){
 const root=$('track-list');root.replaceChildren();
 songs.forEach((t,i)=>{const b=document.createElement('button');b.type='button';b.className='track-item';b.dataset.position=i;
  const n=document.createElement('span');n.textContent=String(i+1).padStart(2,'0');
  const info=document.createElement('span');info.className='track-name';
  const name=document.createElement('strong');name.textContent=t.title;
  const desc=document.createElement('small');desc.textContent=t.subtitle||'나의 음악';info.append(name,desc);
  const time=document.createElement('span');time.className='track-length';time.textContent=t.durationSeconds?Math.floor(t.durationSeconds/60)+':'+String(Math.round(t.durationSeconds)%60).padStart(2,'0'):'♪';
  b.append(n,info,time);b.addEventListener('click',()=>select(i));root.append(b);
 });
}
async function init(){
 try{const manifest=JSON.parse(await fetchText('media/tracks.json'));songs=manifest.tracks.filter(t=>t&&safe(t.file)&&(!t.lyricsFile||safe(t.lyricsFile)));}
 catch(_){songs=fallback.map(x=>({...x}));}
 await Promise.all(songs.map(async t=>{try{const r=await fetch(path('media/',t.file),{method:'HEAD'});t.available=r.ok;}catch(_){t.available=false;}}));
 playlist();await select(0);
}
$('previous-track').addEventListener('click',()=>select(current-1));
$('next-track').addEventListener('click',()=>select(current+1));
au.addEventListener('ended',()=>select(current+1,true));
$('local-song').addEventListener('change',async e=>{
 const files=[...(e.target.files||[])];let start=songs.length;
 for(const f of files){if(!/\.(mp3|m4a|wav|ogg)$/i.test(f.name)||f.size>100*1024*1024)continue;
  const url=URL.createObjectURL(f);local.push(url);
  songs.push({id:'local-'+Date.now()+songs.length,title:fileTitle(f.name),subtitle:'내가 가져온 음악',localUrl:url});
 }
 if(songs.length>start){playlist();await select(start);$('local-file-notice').textContent='이 기기에서만 미리 듣습니다. 공개 게시되지는 않습니다.';}
 else $('local-file-notice').textContent='100MB 이하 음악 파일을 선택해 주세요.';
 e.target.value='';
});
$('local-lyrics').addEventListener('change',async e=>{
 const f=e.target.files?.[0];if(!f)return;
 if(!/\.txt$/i.test(f.name)||f.size>200000){$('local-file-notice').textContent='200KB 이하 TXT 가사 파일을 선택해 주세요.';return;}
 lyricText=await f.text();songs[current].lyricsText=lyricText;displayLyrics(lyricText);
 $('local-file-notice').textContent='가사를 불러왔어요. 이 기기에서만 볼 수 있습니다.';e.target.value='';
});
$('copy-lyrics').addEventListener('click',async()=>{
 if(!lyricText.trim())return;
 try{await navigator.clipboard.writeText(lyricText);$('copy-lyrics').textContent='복사했어요';setTimeout(()=>$('copy-lyrics').textContent='가사 복사',1800)}catch(_){$('local-file-notice').textContent='브라우저에서 복사를 허용하지 않았습니다.';}
});
async function reviews(){
 try{
  const payload=JSON.parse(await fetchText('reviews/reviews.json'));
  const items=(payload.reviews||[]).filter(x=>x?.consentConfirmed===true&&safe(x.file)&&/\.(mp4|webm)$/i.test(x.file));
  if(!items.length)return;const target=$('review-gallery');target.replaceChildren();
  for(const item of items){const card=document.createElement('article');card.className='review-card';
    const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=path('reviews/',item.file);
    const h=document.createElement('h3');h.textContent=String(item.title||'음악 선물 후기').slice(0,100);
    card.append(video,h);target.append(card);
  }
 }catch(_){}
}
$('local-review').addEventListener('change',e=>{
 const f=e.target.files?.[0];if(!f)return;
 if(!/\.(mp4|webm)$/i.test(f.name)||f.size>300*1024*1024){$('review-file-notice').textContent='300MB 이하 영상만 선택해 주세요.';return;}
 const u=URL.createObjectURL(f);videos.push(u);
 const card=document.createElement('article');card.className='review-card';
 const video=document.createElement('video');video.controls=true;video.playsInline=true;video.src=u;
 const h=document.createElement('h3');h.textContent='내 기기 미리보기 · '+fileTitle(f.name);card.append(video,h);$('review-gallery').prepend(card);
 $('review-file-notice').textContent='이 기기에서만 감상할 수 있습니다.';e.target.value='';
});
window.addEventListener('pagehide',()=>[...local,...videos].forEach(u=>URL.revokeObjectURL(u)));

async function featureMotherVideo(){
  const player=$('mother-featured-video'),fallback=$('mother-video-pending');
  const url='media/mother-song.mp4';
  try{
    const response=await fetch(url,{method:'HEAD',cache:'no-store'});
    if(!response.ok)return;
    player.src=url;player.hidden=false;fallback.hidden=true;
  }catch(_){}
}
void init();void reviews();void featureMotherVideo();
})();