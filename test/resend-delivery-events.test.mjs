import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {createApp} from '../src/server.mjs';
import {verifyResendDeliveryWebhook,recordResendDeliveryWebhook}
 from '../src/resend-delivery-events.mjs';

const secret='whsec_'+randomBytes(32).toString('base64');
function signed(type='email.delivered',when=Date.now()){
 const event={type,created_at:new Date(when).toISOString(),data:{
  email_id:'email_00001_678901234',to:['buyer@example.test']
 }};
 const rawBody=Buffer.from(JSON.stringify(event));
 const id='evt_00000000000001';
 const timestamp=String(Math.floor(when/1000));
 const sig=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
  .update(id+'.'+timestamp+'.').update(rawBody).digest('base64');
 const headers={'svix-id':id,'svix-timestamp':timestamp,
  'svix-signature':'v1,'+sig};
 return {rawBody,headers};
}
test('provider acceptance is distinct from verified delivered and bounced events',()=>{
 const delivered=signed('email.delivered');
 const verified=verifyResendDeliveryWebhook({
  ...delivered,signingSecret:secret
 });
 assert.equal(verified.emailId,'email_00001_678901234');
 assert.equal(verified.providerDeliveredToServer,true);
 assert.equal(verified.status,'recipient_server_accepted');
 assert.equal(verifyResendDeliveryWebhook({
  ...signed('email.sent'),signingSecret:secret
 }).providerDeliveredToServer,false);
 assert.equal(verifyResendDeliveryWebhook({
  ...signed('email.bounced'),signingSecret:secret
 }).status,'recipient_rejected');
 assert.equal(verifyResendDeliveryWebhook({
  ...signed('email.failed'),signingSecret:secret
 }).status,'send_failed');
});
test('spoofed raw body, expired timestamp, unknown secret and unsupported status are rejected',()=>{
 const original=signed('email.delivered');
 assert.throws(()=>verifyResendDeliveryWebhook({
  ...original,rawBody:Buffer.from('{"fake":true}'),signingSecret:secret
 }),/signature/);
 assert.throws(()=>verifyResendDeliveryWebhook({
  ...original,headers:{...original.headers,'svix-signature':'v1,'+'A'.repeat(44)},
  signingSecret:secret
 }),/signature/);
 assert.throws(()=>verifyResendDeliveryWebhook({
  ...original,signingSecret:secret,nowMs:Date.now()+10*60*1000
 }),/timestamp/);
 assert.throws(()=>verifyResendDeliveryWebhook({
  ...original,signingSecret:'whsec_not_registered'
 }),/signing secret/);
 const unknown=signed('payment.paid');
 assert.throws(()=>verifyResendDeliveryWebhook({...unknown,signingSecret:secret}),/Unsupported/);
});
test('verified webhook receipt must be persisted atomically and de-duplicated',async()=>{
 const payload=verifyResendDeliveryWebhook({...signed(),signingSecret:secret});
 const seen=new Set(),db={
  async recordDeliveryStatusAtomic(data){
   assert.equal(data.idempotencyKey,'resend-webhook:'+payload.eventId);
   assert.equal(data.providerMessageId,payload.emailId);
   const duplicate=seen.has(data.eventId);
   seen.add(data.eventId);
   return {outcome:duplicate?'duplicate':'created'};
  }
 };
 const a=await recordResendDeliveryWebhook({verifiedEvent:payload,deliveryStore:db});
 const b=await recordResendDeliveryWebhook({verifiedEvent:payload,deliveryStore:db});
 assert.equal(a.acknowledged,true);
 assert.equal(a.outcome,'created');assert.equal(b.outcome,'duplicate');
 assert.equal(seen.size,1);
 await assert.rejects(recordResendDeliveryWebhook({
  verifiedEvent:payload,deliveryStore:{recordDeliveryStatusAtomic:async()=>({outcome:'failure'})}
 }),/durably/);
});
test('HTTP webhook path does not accept unverified posted email status as proof',async(t)=>{
 const old=process.env.RESEND_WEBHOOK_SIGNING_SECRET;
 const stored=[];
 process.env.RESEND_WEBHOOK_SIGNING_SECRET=secret;
 const app=createApp({notificationEvents:{
  async recordDeliveryStatusAtomic(payload){
   stored.push(payload);return {outcome:'created'};
  }
 }});
 await new Promise(done=>app.listen(0,'127.0.0.1',done));
 t.after(async()=>{
  await new Promise(done=>app.close(done));
  if(old===undefined)delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  else process.env.RESEND_WEBHOOK_SIGNING_SECRET=old;
 });
 const base='http://127.0.0.1:'+app.address().port;
 let r=await fetch(base+'/api/webhooks/resend',{
  method:'POST',body:JSON.stringify({type:'email.delivered'}),
  headers:{'Content-Type':'application/json'}
 });
 assert.equal(r.status,403);
 assert.equal(stored.length,0);
 const event=signed();
 r=await fetch(base+'/api/webhooks/resend',{
  method:'POST',body:event.rawBody,
  headers:{'Content-Type':'application/json',...event.headers}
 });
 assert.equal(r.status,200);
 assert.equal((await r.json()).acknowledged,true);
 assert.equal(stored.length,1);
 assert.equal(stored[0].providerDeliveredToServer,true);
});
