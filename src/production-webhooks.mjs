/**
 * Resend signed email-delivery events for the REAL Firebase order database.
 * POST /api/webhooks/resend is publicly reachable by Resend, but cannot write
 * any order status without a verified Svix HMAC and durable idempotency record.
 */
import {createHash} from 'node:crypto';
import {verifyResendDeliveryWebhook} from './resend-delivery-events.mjs';
import {now,stop,respond} from './production-runtime.mjs';

const key=id=>createHash('sha256').update(id,'utf8').digest('hex');
export async function handleProductionWebhooks(req,res,{db,env}){
 const path=new URL(req.originalUrl||req.url,'https://invalid.example').pathname;
 if(path!=='/api/webhooks/resend')return false;
 if(req.method!=='POST')stop(405,'Webhook POST만 허용합니다.');
 if(typeof env.RESEND_WEBHOOK_SIGNING_SECRET!=='string'
  ||!env.RESEND_WEBHOOK_SIGNING_SECRET.startsWith('whsec_'))
  stop(503,'메일 제공자 서명키를 설정해야 합니다.');
 let event;
 try{
  event=verifyResendDeliveryWebhook({
   rawBody:req.rawBody,headers:req.headers,
   signingSecret:env.RESEND_WEBHOOK_SIGNING_SECRET
  });
 }catch(_){
  stop(403,'메일 제공자의 유효한 서명이 아닙니다.');
 }
 const eventRef=db.collection('withuEmailEvents').doc(key(event.eventId));
 const found=await db.collection('withuOrders')
  .where('delivery.messageId','==',event.emailId).limit(1).get();
 await db.runTransaction(async tx=>{
  const previous=await tx.get(eventRef);
  if(previous.exists)return;
  const match=found.docs[0]||null;
  let current=null;
  if(match){
   current=await tx.get(match.ref);
  }
  tx.create(eventRef,{
   provider:'resend',eventId:event.eventId,providerMessageId:event.emailId,
   status:event.status,createdAt:now(),
   matchedOrderId:match?.id||null
  });
  if(current?.exists&&current.data().delivery?.messageId===event.emailId){
   tx.update(match.ref,{
    'delivery.receiptStatus':event.status,
    'delivery.receiptRecordedAt':now()
   });
  }
 });
 respond(res,200,{acknowledged:true});
 return true;
}
