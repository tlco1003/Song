/**
 * Cloud Functions v2 runtime, mounted behind Firebase Hosting /api/**.
 * All business endpoints fail closed until PG keys, verified sender, storage,
 * and Firebase project settings are actually configured.
 */
import {initializeApp,getApps,getApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {getAuth} from 'firebase-admin/auth';
import {onRequest} from 'firebase-functions/v2/https';
import {onDocumentUpdated} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {handleProductionPayments} from './production-payments.mjs';
import {handleVideoAdInquiries} from './production-video-inquiries.mjs';
import {handleProductionDelivery} from './production-delivery.mjs';
import {handleOrderStatus} from './order-status-portal.mjs';
import {handleFunnelEvent} from './production-analytics.mjs';
import {handleProductionAdmin} from './production-admin.mjs';
import {handleAdminSongTiming} from './admin-song-timing.mjs';
import {handleProductionComments} from './production-comments.mjs';
import {handleSupportBoard} from './production-support.mjs';
import {handleProductionWebhooks} from './production-webhooks.mjs';
import {processVerifiedPaidWork} from './production-worker.mjs';
import {sendCompletedEmail} from './production-delivery.mjs';
import {reviewedPaidOrderReadyForAutoDelivery}
 from './production-auto-delivery-gate.mjs';
import {pollMurekaMusicJobs} from './mureka-paid-automation.mjs';
import {respond,stop} from './production-runtime.mjs';
import {enabledFunctionSecrets,readDeploymentSecretProfile}
 from './firebase-secret-config.mjs';

const app=getApps().length?getApp():initializeApp();
const db=getFirestore(app),auth=getAuth(app);
const bucket=getStorage(app).bucket(process.env.WITHU_STORAGE_BUCKET);
const context={db,auth,bucket,env:process.env,fetcher:globalThis.fetch};
// Nonsecret profile is generated BEFORE Functions source analysis by the
// existing predeploy script. This also works before Firebase CLI loads .env.
const {api:apiSecrets,worker:workerSecrets}=
 enabledFunctionSecrets(readDeploymentSecretProfile());

export const api=onRequest({
 region:'asia-northeast3',memory:'1GiB',
 maxInstances:20,timeoutSeconds:120,
 cors:false,invoker:'public',secrets:apiSecrets
},async(req,res)=>{
 try{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control','private, no-store');
  for(const handle of [handleProductionWebhooks,handleProductionPayments,
    handleVideoAdInquiries,
    handleFunnelEvent,handleOrderStatus,handleProductionDelivery,handleSupportBoard,handleProductionComments,handleAdminSongTiming,handleProductionAdmin]){
   if(await handle(req,res,context))return;
  }
  stop(404,'해당 API 경로가 없습니다.');
 }catch(error){
  const status=Number.isSafeInteger(error?.status)?error.status:500;
  if(status>=500)console.error('WITHU API error',error?.name||'Error');
  if(!res.headersSent)
   respond(res,status,{error:status<500?error.message:'서버 작업에 실패했습니다.'});
  else res.destroy();
 }
});
export const processPaidOrder=onDocumentUpdated({
 document:'withuOrders/{orderId}',region:'asia-northeast3',
 memory:'1GiB',timeoutSeconds:540,maxInstances:5,
 retry:false,secrets:workerSecrets
},async(event)=>{
 const current=event.data?.after?.data();
 if(!current||current.paymentStatus!=='paid'
   ||current.production?.status!=='pending')return;
 try{
  await processVerifiedPaidWork({
   db,bucket,orderId:event.params.orderId,env:process.env,fetcher:globalThis.fetch
  });
 }catch(error){
  console.error('Paid order worker failed',event.params.orderId,error?.name||'Error');
  // The order remains visible to operator; use guarded retry from admin.
 }
});

/**
 * Final verified-delivery transition. The Mureka provider stores PRIVATE
 * unreviewed candidates; after operator approves every purchased track,
 * securely email the existing personal listening link automatically.
 * Status receipt and manual admin resend remain available on email failure.
 */
export const autoDeliverReviewedOrder=onDocumentUpdated({
 document:'withuOrders/{orderId}',region:'asia-northeast3',
 memory:'512MiB',timeoutSeconds:120,maxInstances:5,
 retry:false,secrets:['RESEND_API_KEY','WITHU_LINK_ENCRYPTION_KEY']
},async(event)=>{
 const before=event.data?.before?.data();
 const after=event.data?.after?.data();
 if(!reviewedPaidOrderReadyForAutoDelivery(before,after))return;
 try{
  await sendCompletedEmail({
   db,env:process.env,fetcher:globalThis.fetch,id:event.params.orderId
  });
 }catch(error){
  console.error('Reviewed paid order auto-delivery failed',
   event.params.orderId,error?.name||'Error');
  // Delivery error is stored on the order; operator can safely retry manually.
 }
});

/**
 * Official Mureka music query/MP3 finalizer. Server-side schedule survives
 * a customer browser closing. Never submits a new billable song request.
 * Cloud Scheduler needs an active Firebase project with billing.
 */
export const pollMurekaMusic=onSchedule({
 schedule:'every 2 minutes',timeZone:'Etc/UTC',
 region:'asia-northeast3',memory:'1GiB',
 timeoutSeconds:240,maxInstances:1,
 retryCount:0,secrets:['MUREKA_API_KEY']
},async()=>{
 try{
  const result=await pollMurekaMusicJobs({
   db,bucket,env:process.env,fetcher:globalThis.fetch
  });
  if(result.needsOperator>0)console.warn('Mureka tasks need manual reconciliation',result.needsOperator);
 }catch(error){
  console.error('Mureka queued job polling error',error?.code||error?.name||'Error');
 }
});
