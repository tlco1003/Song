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
import {handleProductionPayments} from './production-payments.mjs';
import {handleProductionDelivery} from './production-delivery.mjs';
import {handleProductionAdmin} from './production-admin.mjs';
import {handleProductionWebhooks} from './production-webhooks.mjs';
import {processVerifiedPaidWork} from './production-worker.mjs';
import {respond,stop} from './production-runtime.mjs';

const app=getApps().length?getApp():initializeApp();
const db=getFirestore(app),auth=getAuth(app);
const bucket=getStorage(app).bucket(process.env.WITHU_STORAGE_BUCKET);
const context={db,auth,bucket,env:process.env,fetcher:globalThis.fetch};
const apiSecrets=['TOSS_SECRET_KEY','RESEND_API_KEY','WITHU_LINK_ENCRYPTION_KEY',
 'RESEND_WEBHOOK_SIGNING_SECRET'];
const workerSecrets=['RESEND_API_KEY','OPENAI_API_KEY'];

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
    handleProductionDelivery,handleProductionAdmin]){
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
 memory:'1GiB',timeoutSeconds:300,maxInstances:5,
 retry:false,secrets:workerSecrets
},async(event)=>{
 const current=event.data?.after?.data();
 if(!current||current.paymentStatus!=='paid'
   ||current.production?.status!=='pending')return;
 try{
  await processVerifiedPaidWork({
   db,orderId:event.params.orderId,env:process.env,fetcher:globalThis.fetch
  });
 }catch(error){
  console.error('Paid order worker failed',event.params.orderId,error?.name||'Error');
  // The order remains visible to operator; use guarded retry from admin.
 }
});
