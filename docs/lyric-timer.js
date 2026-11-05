import {parseLyricDocument,serializeTimedLyrics,formatCueTime} from './lyric-timing.mjs';

const $=id=>document.getElementById(id);
const audio=$('timer-audio'),video=$('timer-video');
const videoWrap=$('video-wrap');
let tracks=[],currentTrack=null,lines=[],times=[],index=0,lastEdited=-1,history=[],loadId=0;

function safeFile(s){return typeof s==='string'&&/^[a-zA-Z0-9가-힣_.-]{1,110}$/.test(s)}
function mediaURL(name){if(!safeFile(name))throw new Error('잘못된 미디어 경로');return 'media/'+encodeURIComponent(name)}
function activePlayer(){return currentTrack?.mediaKind==='video'?video:audio}
function timeText(n){return formatCueTime(Number.isFinite(n)&&n>=0?n:0).slice(1,-1)}
function announce(t){$('status').textContent=t}
function keyFor(track){return 'withu-public-lyric-cues-v1:'+track.id}

function remember(){
 if(!currentTrack)return;
 try{localStorage.setItem(keyFor(currentTrack),JSON.stringify({file:currentTrack.file,lyricsFile:currentTrack.lyricsFile,lines:lines.join('\n'),times}));}
 catch(_){announce('이 기기에서는 자동 저장이 제한돼 있어요. 완료 후 TXT를 다운로드해 주세요.')}
}
function restore(){
 try{
  const saved=JSON.parse(localStorage.getItem(keyFor(currentTrack))||'null');
  if(saved?.file===currentTrack.file&&saved?.lyricsFile===currentTrack.lyricsFile&&saved?.lines===lines.join('\n')&&
     Array.isArray(saved.times)&&saved.times.length===lines.length){
   return saved.times.map(t=>typeof t==='number'&&Number.isFinite(t)&&t>=0?t:null);
  }
 }catch(_){}
 return new Array(lines.length).fill(null);
}
function importTimingFile(source,name){
 if(!currentTrack||!lines.length)throw Error('먼저 곡과 가사를 불러와 주세요.');
 const isJson=/\.json$/i.test(name);
 let supplied=[],incoming=[];
 if(isJson){
  const draft=JSON.parse(source);
  if(draft.id!==currentTrack.id||draft.file!==currentTrack.file||draft.lyricsFile!==currentTrack.lyricsFile)
   throw Error('현재 곡과 다른 싱크 초안입니다. 곡 ID·음원·가사 파일을 확인해 주세요.');
  if(!Array.isArray(draft.lines)||!Array.isArray(draft.times)||draft.lines.length!==lines.length||draft.times.length!==lines.length)
   throw Error('가사 줄 수가 원본과 달라 초안을 적용할 수 없어요.');
  supplied=draft.lines;
  incoming=draft.times.map((v,i)=>draft.matched?.[i]===false?null:v);
 }else{
  const parsed=parseLyricDocument(source);
  if(!parsed.cues)throw Error('전체 줄에 올바른 시간코드가 있어야 TXT/LRC 파일을 가져올 수 있어요. 부분 자동 분석 결과는 JSON 초안으로 가져오세요.');
  supplied=parsed.lines;incoming=parsed.cues;
 }
 if(supplied.length!==lines.length||supplied.some((text,i)=>text!==lines[i]))
  throw Error('가사 내용 또는 줄 순서가 다릅니다. 원곡 가사와 동일한 줄만 가져올 수 있어요.');
 const parsedTimes=incoming.map(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?Math.round(v*100)/100:null);
 if(parsedTimes.some((v,i)=>v!==null&&i>0&&parsedTimes.slice(0,i).some((p,j)=>p!==null&&p>=v)))
  throw Error('앞뒤 줄의 시작 시간이 역순이거나 중복돼 있어요. 먼저 초안을 교정해 주세요.');
 times=parsedTimes;history=[];index=nextUnmarked();lastEdited=-1;remember();update();
 const count=times.filter(Number.isFinite).length;
 announce((isJson?'자동 분석 초안':'시간 정보 파일')+'을 가져왔어요 ('+count+'/'+lines.length+'줄). 실제 음원을 듣고 후렴 반복·간주·가사 시작을 검토한 다음 다운로드해 주세요.');
}
function nextUnmarked(){
 const found=times.findIndex(t=>!Number.isFinite(t));
 return found<0?lines.length:found;
}
function update(){
 if(!currentTrack)return;
 index=Math.min(Math.max(index,0),lines.length);
 const validCount=times.filter(Number.isFinite).length;
 $('progress').textContent=validCount+' / '+lines.length+'줄 기록됨';
 $('clock').textContent=timeText(activePlayer().currentTime);
 const list=$('cue-lines');
 for(const [i,li] of [...list.children].entries()){
  li.classList.toggle('current',i===index);
  li.classList.toggle('done',Number.isFinite(times[i]));
  const input=li.querySelector('input');
  if(input&&document.activeElement!==input)input.value=Number.isFinite(times[i])?String(Math.round(times[i]*100)/100):'';
 }
 const ready=validCount===lines.length&&lines.length>0&&times.every((t,i)=>t>=0&&(i===0||t>times[i-1]))&&
 (Number.isFinite(activePlayer().duration)?times.every(t=>t<=activePlayer().duration):true);
 $('export').disabled=!ready;
 $('mark-next').disabled=index>=lines.length;
 $('mark-next').textContent=index>=lines.length?'전체 기록 완료':(index+1)+'번째 가사 시작 시각 기록';
 const current=list.children[index];if(current&&index!==lastScrollIndex){
  current.scrollIntoView({behavior:'smooth',block:'nearest'});
  lastScrollIndex=index;
 }
}
let lastScrollIndex=-1;
function record(i,value){
 if(i<0||i>=lines.length||!Number.isFinite(value)||value<0){announce('유효한 줄과 시간을 선택해 주세요.');return}
 history.push({i,old:times[i],index});
 times[i]=Math.round(value*100)/100;
 lastEdited=i;
 index=nextUnmarked();
 remember();update();
 announce((i+1)+'번째 가사 시작 시간을 '+timeText(times[i])+'로 기록했어요.');
}
function renderLines(){
 const root=$('cue-lines');root.replaceChildren();
 for(let i=0;i<lines.length;i++){
  const row=document.createElement('li');
  const desc=document.createElement('div');
  const count=document.createElement('span');count.className='line-number';count.textContent='가사 '+(i+1)+' / '+lines.length;
  const lyric=document.createElement('div');lyric.className='line-text';lyric.textContent=lines[i];
  desc.append(count,lyric);
  const controls=document.createElement('div');controls.className='time-edit';
  const field=document.createElement('input');field.type='number';field.min='0';field.step='0.01';field.placeholder='초';field.setAttribute('aria-label',(i+1)+'번째 줄 시작 시간(초)');
  field.addEventListener('change',()=>{
   const value=field.value.trim()===''?null:Number(field.value);
   if(value===null){times[i]=null;index=Math.min(index,i);remember();update();return}
   record(i,value);
  });
  const mark=document.createElement('button');mark.type='button';mark.textContent='지금 기록';mark.addEventListener('click',()=>record(i,activePlayer().currentTime));
  const replay=document.createElement('button');replay.type='button';replay.textContent='앞에서 다시 듣기';
  replay.addEventListener('click',()=>{
   const t=Number.isFinite(times[i])?times[i]:activePlayer().currentTime;
   const p=activePlayer();p.currentTime=Math.max(0,t-1.5);
   void p.play().catch(()=>announce('재생 버튼으로 노래를 시작해 주세요.'));
  });
  controls.append(field,mark,replay);row.append(desc,controls);root.appendChild(row);
 }
 lastScrollIndex=-1;
}
async function loadTrack(track){
 const token=++loadId;
 currentTrack=track;lines=[];times=[];index=0;lastEdited=-1;history=[];
 audio.pause();video.pause();audio.removeAttribute('src');video.removeAttribute('src');audio.load();video.load();
 videoWrap.hidden=track.mediaKind!=='video';audio.hidden=track.mediaKind==='video';
 $('cue-lines').replaceChildren();$('export').disabled=true;
 announce(track.title+' 가사를 불러오는 중…');
 try{
  const result=await fetch(mediaURL(track.lyricsFile),{cache:'no-store'});
  if(!result.ok)throw Error('가사 파일 없음');
  const parsed=parseLyricDocument(await result.text());
  if(token!==loadId)return;
  lines=parsed.lines;
  times=parsed.cues?parsed.cues.slice():restore();
  index=nextUnmarked();
  const player=activePlayer();player.src=mediaURL(track.file);
  renderLines();update();
  announce(parsed.cues?'이미 기록된 가사 시간 정보를 불러왔어요. 수정 후 다시 다운로드할 수 있어요.':'음악을 재생하면서 한 구절씩 실제 시작 시각을 기록해 주세요.');
 }catch(error){
  if(token!==loadId)return;
  announce('가사를 불러오지 못했어요: '+error.message);
 }
}
async function start(){
 try{
  const response=await fetch('media/tracks.json?updated='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('곡 목록이 없어요');
  const data=await response.json();
  tracks=(data.tracks||[]).filter(t=>safeFile(t.file)&&safeFile(t.lyricsFile));
  const picker=$('track-select');picker.replaceChildren();
  for(const track of tracks){
   const option=document.createElement('option');option.value=track.id;option.textContent=track.title;picker.appendChild(option);
  }
  picker.addEventListener('change',()=>{const selected=tracks.find(t=>t.id===picker.value);if(selected)void loadTrack(selected)});
  if(tracks.length)await loadTrack(tracks[0]);
 }catch(err){announce('곡 목록 오류: '+err.message)}
}
$('import-timing').addEventListener('change',async event=>{
 const f=event.target.files?.[0];if(!f)return;
 try{
  if(f.size>500000)throw Error('싱크 파일은 500KB 이하여야 해요.');
  importTimingFile(await f.text(),f.name);
 }catch(error){announce('싱크 가져오기 실패: '+error.message)}
 finally{event.target.value=''}
});
$('mark-next').addEventListener('click',()=>record(index,activePlayer().currentTime));
$('undo').addEventListener('click',()=>{
 const last=history.pop();
 if(!last){announce('취소할 기록이 없어요.');return}
 times[last.i]=last.old;index=last.i;lastEdited=last.i;remember();update();
 announce((last.i+1)+'번째 가사 시간을 되돌렸어요.');
});
for(const [button,delta] of [['minus',-.1],['plus',.1]]){
 $(button).addEventListener('click',()=>{
  if(lastEdited<0||!Number.isFinite(times[lastEdited])){announce('먼저 가사 시작 시각을 기록해 주세요.');return}
  record(lastEdited,Math.max(0,times[lastEdited]+delta));
 });
}
for(const el of [audio,video]){
 el.addEventListener('timeupdate',()=>{$('clock').textContent=timeText(el.currentTime)});
 el.addEventListener('loadedmetadata',()=>update());
}
document.addEventListener('keydown',event=>{
 const editable=event.target.closest('input,select,textarea,button,[contenteditable]');
 if(editable||event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
 if(event.code==='Space'&&currentTrack&&index<lines.length){
  event.preventDefault();record(index,activePlayer().currentTime);
 }
});
$('export').addEventListener('click',()=>{
 if(!currentTrack)return;
 try{
  const result=serializeTimedLyrics(lines,times);
  const blob=new Blob([result],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=currentTrack.lyricsFile;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  announce('다운로드 완료: '+currentTrack.lyricsFile+'. GitHub docs/media/의 같은 파일을 교체하면 공개됩니다.');
 }catch(error){announce('시간 정보 확인 필요: '+error.message)}
});
void start();
