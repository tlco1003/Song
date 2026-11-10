/**
 * WITHU protected SONG AI timing API. All operations use the existing
 * Firebase Auth UID/email verification on the SERVER, not a hidden page.
 * Actual ASR is run in a private Cloud Run Job, never simulated here.
 */
import {randomUUID,createHash} from 'node:crypto';
import {admin,checkOrigin,stop,respond,json} from './production-runtime.mjs';

const COL='withuSongTimingProjects';
const ID=/^timing_[a-f0-9]{32}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=()=>Date.now();
const lyricLines=text=>String(text).normalize('NFC').split(/\r?\n/).map(s=>s.trim())
 .filter(s=>s&&!/^\[[^\]]+\]$/.test(s)&&!s.startsWith('#'));
function summary(p){
 return {id:p.id,title:p.title,updatedAt:p.updatedAt,
  hasAudio:!!p.audioStoragePath,fileName:p.audioFileName||null,
  analysis:p.analysis||{status:'NOT_STARTED'},
  reviewed:!!p.review,phonemeTimingVerified:false};
}
async function readProject(db,id){
 if(!ID.test(id||''))stop(404,'프로젝트를 찾지 못했습니다.');
 const snap=await db.collection(COL).doc(id).get();
 if(!snap.exists)stop(404,'등록된 프로젝트가 없습니다.');
 return snap.data();
}
function soundFile(name,bytes){
 if(typeof name!=='string'||name.length>120||!/\.(mp3|wav|flac|m4a)$/i.test(name))
  stop(415,'MP3, WAV, FLAC, M4A 형식의 음원을 선택하세요.');
 if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.length>25*1024*1024)
  stop(413,'음원은 25MB 이하여야 합니다. 긴 WAV는 FLAC으로 변환하세요.');
 const ext=name.split('.').pop().toLowerCase();
 const valid=ext==='flac'?bytes.toString('ascii',0,4)==='fLaC':
  ext==='wav'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':
  ext==='m4a'?bytes.toString('ascii',4,8)==='ftyp':
  bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
 if(!valid)stop(415,'음원 파일 내용과 확장자가 일치하지 않습니다.');
 return {ext,mime:{mp3:'audio/mpeg',wav:'audio/wav',
  flac:'audio/flac',m4a:'audio/mp4'}[ext]};
}
function validateDraft(d,p){
 if(!d||d.schema!=='SONG_AI_LINE_TIMING_DRAFT_V1'||d.reviewedByHuman!==false||
 d.audioSHA256!==p.audioSHA256||d.lyricsSHA256!==p.lyricsSHA256||
 !Array.isArray(d.lines)||d.lines.length!==lyricLines(p.lyrics).length)
  stop(422,'분석 후보의 원곡/가사 해시 또는 줄 수가 일치하지 않습니다.');
 const text=lyricLines(p.lyrics);
 const duration=Number(d.durationSec);
 if(!Number.isFinite(duration)||duration<=0||duration>1800)
  stop(422,'실제 음악의 길이가 올바르지 않습니다.');
 for(let i=0;i<text.length;i++){
  const row=d.lines[i];
  if(!row||row.index!==i||row.text!==text[i])
   stop(422,'분석 후보의 가사 순서가 다릅니다.');
  for(const field of ['start','end'])
   if(row[field]!=null&&(!Number.isFinite(row[field])||row[field]<0||row[field]>duration))
    stop(422,'시간 후보가 음원 길이 범위를 벗어났습니다.');
 }
 return d;
}
function makeReview(d,body,p){
 if(body?.reviewedByHuman!==true||!Array.isArray(body.lines)||
 body.lines.length!==d.lines.length)stop(422,'전 구간의 직접 검수 확인이 필요합니다.');
 let prev=0;
 const rows=d.lines.map((orig,i)=>{
  const row=body.lines[i],a=row?.start,b=row?.end;
  if(!row||row.index!==i||row.text!==orig.text||
   !Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||
   a<prev-0.001||b>d.durationSec+0.001)
   stop(422,String(i+1)+'번째 가사 구간의 시작·종료 시간을 확인하세요.');
  prev=b;
  return {index:i,text:orig.text,start:Number(a.toFixed(3)),end:Number(b.toFixed(3)),
   source:'human_verified',initialASRFlags:orig.flags||[]};
 });
 return {schema:'SONG_AI_REVIEWED_LINES_V1',source:'human_verified',
  reviewedByHuman:true,reviewedAt:stamp(),
  lyricsSHA256:p.lyricsSHA256,audioSHA256:p.audioSHA256,
  durationSec:d.durationSec,phonemeTimingVerified:false,lines:rows};
}
function hhmmss(t){
 const n=Math.round(t*1000),hour=Math.floor(n/3600000),
 minute=Math.floor((n%3600000)/60000),second=Math.floor((n%60000)/1000);
 return [hour,minute,second].map(x=>String(x).padStart(2,'0')).join(':')+
  ','+String(n%1000).padStart(3,'0');
}
function qcsv(x){return '"'+String(x).replaceAll('"','""')+'"';}
export function timingExport(review,kind){
 if(kind==='json')return {mime:'application/json',file:'reviewed-lines.json',
  text:JSON.stringify(review,null,2)};
 if(kind==='kling'){
  const body={schema:'SONG_AI_KLING_REVIEWED_CUTS_V1',
   source:'human_verified_line_timings',timeBase:'original_audio_seconds',
   audioSHA256:review.audioSHA256,lyricsSHA256:review.lyricsSHA256,
   phonemeTimingVerified:false,shots:review.lines.map((r,i)=>({
    id:'LYR-'+String(i+1).padStart(3,'0'),lyric:r.text,
    startSec:r.start,endSec:r.end,durationSec:Number((r.end-r.start).toFixed(3)),
    prompt:'',requiresSplitForShortClip:r.end-r.start>10}))};
  return {mime:'application/json',file:'kling-reviewed-cuts.json',
   text:JSON.stringify(body,null,2)};
 }
 if(kind==='srt')return {mime:'text/plain',file:'reviewed-lyrics.srt',
  text:review.lines.map((r,i)=>String(i+1)+'\n'+hhmmss(r.start)+' --> '+
   hhmmss(r.end)+'\n'+r.text+'\n').join('\n')};
 if(kind==='csv')return {mime:'text/csv',file:'reviewed-lines.csv',
  text:'index,start_sec,end_sec,duration_sec,lyric,source\n'+
   review.lines.map((r,i)=>[i+1,r.start,r.end,Number((r.end-r.start).toFixed(3)),
    qcsv(r.text),'human_verified'].join(',')).join('\n')+'\n'};
 stop(404,'지원하지 않는 내보내기 형식입니다.');
}
async function triggerPrivateJob(env,id,runId){
 const resource=env.WITHU_TIMING_CLOUD_RUN_JOB;
 if(!/^projects\/[a-z][a-z0-9-]{4,40}\/locations\/[a-z0-9-]+\/jobs\/[a-z][a-z0-9-]{1,60}$/.test(resource||''))
  stop(503,'비공개 분석 Cloud Run Job을 설정해야 합니다.');
 const {GoogleAuth}=await import('google-auth-library');
 const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
 const r=await client.request({method:'POST',
  url:'https://run.googleapis.com/v2/'+resource+':run',
  data:{overrides:{containerOverrides:[{args:['--project-id',id,'--run-id',runId]}]}}});
 return r.data?.name||null;
}
export async function handleAdminSongTiming(req,res,{db,bucket,auth,env}){
 const pathname=new URL(req.originalUrl||req.url,'https://invalid.local').pathname;
 if(!pathname.startsWith('/api/admin/timing'))return false;
 await admin(req,auth,env);
 if(!['GET','POST','PUT'].includes(req.method))stop(405,'지원하지 않는 요청 방식입니다.');
 if(req.method!=='GET')checkOrigin(req,env);
 const collection=db.collection(COL);
 if(req.method==='GET'&&pathname==='/api/admin/timing/status'){
  respond(res,200,{ownerVerified:true,privateStorage:true,uploadLimitMB:25,
   workerConfigured:!!env.WITHU_TIMING_CLOUD_RUN_JOB});return true;
 }
 if(req.method==='GET'&&pathname==='/api/admin/timing/projects'){
  const snaps=await collection.orderBy('createdAt','desc').limit(50).get();
  respond(res,200,{projects:snaps.docs.map(d=>summary(d.data()))});return true;
 }
 if(req.method==='POST'&&pathname==='/api/admin/timing/projects'){
  const body=json(req,65000);
  const lyrics=typeof body.lyrics==='string'?body.lyrics.normalize('NFC').trim():'';
  const items=lyricLines(lyrics);
  if(!lyrics||lyrics.length>60000||items.length<1||items.length>750||
     items.some(x=>x.length>450))stop(422,'가사 길이 또는 줄 수를 확인하세요.');
  const id='timing_'+randomUUID().replaceAll('-','');
  const p={id,title:String(body.title||'새 노래').slice(0,120),
   lyrics,lyricsSHA256:sha(Buffer.from(lyrics,'utf8')),
   createdAt:stamp(),updatedAt:stamp(),analysis:{status:'NO_AUDIO'},
   draft:null,review:null,phonemeTimingVerified:false};
  await collection.doc(id).create(p);
  respond(res,201,{project:summary(p)});return true;
 }
 const match=/^\/api\/admin\/timing\/projects\/(timing_[a-f0-9]{32})(?:\/(audio|candidate|review|analyze|export\/(json|csv|srt|kling)))?$/.exec(pathname);
 if(!match)stop(404,'시간표 프로젝트 경로가 올바르지 않습니다.');
 const id=match[1],action=match[2]||'',format=match[3];
 const p=await readProject(db,id),ref=collection.doc(id);
 if(req.method==='GET'&&action===''){
  respond(res,200,{project:{...summary(p),lyrics:p.lyrics,
   draft:p.draft||null,review:p.review||null,
   durationSec:p.durationSec||null}});return true;
 }
 if(req.method==='PUT'&&action==='audio'){
  let name;try{name=decodeURIComponent(req.get('x-withu-file-name')||'');}
  catch(_){stop(400,'음원 파일명이 올바르지 않습니다.');}
  const bytes=req.rawBody,descriptor=soundFile(name,bytes),digest=sha(bytes);
  if(['QUEUED','RUNNING'].includes(p.analysis?.status))
   stop(409,'분석 중에는 원곡을 변경할 수 없습니다.');
  const storagePath='admin-song-timing/'+id+'/original-'+digest+'.'+descriptor.ext;
  await bucket.file(storagePath).save(bytes,{resumable:false,contentType:descriptor.mime,
   metadata:{cacheControl:'private,no-store',metadata:{sha256:digest}}});
  await ref.update({audioStoragePath:storagePath,audioSHA256:digest,
   audioFileName:name,audioMime:descriptor.mime,
   analysis:{status:'READY_FOR_ANALYSIS'},durationSec:null,
   draft:null,review:null,phonemeTimingVerified:false,updatedAt:stamp()});
  respond(res,200,{uploaded:true,audioSHA256:digest});return true;
 }
 if(req.method==='GET'&&action==='audio'){
  if(!p.audioStoragePath)stop(404,'등록된 음원이 없습니다.');
  const [bytes]=await bucket.file(p.audioStoragePath).download();
  res.set('Content-Type',p.audioMime||'application/octet-stream');
  res.set('Cache-Control','private,no-store');
  res.status(200).send(bytes);return true;
 }
 if(req.method==='POST'&&action==='candidate'){
  if(!p.audioSHA256)stop(409,'원곡 MP3/WAV를 먼저 올려주세요.');
  const d=validateDraft(json(req,700000),p);
  await ref.update({draft:{...d,source:'external_local_asr_unverified'},
   durationSec:d.durationSec,review:null,
   analysis:{status:'REVIEW_REQUIRED',method:'external_local_asr'},
   updatedAt:stamp()});
  respond(res,200,{status:'REVIEW_REQUIRED',candidateLines:d.lines.length});return true;
 }
 if(req.method==='POST'&&action==='analyze'){
  if(!p.audioStoragePath)stop(409,'원곡 파일이 필요합니다.');
  if(!env.WITHU_TIMING_CLOUD_RUN_JOB)
   stop(503,'실제 자동 분석 Cloud Run Job이 배포되지 않았습니다.');
  const runId=randomUUID().replaceAll('-','');
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(['QUEUED','RUNNING'].includes(snap.data().analysis?.status))
    stop(409,'이미 분석 중입니다.');
   tx.update(ref,{analysis:{status:'QUEUED',runId,startedAt:stamp()},
    draft:null,review:null,updatedAt:stamp()});
  });
  try{
   const operationName=await triggerPrivateJob(env,id,runId);
   await ref.update({'analysis.operationName':operationName});
  }catch(_){
   await ref.update({analysis:{status:'FAILED_TO_START',runId,failedAt:stamp()}});
   stop(503,'비공개 분석 작업 호출 실패: Cloud Run Job 설정과 IAM 권한을 확인하세요.');
  }
  respond(res,202,{status:'QUEUED',runId,timingVerified:false});return true;
 }
 if(req.method==='POST'&&action==='review'){
  if(!p.draft||!p.audioSHA256)stop(409,'ASR 후보 또는 실제 음원이 없습니다.');
  const d=validateDraft(p.draft,p);
  const review=makeReview(d,json(req,700000),p);
  await ref.update({review,updatedAt:stamp()});
  respond(res,200,{approved:true,phonemeTimingVerified:false,review});return true;
 }
 if(req.method==='GET'&&action.startsWith('export/')){
  if(!p.review||p.review.source!=='human_verified'||!p.review.reviewedByHuman||
     p.review.audioSHA256!==p.audioSHA256||
     p.review.lyricsSHA256!==p.lyricsSHA256)
   stop(409,'현재 원곡·가사와 일치하는 검수된 시간표가 필요합니다.');
  const out=timingExport(p.review,format);
  res.set('Content-Type',out.mime+'; charset=utf-8');
  res.set('Content-Disposition','attachment; filename="'+out.file+'"');
  res.set('Cache-Control','private,no-store');
  res.status(200).send(out.text);return true;
 }
 stop(405,'해당 작업을 지원하지 않습니다.');
}
