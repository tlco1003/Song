/**
 * Mureka queue/resume adapter plugged into the existing verified-paid pipeline.
 * A submission is non-idempotent and billable. We claim the DB job BEFORE POST
 * and NEVER auto-resubmit an unknown outcome. Scheduler only polls known task IDs.
 * Candidate assets remain private and unreviewed until production-admin approves.
 */
import {randomUUID,createHash} from 'node:crypto';
import {createMurekaProvider,MUREKA_MODEL,MUREKA_PROVIDER_ID,
 MurekaProviderError} from './mureka-music-provider.mjs';
export const MUREKA_ORDER_ID=/^withu_[a-f0-9]{32}$/;
const JOB_COLLECTION='withuMusicJobs';
const ORDER_COLLECTION='withuOrders';
const ACTIVE=new Set(['mureka_queued','mureka_polling']);
const MAX_JOB_AGE_MS=24*60*60*1000;
const POLL_INTERVAL_MS=2*60*1000;

export function configuredMurekaAutoMode(env={}){
 return env.WITHU_AUTOMATED_MUSIC_PROVIDER===MUREKA_PROVIDER_ID;
}
export function verifyMurekaRightsRecord(record,{adminUid,at=Date.now()}={}){
 return Boolean(
  record?.providerId===MUREKA_PROVIDER_ID&&record.model===MUREKA_MODEL
  &&record.status==='approved'&&record.verifiedByUid===adminUid
  &&typeof adminUid==='string'&&adminUid.length>3
  &&Array.isArray(record.allowedUseCases)
  &&record.allowedUseCases.includes('customer_specific_paid_music_delivery')
  &&typeof record.privateEvidenceRef==='string'
  &&/^private\/[A-Za-z0-9_./-]{8,300}$/.test(record.privateEvidenceRef)
  &&Number.isSafeInteger(record.verifiedAt)
  &&record.verifiedAt>0&&record.verifiedAt<=at
  &&Number.isSafeInteger(record.validUntil)&&record.validUntil>at
 );
}
function verifiedOrder(order,orderId){
 if(!MUREKA_ORDER_ID.test(orderId||'')||order?.id!==orderId
  ||order.paymentStatus!=='paid'||!order.paymentKey
  ||!order.paymentVerifiedAt||order.delivery?.status==='sent')
  throw new MurekaProviderError('MUREKA_PAID_ORDER_REQUIRED');
}
async function checkRights(db,env){
 const approved=await db.collection('withuProviderApprovals')
  .doc(MUREKA_PROVIDER_ID).get();
 if(!approved.exists||!verifyMurekaRightsRecord(approved.data(),{
  adminUid:env.WITHU_ADMIN_UID
 }))throw new MurekaProviderError('MUREKA_COMMERCIAL_RIGHTS_REVIEW_REQUIRED');
}
function localJobRef(db,orderId,index){
 return db.collection(JOB_COLLECTION).doc(orderId+'_'+index);
}
export async function submitMurekaPaidAutomation({
 db,orderId,order,plan,env={},fetcher=globalThis.fetch
}={}){
 verifiedOrder(order,orderId);
 if(!configuredMurekaAutoMode(env))
  throw new MurekaProviderError('MUREKA_NOT_SELECTED');
 if(!db?.runTransaction||!db?.collection||plan?.version!==2
  ||!Array.isArray(plan.songs)
  ||plan.songs.length!==(order.productId==='audio_duo'?2:1)
  ||!plan.songs.every((song,i)=>song.index===i+1))
  throw new MurekaProviderError('MUREKA_PAID_SONG_PLAN_INVALID');
 if(Array.isArray(order.tracks)&&order.tracks.some(Boolean))
  throw new MurekaProviderError('MUREKA_EXISTING_TRACKS_REVIEW_MANUALLY');
 await checkRights(db,env);
 const provider=createMurekaProvider({apiKey:env.MUREKA_API_KEY,fetcher});
 const submitted=[];
 for(const song of plan.songs){
  const ref=localJobRef(db,orderId,song.index);
  const storagePath='orders/'+orderId+'/tracks/'+song.index+'-'+randomUUID()+'.mp3';
  // The claim is the start of the billed operation. A failed/unknown POST
  // leaves this job blocked rather than spending credits again.
  try{
   await ref.create({orderId,index:song.index,provider:MUREKA_PROVIDER_ID,
    model:MUREKA_MODEL,storagePath,status:'mureka_submitting',
    createdAt:Date.now(),submittedAt:Date.now(),
    orderPaymentVerifiedAt:order.paymentVerifiedAt,
    uniqueKey:'music:'+orderId+':'+song.index});
  }catch(_){throw new MurekaProviderError('MUREKA_JOB_ALREADY_CLAIMED');}
  let external;
  try{external=await provider.submitSong({order,song});}
  catch(error){
   await ref.update({status:'mureka_reconcile_manually',
    lastError:typeof error?.code==='string'?error.code:'MUREKA_POST_OUTCOME_UNKNOWN',
    updatedAt:Date.now()});
   throw error;
  }
  await ref.update({status:'mureka_queued',taskId:external.id,
   providerStatus:external.status,model:external.model||MUREKA_MODEL,
   nextPollAt:Date.now(),updatedAt:Date.now(),attempts:0});
  submitted.push({index:song.index,taskId:external.id});
 }
 return Object.freeze({status:'generating_music',provider:MUREKA_PROVIDER_ID,
  submittedCount:submitted.length});
}
async function setJobStatusAfterPoll({db,orderId,index,status,errorCode}){
 const ref=localJobRef(db,orderId,index);
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)return;
  const data=snap.data();
  if(data.provider!==MUREKA_PROVIDER_ID
   ||data.status==='candidate_stored_awaiting_review')return;
  const terminal=['mureka_reconcile_manually','mureka_failed'].includes(status);
  // Firestore transactions require ALL reads before ANY writes.
  const orderRef=terminal?db.collection(ORDER_COLLECTION).doc(orderId):null;
  const orderSnap=terminal?await tx.get(orderRef):null;
  tx.update(ref,{status,lastError:errorCode||null,
   leaseUntil:0,updatedAt:Date.now()});
  if(terminal&&orderSnap?.exists&&orderSnap.data().delivery?.status!=='sent'){
   tx.update(orderRef,{'production.status':'manual_required',
    'production.reason':errorCode||'MUREKA_OPERATOR_ACTION_REQUIRED',
    'production.updatedAt':Date.now()});
  }
 });
}
async function pollOne({db,bucket,jobRef,env,fetcher,clock=Date.now}){
 const lease=clock()+90000;
 let work;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(jobRef);
  if(!snap.exists)return;
  const job=snap.data();
  if(!ACTIVE.has(job.status)
   ||(job.status==='mureka_polling'&&job.leaseUntil>clock())
   ||(job.status==='mureka_queued'&&job.nextPollAt>clock()))return;
  if(!MUREKA_ORDER_ID.test(job.orderId)||![1,2].includes(job.index)
   ||job.provider!==MUREKA_PROVIDER_ID||!job.taskId)return;
  tx.update(jobRef,{status:'mureka_polling',leaseUntil:lease,
   pollStartedAt:clock(),attempts:(job.attempts||0)+1});
  work=job;
 });
 if(!work)return {status:'skipped'};
 const {orderId,index}=work;
 const orderRef=db.collection(ORDER_COLLECTION).doc(orderId);
 try{
  const snap=await orderRef.get();
  if(!snap.exists)throw new MurekaProviderError('MUREKA_ORDER_MISSING');
  const order=snap.data();
  verifiedOrder(order,orderId);
  const plan=order.privateProductionPlan;
  if(plan?.version!==2||plan?.songs?.[index-1]?.index!==index
   ||plan.songs.length!==(order.productId==='audio_duo'?2:1))
   throw new MurekaProviderError('MUREKA_SONG_PLAN_NOT_PRESENT');
  if(order.tracks?.[index-1]){
   // An asset already saved is never overwritten on replay.
   await jobRef.update({status:'candidate_stored_awaiting_review',leaseUntil:0,
    updatedAt:clock()});
   return {status:'already_stored'};
  }
  await checkRights(db,env);
  const provider=createMurekaProvider({apiKey:env.MUREKA_API_KEY,fetcher});
  const task=await provider.querySong(work.taskId);
  if(task.failed){
   await setJobStatusAfterPoll({db,orderId,index,status:'mureka_failed',
    errorCode:'MUREKA_PROVIDER_'+task.status.toUpperCase()});
   return {status:'failed'};
  }
  if(!task.ready){
   const expired=clock()-(work.submittedAt||work.createdAt)>MAX_JOB_AGE_MS;
   if(expired){
    await setJobStatusAfterPoll({db,orderId,index,
     status:'mureka_reconcile_manually',errorCode:'MUREKA_TASK_OVER_24_HOURS'});
    return {status:'needs_operator_review'};
   }
   await jobRef.update({status:'mureka_queued',providerStatus:task.status,
    nextPollAt:clock()+POLL_INTERVAL_MS,leaseUntil:0,updatedAt:clock()});
   return {status:'generating'};
  }
  // Temporary provider URL must not go to a customer browser or be persisted.
  // Operators configure the EXACT verified Mureka CDN host allowlist in env.
  const audio=await provider.downloadSong({
   audioUrl:task.audioUrl,
   allowedAudioHosts:env.WITHU_MUREKA_AUDIO_HOST_ALLOWLIST
  });
  const storagePath=work.storagePath;
  if(typeof storagePath!=='string'
   ||!new RegExp('^orders/'+orderId+'/tracks/'+index+'-[a-z0-9-]+\\.mp3$').test(storagePath))
   throw new MurekaProviderError('MUREKA_PRIVATE_STORAGE_PATH_INVALID');
  const sha256=createHash('sha256').update(audio.bytes).digest('hex');
  await bucket.file(storagePath).save(audio.bytes,{
   resumable:false,contentType:'audio/mpeg',
   preconditionOpts:{ifGenerationMatch:0},
   metadata:{cacheControl:'private,no-store',
    metadata:{customerOrderId:orderId,sha256,
     provider:MUREKA_PROVIDER_ID}}
  });
  let done=false;
  await db.runTransaction(async tx=>{
   const current=await tx.get(orderRef);
   const jobSnapshot=await tx.get(jobRef);
   if(!current.exists||!jobSnapshot.exists)
    throw new MurekaProviderError('MUREKA_ORDER_OR_JOB_MISSING');
   const state=current.data(),oldJob=jobSnapshot.data();
   verifiedOrder(state,orderId);
   if(oldJob.status!=='mureka_polling')
    throw new MurekaProviderError('MUREKA_POLL_LEASE_LOST');
   const tracks=Array.from({length:plan.songs.length},(_,i)=>state.tracks?.[i]||null);
   if(tracks[index-1])
    throw new MurekaProviderError('MUREKA_TRACK_ALREADY_PRESENT');
   const song=plan.songs[index-1];
   tracks[index-1]={index,storagePath,
    fileName:'withu-generated-'+index+'.mp3',
    ext:'mp3',contentType:'audio/mpeg',
    title:song.title,genre:song.genre,lyrics:song.lyrics,
    reviewed:false,rightsVerified:false,
    source:MUREKA_PROVIDER_ID,model:MUREKA_MODEL,
    generatedAt:clock(),sizeBytes:audio.sizeBytes,sha256};
   const complete=tracks.every(Boolean);
   tx.update(orderRef,{tracks,
    'production.status':complete?'awaiting_review':'generating_music',
    'production.reason':complete?
     'mureka_candidates_stored_awaiting_human_qa':'mureka_generation_in_progress',
    'production.provider':MUREKA_PROVIDER_ID,
    'production.candidateCount':tracks.filter(Boolean).length,
    'production.updatedAt':clock()});
   tx.update(jobRef,{status:'candidate_stored_awaiting_review',
    providerStatus:'succeeded',sha256,
    leaseUntil:0,completedAt:clock(),updatedAt:clock()});
   done=true;
  });
  return {status:done?'stored_unreviewed':'unknown'};
 }catch(error){
  // Never retry a billable create POST or re-download after an unknown GCS
  // write. The operator reconciles private storage and provider task first.
  const code=typeof error?.code==='string'?error.code:'MUREKA_POLL_OR_STORAGE_UNKNOWN';
  await setJobStatusAfterPoll({db,orderId,index,
   status:'mureka_reconcile_manually',errorCode:code});
  return {status:'needs_operator_review',reason:code};
 }
}
export async function pollMurekaMusicJobs({
 db,bucket,env={},fetcher=globalThis.fetch,clock=Date.now,
 limit=10
}={}){
 if(!db?.collection||!db?.runTransaction||!bucket?.file
  ||!Number.isSafeInteger(limit)||limit<1||limit>20)
  throw new MurekaProviderError('MUREKA_POLLER_NOT_CONFIGURED');
 // Query by status only: uses Firestore automatic single-field index.
 const jobs=await db.collection(JOB_COLLECTION)
  .where('status','in',['mureka_queued','mureka_polling'])
  .limit(limit).get();
 const results=[];
 for(const snap of jobs.docs||[]){
  results.push(await pollOne({
   db,bucket,jobRef:snap.ref,env,fetcher,clock
  }));
 }
 return {examined:results.length,
  stored:results.filter(r=>r.status==='stored_unreviewed').length,
  generating:results.filter(r=>r.status==='generating').length,
  needsOperator:results.filter(r=>r.status==='needs_operator_review').length};
}
