/**
 * Licensed provider branch of the EXISTING paid-order Firestore worker.
 * Only server-verified paid orders, a private operator-reviewed rights record,
 * and the real Firebase Storage bucket can enter this path.
 *
 * This stage generates and saves candidates. It DOES NOT approve rights,
 * confirm sung-lyrics accuracy, mark reviews true, or send customer email.
 * Those gates remain in production-admin.mjs and production-delivery.mjs.
 */
import {randomUUID,createHash} from 'node:crypto';
import {createLyriaMusicProvider,LYRIA_MODEL,LyriaGenerationError}
 from './lyria-music-provider.mjs';
import {backupMusicToPrivateDrive} from './google-drive-private-music-backup.mjs';

export const LYRIA_PROVIDER_ID='google_lyria';
const PAYMENT_ORDER=/^withu_[a-f0-9]{32}$/;

export function configuredLyriaAutoMode(env={}){
 return env.WITHU_AUTOMATED_MUSIC_PROVIDER===LYRIA_PROVIDER_ID;
}
export function verifyLyriaRightsRecord(record,{adminUid,at=Date.now()}={}){
 return Boolean(
  record?.providerId===LYRIA_PROVIDER_ID
  &&record?.model===LYRIA_MODEL
  &&record?.status==='approved'
  &&record?.verifiedByUid===adminUid
  &&typeof adminUid==='string'&&adminUid.length>3
  &&Array.isArray(record.allowedUseCases)
  &&record.allowedUseCases.includes('customer_specific_paid_music_delivery')
  &&typeof record.privateEvidenceRef==='string'
  &&/^private\/[A-Za-z0-9_./-]{8,300}$/.test(record.privateEvidenceRef)
  &&Number.isSafeInteger(record.verifiedAt)&&record.verifiedAt>0&&record.verifiedAt<=at
  &&Number.isSafeInteger(record.validUntil)&&record.validUntil>at
 );
}
export async function runLyriaPaidAutomation({
 db,bucket,orderId,order,plan,env={},fetcher=globalThis.fetch
}={}){
 if(!PAYMENT_ORDER.test(orderId||'')||order?.id!==orderId
  ||order?.paymentStatus!=='paid'||!order.paymentKey||!order.paymentVerifiedAt
  ||order.delivery?.status==='sent')
  throw new LyriaGenerationError('PAID_ORDER_REQUIRED');
 if(!configuredLyriaAutoMode(env))
  throw new LyriaGenerationError('AUTOMATIC_PROVIDER_NOT_SELECTED');
 if(!db?.collection||!db?.runTransaction||!bucket?.file)
  throw new LyriaGenerationError('PRIVATE_DATABASE_OR_STORAGE_MISSING');
 if(plan?.version!==2||!Array.isArray(plan.songs)
  ||plan.songs.length!==(order.productId==='audio_duo'?2:1))
  throw new LyriaGenerationError('SONG_PLAN_NOT_VERIFIED');
 if(Array.isArray(order.tracks)&&order.tracks.some(Boolean))
  throw new LyriaGenerationError('EXISTING_TRACKS_REQUIRE_HUMAN_REVIEW');
 const approval=await db.collection('withuProviderApprovals')
  .doc(LYRIA_PROVIDER_ID).get();
 if(!approval.exists||!verifyLyriaRightsRecord(approval.data(),{
  adminUid:env.WITHU_ADMIN_UID
 }))throw new LyriaGenerationError('COMMERCIAL_RIGHTS_REVIEW_REQUIRED');
 const provider=createLyriaMusicProvider({apiKey:env.GEMINI_API_KEY,fetcher});
 const orderRef=db.collection('withuOrders').doc(orderId);
 const generated=[];
 for(const song of plan.songs){
  const index=song.index;
  const jobRef=db.collection('withuMusicJobs').doc(orderId+'_'+index);
  // Claim BEFORE the external billed call. No automated re-submission
  // after uncertain outcomes, duplicate cloud events, or lost responses.
  try{
   await jobRef.create({
    orderId,index,provider:LYRIA_PROVIDER_ID,model:LYRIA_MODEL,
    status:'submitted',submittedAt:Date.now(),
    orderPaymentVerifiedAt:order.paymentVerifiedAt,
    uniqueKey:'music:'+orderId+':'+index
   });
  }catch(_){throw new LyriaGenerationError('JOB_ALREADY_CLAIMED_RECONCILE_MANUALLY');}
  const music=await provider.createLicensedSong({order,song});
  const storagePath='orders/'+orderId+'/tracks/'+index+'-'+randomUUID()+'.mp3';
  const file=bucket.file(storagePath);
  await file.save(music.bytes,{
   resumable:false,contentType:music.contentType,
   metadata:{cacheControl:'private,no-store',metadata:{
    customerOrderId:orderId,
    provider:LYRIA_PROVIDER_ID,
    sha256:createHash('sha256').update(music.bytes).digest('hex')
   }}
  });
  await db.runTransaction(async tx=>{
   const snapshot=await tx.get(orderRef);
   if(!snapshot.exists)throw new LyriaGenerationError('ORDER_MISSING_AFTER_GENERATION');
   const current=snapshot.data();
   if(current.paymentStatus!=='paid'||current.paymentKey!==order.paymentKey
    ||current.delivery?.status==='sent')
    throw new LyriaGenerationError('ORDER_CHANGED_DURING_GENERATION');
   const tracks=Array.from({length:plan.songs.length},(_,i)=>current.tracks?.[i]||null);
   if(tracks[index-1])
    throw new LyriaGenerationError('TRACK_ALREADY_REGISTERED_REVIEW_MANUALLY');
   tracks[index-1]={
    index,storagePath,fileName:'withu-generated-'+index+'.mp3',
    ext:'mp3',contentType:'audio/mpeg',genre:song.genre,
    title:song.title,lyrics:song.lyrics,
    reviewed:false,rightsVerified:false,
    source:LYRIA_PROVIDER_ID,model:LYRIA_MODEL,
    generatedAt:Date.now(),sizeBytes:music.bytesLength
   };
   tx.update(orderRef,{tracks});
   tx.update(jobRef,{
    status:'candidate_stored_awaiting_review',
    privateAssetPath:storagePath,completedAt:Date.now(),
    sha256:createHash('sha256').update(music.bytes).digest('hex')
   });
  });
  // Backup is optional and never causes regeneration of a billed candidate.
  // A failed or unknown Drive upload is visible to the operator for review.
  let driveBackup;
  try{
   driveBackup=await backupMusicToPrivateDrive({
    env,bytes:music.bytes,orderId,index,fetcher
   });
  }catch(error){
   driveBackup={status:'failed',
    code:typeof error?.code==='string'?error.code:'DRIVE_BACKUP_UNKNOWN'};
  }
  await jobRef.update({driveBackup});
  generated.push({index,storagePath});
 }
 return Object.freeze({
  status:'awaiting_review',provider:LYRIA_PROVIDER_ID,
  candidateCount:generated.length,
  // Exclude customer-facing URLs and private production prompts.
  candidateIndexes:Object.freeze(generated.map(x=>x.index))
 });
}
