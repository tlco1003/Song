import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORDER_STATES} from '../src/commerce.mjs';
import {
  FULFILLMENT_ROUTE,chooseFulfillmentRoute,confirmCheckoutAndQueue,
  reconcileDepositAndQueue,executePaidJob
} from '../src/paid-order-pipeline.mjs';
import {makeResendOperatorEmail} from '../src/operator-notification.mjs';

const orderId='ORDER_TEST_000001';
const paymentKey='PAYMENT_KEY_TEST_0001';
function pending(overrides={}){
 return {
  id:orderId, state:ORDER_STATES.PAYMENT_PENDING, currency:'KRW',
  amountKrw:39000, productId:'audio_duo', customerEmail:'customer@example.test',
  songTitle:'엄마에게', confirmedLyrics:'테스트용 가사', musicStyle:'발라드',
  issuedPaymentKey:paymentKey, ...overrides
 };
}
function providerPayment(status='DONE',overrides={}){
 return {
  status,paymentKey,orderId,totalAmount:39000,balanceAmount:39000,
  currency:'KRW',...overrides
 };
}
function makePorts(overrides={}){
 let current=pending(overrides), calls=0, jobs=[];
 const orders={
  async getById(id){return id===current.id?structuredClone(current):null;},
  async confirmPaidAndEnqueueAtomic({orderId,paymentKey,amountKrw,expectedState,nextState,route,jobKey}){
   assert.equal(orderId,current.id);
   assert.equal(paymentKey,providerPayment().paymentKey);
   assert.equal(amountKrw,39000);
   assert.equal(expectedState,ORDER_STATES.PAYMENT_PENDING);
   assert.equal(nextState,ORDER_STATES.PAID);
   if(current.state===ORDER_STATES.PAID)return {outcome:'duplicate',route:current.fulfillmentRoute};
   if(current.state!==ORDER_STATES.PAYMENT_PENDING)throw Error('Concurrent state change');
   current={...current,state:nextState,paymentVerifiedAt:new Date().toISOString(),paymentKey,fulfillmentRoute:route};
   jobs.push({key:jobKey,orderId,route,status:'claimed'});
   return {outcome:'created',route};
  }
 };
 const payments={
  async confirm(){calls++;return providerPayment();},
  async retrieve(){calls++;return providerPayment();}
 };
 return {orders,payments,jobs,read:()=>current,getCalls:()=>calls};
}

test('default/manual mode stays manual even when client claims automatic processing',()=>{
 assert.equal(chooseFulfillmentRoute({preference:'approved_music_api'}),FULFILLMENT_ROUTE.HUMAN);
 assert.equal(chooseFulfillmentRoute({preference:'approved_music_api',commercialApiAgreementVerified:true}),FULFILLMENT_ROUTE.HUMAN);
 assert.equal(chooseFulfillmentRoute({
  preference:'approved_music_api',commercialApiAgreementVerified:true,musicProviderReady:true
 }),FULFILLMENT_ROUTE.APPROVED_API);
});
test('verified PG DONE atomically creates one PAID job in manual queue',async()=>{
 const p=makePorts();
 const params={orderId,paymentKey,claimedAmountKrw:39000,...p};
 const a=await confirmCheckoutAndQueue(params);
 assert.deepEqual(a,{status:'paid_verified',queued:true,route:FULFILLMENT_ROUTE.HUMAN,newlyQueued:true});
 assert.equal(p.read().state,ORDER_STATES.PAID);
 assert.equal(p.jobs.length,1);
 assert.equal(p.jobs[0].route,FULFILLMENT_ROUTE.HUMAN);
 assert.deepEqual(await confirmCheckoutAndQueue(params),{status:'already_processed',queued:true});
 assert.equal(p.getCalls(),1,'Duplicate callback must not call PG confirm twice');
 assert.equal(p.jobs.length,1,'Must not add duplicate outbox jobs');
});
test('false/changed browser amounts never reach the PG',async()=>{
 const p=makePorts();
 await assert.rejects(confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw:1,...p
 }),/Client and server amount mismatch/);
 assert.equal(p.getCalls(),0);
 assert.equal(p.jobs.length,0);
});
test('provider mismatches and pending virtual accounts cannot trigger paid email',async()=>{
 for(const payment of [
  providerPayment('CANCELED'),providerPayment('DONE',{totalAmount:100}),
  providerPayment('DONE',{balanceAmount:0}),
  providerPayment('DONE',{currency:'USD'}),providerPayment('DONE',{orderId:'WRONG_ORDER'})
 ]){
  const p=makePorts();
  p.payments.confirm=async()=>payment;
  await assert.rejects(confirmCheckoutAndQueue({
   orderId,paymentKey,claimedAmountKrw:39000,...p
  }),/PG status, order ID, key, currency or amount/);
  assert.equal(p.jobs.length,0);
 }
 const waiting=makePorts();
 waiting.payments.confirm=async()=>providerPayment('WAITING_FOR_DEPOSIT');
 assert.deepEqual(await confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw:39000,...waiting
 }),{status:'awaiting_deposit',queued:false});
 assert.equal(waiting.read().state,ORDER_STATES.PAYMENT_PENDING);
 assert.equal(waiting.jobs.length,0);
});
test('deposit webhook notification alone never proves paid; PG re-lookup DONE is required',async()=>{
 const p=makePorts();
 p.payments.retrieve=async()=>providerPayment('WAITING_FOR_DEPOSIT');
 const a=await reconcileDepositAndQueue({orderId,paymentKey,...p});
 assert.equal(a.queued,false);
 assert.equal(p.jobs.length,0);
 p.payments.retrieve=async()=>providerPayment('DONE');
 const b=await reconcileDepositAndQueue({orderId,paymentKey,...p});
 assert.equal(b.status,'paid_verified');
 assert.equal(p.jobs.length,1);
 assert.equal((await reconcileDepositAndQueue({orderId,paymentKey,...p})).status,'already_processed');
});
test('operator and automatic workers reject unpaid orders and unapproved music APIs',async()=>{
 const p=makePorts();
 let sent=0,generated=0;
 const operatorEmail={async sendPaidOrder(){sent++;return {messageId:'email-test'};}};
 const musicProvider={async createLicensedSong(){generated++;return {jobId:'music-test'};}};
 await assert.rejects(executePaidJob({
  job:{key:'fulfill:'+orderId,orderId,route:FULFILLMENT_ROUTE.HUMAN,status:'claimed'},
  order:p.read(),operatorEmail,musicProvider
 }),/No claimable verified-paid/);
 assert.equal(sent,0);
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p});
 const notified=await executePaidJob({job:p.jobs[0],order:p.read(),operatorEmail,musicProvider});
 assert.equal(notified.providerResult.messageId,'email-test');
 assert.equal(sent,1);assert.equal(generated,0);
 const auto=makePorts();
 await confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw:39000,...auto,
  settings:{preference:'approved_music_api',commercialApiAgreementVerified:true,musicProviderReady:true}
 });
 await assert.rejects(executePaidJob({
  job:auto.jobs[0],order:auto.read(),operatorEmail,musicProvider
 }),/Unapproved automatic music generation/);
 assert.equal(generated,0);
 const licensed={...auto.read(),commercialApiAgreementVerified:true};
 await executePaidJob({job:auto.jobs[0],order:licensed,operatorEmail,musicProvider});
 assert.equal(generated,1);
});
test('Resend adapter refuses unpaid alerts and sends verified orders with stable idempotency key',async()=>{
 const captured=[];
 const mail=makeResendOperatorEmail({
  apiKey:'re_test_not_live',from:'orders@withu.example',to:'owner@example.test',
  fetchImpl:async(url,options)=>{
   captured.push({url,options});
   return {ok:true,status:200,json:async()=>({id:'resend-test-id'})};
  }
 });
 await assert.rejects(mail.sendPaidOrder({
  order:pending(),idempotencyKey:'withu-operator-'+orderId
 }),/unverified payment/);
 assert.equal(captured.length,0);
 const p=makePorts();
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p});
 const result=await mail.sendPaidOrder({
  order:p.read(),idempotencyKey:'withu-operator-'+orderId
 });
 assert.equal(result.messageId,'resend-test-id');
 assert.equal(captured.length,1);
 assert.equal(captured[0].options.headers['Idempotency-Key'],'withu-operator-'+orderId);
 const payload=JSON.parse(captured[0].options.body);
 assert.equal(payload.to[0],'owner@example.test');
 assert.match(payload.text,/고객 이메일: customer@example.test/);
 assert.match(payload.text,/PG 서버 확인 완료/);
 assert.ok(!payload.text.includes('PRIVATE_API_KEY'));
});


test('one and two song prices must match catalog; premium video requires approved quote',async()=>{
 const bad=makePorts({amountKrw:1});
 await assert.rejects(confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw:1,...bad
 }),/Stored price differs from server catalog/);
 assert.equal(bad.getCalls(),0);
 const video=makePorts({productId:'audio_video',amountKrw:300000});
 await assert.rejects(confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw:300000,...video
 }),/Video requires approved server-side quote/);
 assert.equal(video.getCalls(),0);
});
test('an already-paid order cannot be acknowledged with a different payment key',async()=>{
 const p=makePorts();
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p});
 await assert.rejects(confirmCheckoutAndQueue({
  orderId,paymentKey:'DIFFERENT_PAYMENT_KEY',claimedAmountKrw:39000,...p
 }),/Payment key does not match/);
 assert.equal(p.jobs.length,1);
});
