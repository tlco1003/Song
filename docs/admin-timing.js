/**
 * WITHU private song timing console. Uses EXISTING Firebase Auth and same-origin
 * Cloud Functions /api/admin/timing; never embeds owner credentials.
 */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged}
 from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';

const $=id=>document.getElementById(id);
let auth=null,project=null,statusInfo=null,activeIndex=-1,previewUrl=null,loadedAudioProjectId=null,pollTimer=null,points=[];
const warn=message=>{$('timing-job-status').textContent=String(message)};
const loginStatus=message=>{$('timing-auth-status').textContent=String(message)};
function stamp(seconds){
 if(!Number.isFinite(Number(seconds)))return '--:--.---';
 const t=Math.max(0,Number(seconds)),m=Math.floor(t/60),s=Math.floor(t%60);
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+
  String(Math.floor(t*1000)%1000).padStart(3,'0');
}
async function api(path,{method='GET',payload=null,bytes=null,name=null,blob=false}={}){
 const user=auth?.currentUser;
 if(!user||!user.emailVerified)throw Error('인증된 운영자 계정이 필요합니다.');
 const headers={Authorization:'Bearer '+await user.getIdToken()};
 let body;
 if(bytes){
  headers['Content-Type']='application/octet-stream';
  headers['x-withu-file-name']=encodeURIComponent(name||'upload.mp3');body=bytes;
 }else if(payload!==null){headers['Content-Type']='application/json';body=JSON.stringify(payload);}
 const response=await fetch('/api/admin/timing'+path,{method,headers,credentials:'same-origin',
  cache:'no-store',...(body?{body}:{})});
 if(blob){
  if(!response.ok){
   const data=await response.json().catch(()=>({}));
   throw Error(data.error||'요청이 거절되었습니다. HTTP '+response.status);
  }
  return response.blob();
 }
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'관리자 서버 응답 오류 '+response.status);
 return data;
}
async function initialize(){
 let response;
 try{response=await fetch('/api/runtime',{cache:'no-store'});}
 catch(_){throw Error('Firebase Hosting 운영 서버에 연결되지 않았어요. GitHub Pages에서는 이 관리자 페이지의 실제 분석 기능을 실행할 수 없습니다.');}
 if(!response.ok)throw Error('Firebase Hosting 운영 API가 배포되지 않았어요. GitHub Pages 정적 화면만으로는 안전한 관리자 로그인과 음원 분석을 제공할 수 없습니다.');
 const runtime=await response.json();
 if(!runtime.firebaseWebConfig?.apiKey||!runtime.firebaseWebConfig?.projectId)
  throw Error('Firebase 운영자 인증 웹 설정이 필요합니다.');
 auth=getAuth(initializeApp(runtime.firebaseWebConfig));
 onAuthStateChanged(auth,async user=>{
  $('timing-private').hidden=true;
  $('timing-sign-out').hidden=!user;
  if(!user){
   if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
   loadedAudioProjectId=null;project=null;points=[];
   $('timing-player').removeAttribute('src');$('timing-player').load();
   loginStatus('운영자 이메일과 비밀번호로 로그인하세요.');return;
  }
  if(!user.emailVerified){loginStatus('관리자 계정의 이메일 확인을 먼저 완료해 주세요.');return;}
  $('timing-password').value='';
  loginStatus('서버에서 실제 운영자 UID를 검증하고 있어요.');
  try{
   statusInfo=await api('/status');
   if(!statusInfo.ownerVerified)throw Error('서버가 운영자 권한을 승인하지 않았습니다.');
   $('timing-owner-check').textContent='본인 인증 완료';
   $('timing-worker-state').textContent=statusInfo.workerConfigured?'서버 설정됨 · 실행 미검증':'연결 대기';
   $('timing-auto').disabled=!statusInfo.workerConfigured;
   $('timing-private').hidden=false;
   loginStatus('Firebase에서 운영자 본인 권한을 확인했습니다.');
   await listProjects();
  }catch(error){
   $('timing-private').hidden=true;
   loginStatus(error.message||'서버 관리자 인증에 실패했습니다.');
  }
 });
}
async function listProjects(){
 const r=await api('/projects');
 const select=$('timing-project-select');
 const previous=project?.id||select.value;
 select.replaceChildren();
 select.add(new Option('저장된 프로젝트를 선택하세요',''));
 for(const p of r.projects||[])select.add(new Option(p.title+' · '+p.analysis.status,p.id));
 if(previous&&r.projects.some(p=>p.id===previous))select.value=previous;
}
function mark(isVerified){
 $('timing-grade').textContent=isVerified?'LINES VERIFIED · PHONES UNVERIFIED':'DRAFT · REVIEW REQUIRED';
 $('timing-grade').classList.toggle('verified',Boolean(isVerified));
 $('timing-export-note').textContent=isVerified?
  '검수된 가사 시간으로 Kling/CSV/SRT/JSON을 내려받습니다. 음소 정답은 아직 별도입니다.':
  '확정 다운로드는 원곡을 들으며 모든 줄의 시간을 검수한 뒤 활성화됩니다.';
 for(const button of document.querySelectorAll('[data-timing-export]'))button.disabled=!isVerified;
}
function timeRows(){
 return project?.review?.lines||project?.draft?.lines||[];
}
function renderCues(){
 const source=timeRows(),target=$('timing-cue-rows');
 target.replaceChildren();
 if(!source.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=6;td.textContent='자동 분석 후보를 가져오거나 직접 시간표 작성을 시작하세요.';
  tr.append(td);target.append(tr);mark(false);return;
 }
 source.forEach((row,i)=>{
  const tr=document.createElement('tr');
  tr.dataset.index=String(i);
  if(i===activeIndex)tr.classList.add('active');
  const idx=document.createElement('td');idx.textContent=String(i+1);
  const text=document.createElement('td');text.textContent=row.text;
  const num=(field)=>{
   const td=document.createElement('td'),input=document.createElement('input');
   input.type='number';input.min='0';input.step='.001';input.dataset.field=field;
   input.value=Number.isFinite(row[field])?row[field].toFixed(3):'';
   input.setAttribute('aria-label',String(i+1)+'번째 줄 '+field+' 초');
   input.addEventListener('focus',()=>activate(i));
   td.append(input);return td;
  };
  const tdPlay=document.createElement('td'),button=document.createElement('button');
  button.type='button';button.textContent='▶ 듣기';button.addEventListener('click',()=>{
   activate(i);
   const t=tr.querySelector('input[data-field="start"]').value;
   if(t===''){warn('해당 줄의 시작 시각을 먼저 정해 주세요.');return;}
   const player=$('timing-player');player.currentTime=Number(t);
   player.play().catch(()=>warn('오디오 재생 허용을 확인해 주세요.'));
  });
  tdPlay.append(button);
  const tdFlags=document.createElement('td'),flags=row.flags||row.initialASRFlags||[];
  if(project?.review){tdFlags.textContent='관리자 검수';}
  else if(flags.length){for(const flag of flags){const el=document.createElement('span');
    el.className='timing-cue-flag';el.textContent=flag;tdFlags.append(el);}
  }else tdFlags.textContent='ASR 후보 · 미검수';
  tr.append(idx,text,num('start'),num('end'),tdPlay,tdFlags);
  tr.addEventListener('click',e=>{if(!e.target.closest('button'))activate(i);});
  target.append(tr);
 });
 mark(Boolean(project?.review));
}
function activate(index){
 activeIndex=index;
 for(const tr of $('timing-cue-rows').querySelectorAll('tr[data-index]')){
  tr.classList.toggle('active',Number(tr.dataset.index)===index);
 }
}
function sourceLines(){
 return String(project?.lyrics||'').normalize('NFC').split(/\r?\n/).map(x=>x.trim())
  .filter(x=>x&&!/^\[[^\]]+\]$/.test(x)&&!x.startsWith('#'));
}
async function loadProject(id){
 if(!id)return;
 const r=await api('/projects/'+id);
 project=r.project;activeIndex=-1;
 $('timing-editor').hidden=false;
 $('timing-selected-title').textContent=project.title;
 $('timing-project-select').value=id;
 $('timing-reviewed-check').checked=false;
 $('timing-track-duration').textContent=project.durationSec?
  '원곡 '+stamp(project.durationSec):'원곡 길이 확인 중';
 warn('분석 상태: '+(project.analysis?.status||'NOT_STARTED')+
  '. 자동 시간표와 검수 시간표는 서로 다른 자료입니다.');
 renderCues();
 if(loadedAudioProjectId!==id){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  loadedAudioProjectId=null;points=[];
  $('timing-player').removeAttribute('src');$('timing-player').load();
  try{
   if(project.hasAudio){
    const blob=await api('/projects/'+id+'/audio',{blob:true});
    if(project.id!==id)return;
    previewUrl=URL.createObjectURL(blob);
    loadedAudioProjectId=id;
    $('timing-player').src=previewUrl;
    $('timing-player').load();
    void drawWaveform(blob);
   }
  }catch(error){warn('실제 음원 로딩 실패: '+error.message);}
 }
 if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
 if(['QUEUED','RUNNING'].includes(project.analysis?.status)){
  pollTimer=setTimeout(()=>loadProject(id).catch(e=>warn(e.message)),4500);
 }
}
async function createProject(event){
 event.preventDefault();
 const file=$('timing-music-file').files[0];
 if(!file)throw Error('실제 음악 파일을 선택해 주세요.');
 if(file.size>25*1024*1024)throw Error('25MB를 넘는 음원은 FLAC으로 변환하여 올려 주세요.');
 let lyrics=$('timing-lyrics').value;
 const txt=$('timing-lyrics-file').files[0];
 if(txt){
  if(!/\.txt$/i.test(txt.name)||txt.size>1024*1024)throw Error('가사는 1MB 이하 UTF-8 TXT 파일만 가능합니다.');
  lyrics=await txt.text();
 }
 if(!lyrics.trim())throw Error('가사를 입력하거나 TXT 파일을 선택하세요.');
 $('timing-create').disabled=true;
 try{
  const created=await api('/projects',{method:'POST',
   payload:{title:$('timing-title').value.trim()||file.name,lyrics}});
  const id=created.project.id;
  warn('서버가 원곡을 비공개 저장소에 업로드하고 있습니다…');
  await api('/projects/'+id+'/audio',{method:'PUT',bytes:file,name:file.name});
  await listProjects();await loadProject(id);
  warn('음원과 가사 등록 완료. 분석 서버가 설정되어 있으면 자동분석을 시작할 수 있습니다.');
 }finally{$('timing-create').disabled=false;}
}
async function uploadCandidate(file){
 if(!project)throw Error('먼저 프로젝트를 선택해 주세요.');
 if(file.size>700000)throw Error('분석 JSON이 너무 큽니다.');
 const candidate=JSON.parse(await file.text());
 await api('/projects/'+project.id+'/candidate',{method:'POST',payload:candidate});
 await loadProject(project.id);
 warn('외부 분석 초안을 불러왔습니다. 원음으로 모든 시각을 검수해야 합니다.');
}
async function manualCandidate(){
 if(!project)throw Error('프로젝트를 먼저 선택하세요.');
 const audio=$('timing-player');
 const duration=Number(audio.duration);
 if(!Number.isFinite(duration)||duration<=0)throw Error('원곡 길이를 먼저 로딩해야 합니다.');
 // A completely blank draft is not automatic time recognition.
 const lines=sourceLines().map((text,i)=>({index:i,text,start:null,end:null,
  matched:false,score:null,flags:['MANUAL_UNTIMED_NOT_ASR'],
  reviewed:false,source:'manual_blank_unverified'}));
 const candidate={schema:'SONG_AI_LINE_TIMING_DRAFT_V1',
  source:'manual_blank_unverified',reviewedByHuman:false,
  audioSHA256:project.audioSHA256,lyricsSHA256:project.lyricsSHA256,
  durationSec:duration,lines,requiresHumanReview:true};
 await api('/projects/'+project.id+'/candidate',{method:'POST',payload:candidate});
 await loadProject(project.id);
 warn('빈 시간표를 만들었습니다. 실제 시간을 들으며 직접 입력해야 합니다.');
}
function collectCues(){
 const rows=timeRows();
 return rows.map((r,i)=>{
  const tr=$('timing-cue-rows').querySelector('tr[data-index="'+i+'"]');
  const start=tr.querySelector('input[data-field="start"]').value,
        end=tr.querySelector('input[data-field="end"]').value;
  return {index:i,text:r.text,start:start===''?null:Number(start),end:end===''?null:Number(end)};
 });
}
async function saveReview(){
 if(!project?.draft)throw Error('먼저 분석 후보를 준비해 주세요.');
 if(!$('timing-reviewed-check').checked)throw Error('전체 구간을 실제 원곡에서 직접 확인한 뒤 검수 체크를 해 주세요.');
 const r=await api('/projects/'+project.id+'/review',{method:'POST',
  payload:{reviewedByHuman:true,lines:collectCues()}});
 project.review=r.review;renderCues();
 $('timing-reviewed-check').checked=false;
 warn('가사 줄 시간표가 검수·보관되었습니다. 자음·모음 시간표는 별도로 검수해야 합니다.');
}
async function exportFile(kind){
 if(!project?.review)throw Error('검수된 가사 시간표가 없습니다.');
 const token=await auth.currentUser.getIdToken();
 const response=await fetch('/api/admin/timing/projects/'+project.id+'/export/'+kind,
   {headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin'});
 if(!response.ok){const r=await response.json().catch(()=>({}));throw Error(r.error||'다운로드가 거부됐습니다.');}
 const blob=await response.blob(),url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;link.download={kling:'kling-reviewed-cuts.json',csv:'reviewed-lines.csv',
  srt:'reviewed-lyrics.srt',json:'reviewed-lines.json'}[kind];
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function drawWaveform(blob){
 const canvas=$('timing-wave'),ctx=canvas.getContext('2d');
 ctx.clearRect(0,0,canvas.width,canvas.height);
 points=[];
 try{
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)throw Error('Web Audio unavailable');
  const context=new Context();
  try{
   const audio=await context.decodeAudioData(await blob.arrayBuffer());
   const pcm=audio.getChannelData(0),bins=800;
   for(let k=0;k<bins;k++){
    const begin=Math.floor(k*pcm.length/bins),end=Math.floor((k+1)*pcm.length/bins);
    let peak=0;
    const step=Math.max(1,Math.floor((end-begin)/40));
    for(let i=begin;i<end;i+=step)peak=Math.max(peak,Math.abs(pcm[i]));
    points.push(peak);
   }
  }finally{await context.close();}
 }catch(_){points=[];}
 drawWave();
}
function drawWave(){
 const canvas=$('timing-wave');
 const w=Math.max(280,Math.round(canvas.getBoundingClientRect().width)),
 h=112,dpr=Math.min(window.devicePixelRatio||1,2);
 canvas.width=w*dpr;canvas.height=h*dpr;
 const c=canvas.getContext('2d');c.scale(dpr,dpr);
 c.fillStyle='#291e30';c.fillRect(0,0,w,h);
 c.strokeStyle='#58465a';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();
 if(points.length){
  c.strokeStyle='#e4b6c9';c.lineWidth=1;
  for(let x=0;x<w;x++){
   const v=points[Math.floor(x/w*points.length)]||0;
   const height=Math.min(h*.43,v*h*.85);
   c.beginPath();c.moveTo(x,h/2-height);c.lineTo(x,h/2+height);c.stroke();
  }
 }else{
  c.font='12px sans-serif';c.fillStyle='#d5bfcf';c.fillText('실제 파형을 불러오는 중이거나 분석할 수 없습니다.',14,24);
 }
 const audio=$('timing-player');
 if(Number.isFinite(audio.duration)&&audio.duration>0){
  c.strokeStyle='#ffffff';c.lineWidth=2;
  const x=(audio.currentTime/audio.duration)*w;
  c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();
 }
}
function guard(fn,element){
 return async event=>{
  if(element)element.disabled=true;
  try{await fn(event);}catch(error){warn(error.message||'실행 실패');}
  finally{if(element)element.disabled=false;}
 };
}
$('timing-sign-in').addEventListener('click',async()=>{
 try{
  if(!auth)throw Error('Firebase Hosting 설정을 먼저 연결해야 합니다.');
  await signInWithEmailAndPassword(auth,$('timing-email').value.trim(),$('timing-password').value);
 }catch(error){loginStatus(error.message||'관리자 인증 실패');}
});
$('timing-sign-out').addEventListener('click',async()=>{if(auth)await signOut(auth);});
$('timing-new-form').addEventListener('submit',guard(createProject,$('timing-create')));
$('timing-project-select').addEventListener('change',guard(async event=>{
 await loadProject(event.target.value);
}));
$('timing-refresh').addEventListener('click',guard(listProjects));
$('timing-auto').addEventListener('click',guard(async()=>{
 if(!project)throw Error('먼저 실제 음원을 등록하세요.');
 const result=await api('/projects/'+project.id+'/analyze',{method:'POST',payload:{}});
 warn('보컬 분리·가사 분석 작업 시작: '+result.status+
  '. 결과가 나오면 검수 전 후보로 표시됩니다.');
 await loadProject(project.id);
},$('timing-auto')));
$('timing-poll').addEventListener('click',guard(async()=>{
 if(project)await loadProject(project.id);
}));
$('timing-candidate-file').addEventListener('change',guard(async e=>{
 if(e.target.files[0])await uploadCandidate(e.target.files[0]);
 e.target.value='';
}));
$('timing-manual').addEventListener('click',guard(manualCandidate));
$('timing-review-save').addEventListener('click',guard(saveReview));
for(const b of document.querySelectorAll('button[data-timing-export]')){
 b.addEventListener('click',guard(()=>exportFile(b.dataset.timingExport)));
}
$('timing-set-start').addEventListener('click',()=>setCurrent('start'));
$('timing-set-end').addEventListener('click',()=>setCurrent('end'));
function setCurrent(field){
 if(activeIndex<0){warn('가사 줄을 먼저 선택하세요.');return;}
 const tr=$('timing-cue-rows').querySelector('tr[data-index="'+activeIndex+'"]');
 if(!tr)return;
 tr.querySelector('input[data-field="'+field+'"]').value=
  $('timing-player').currentTime.toFixed(3);
}
$('timing-player').addEventListener('timeupdate',function(){
 $('timing-play-position').textContent=stamp(this.currentTime);drawWave();
});
$('timing-player').addEventListener('loadedmetadata',function(){
 $('timing-track-duration').textContent='원곡 '+stamp(this.duration);
 drawWave();
});
$('timing-wave').addEventListener('click',event=>{
 const rect=event.currentTarget.getBoundingClientRect(),audio=$('timing-player');
 if(Number.isFinite(audio.duration)&&audio.duration>0){
  audio.currentTime=Math.max(0,Math.min(audio.duration,
   (event.clientX-rect.left)/rect.width*audio.duration));
 }
});
window.addEventListener('resize',drawWave);
void initialize().catch(error=>loginStatus(error.message));
