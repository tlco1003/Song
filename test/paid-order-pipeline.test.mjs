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
  genreSelection:{mode:'same',genres:['발라드']},mood:'따뜻한',sharedStyleNotes:'',
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
  async recordPendingDepositAtomic({orderId,paymentKey,providerSecret}){
   assert.equal(orderId,current.id);
   if(current.issuedPaymentKey&&current.issuedPaymentKey!==paymentKey)
     throw Error('Unexpected deposit payment key');
   current={...current,issuedPaymentKey:paymentKey,
     issuedDepositSecret:providerSecret||current.issuedDepositSecret||null};
   return {status:'waiting_for_deposit'};
  },
  async confirmPaidAndEnqueueAtomic({orderId,paymentKey,amountKrw,expectedState,nextState,route,jobKey,songPlan}){
   assert.equal(orderId,current.id);
   assert.equal(paymentKey,providerPayment().paymentKey);
   assert.equal(amountKrw,current.amountKrw);
   assert.equal(songPlan.songs.length,current.productId==='audio_duo'?2:1);
   assert.equal(expectedState,ORDER_STATES.PAYMENT_PENDING);
   assert.equal(nextState,ORDER_STATES.PAID);
   if(current.state===ORDER_STATES.PAID)return {outcome:'duplicate',route:current.fulfillmentRoute};
   if(current.state!==ORDER_STATES.PAYMENT_PENDING)throw Error('Concurrent state change');
   current={...current,state:nextState,paymentVerifiedAt:new Date().toISOString(),paymentKey,fulfillmentRoute:route,paidSongPlan:structuredClone(songPlan)};
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
test('deposit issuance persists original secret but does not send a paid job',async()=>{
 const p=makePorts({issuedPaymentKey:null});
 p.payments.confirm=async()=>providerPayment('WAITING_FOR_DEPOSIT',{secret:'verified-issuance-secret'});
 const result=await confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw:39000,...p
 });
 assert.equal(result.status,'awaiting_deposit');
 assert.equal(p.read().issuedPaymentKey,paymentKey);
 assert.equal(p.read().issuedDepositSecret,'verified-issuance-secret');
 assert.equal(p.jobs.length,0);
 assert.equal(p.read().state,ORDER_STATES.PAYMENT_PENDING);
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
 assert.equal(generated,2);
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


test('two-song same-genre plan produces TWO independent tracks in the selected genre',async()=>{
 const p=makePorts({genreSelection:{mode:'same',genres:['재즈']},mood:'감동적인'});
 const seen=[];
 const musicProvider={async createLicensedSong({song,idempotencyKey}){
  seen.push({genre:song.genre,index:song.index,key:idempotencyKey,style:song.stylePrompt});
  return {jobId:'job-'+song.index};
 }};
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p,
  settings:{preference:'approved_music_api',commercialApiAgreementVerified:true,musicProviderReady:true}});
 const paid={...p.read(),commercialApiAgreementVerified:true};
 const result=await executePaidJob({job:p.jobs[0],order:paid,musicProvider});
 assert.deepEqual(seen.map(x=>x.genre),['재즈','재즈']);
 assert.notEqual(seen[0].key,seen[1].key);
 assert.notEqual(seen[0].style,seen[1].style,'second track requires distinct interpretation');
 assert.equal(result.providerResult.length,2);
 assert.equal(p.jobs.length,1,'one paid order, two separate song requests');
});
test('two different genres create ONE independent music request per chosen genre',async()=>{
 const p=makePorts({genreSelection:{mode:'different',genres:['발라드','트로트']}});
 const seen=[];
 const musicProvider={async createLicensedSong({song,idempotencyKey}){
  seen.push({genre:song.genre,style:song.stylePrompt,idempotencyKey});
  return {jobId:'test-'+song.index};
 }};
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p,
  settings:{preference:'approved_music_api',commercialApiAgreementVerified:true,musicProviderReady:true}});
 await executePaidJob({job:p.jobs[0],order:{...p.read(),commercialApiAgreementVerified:true},musicProvider});
 assert.deepEqual(seen.map(x=>x.genre),['발라드','트로트']);
 assert.match(seen[0].style,/ballad; expressive lead vocal; piano/i);
 assert.match(seen[1].style,/Korean trot/i);
 assert.ok(seen[0].idempotencyKey.endsWith('-1'));
 assert.ok(seen[1].idempotencyKey.endsWith('-2'));
});
test('invalid two-song selections never reach a payment confirmation or operator email',async()=>{
 const invalid=[
  {mode:'different',genres:['발라드','발라드']},
  {mode:'different',genres:['재즈']},
  {mode:'same',genres:['재즈','트로트']},
  {mode:'same',genres:[]},
  {mode:'same',genres:['존재하지않는장르']},
  undefined
 ];
 for(const genreSelection of invalid){
  const p=makePorts({genreSelection});
  await assert.rejects(confirmCheckoutAndQueue({
    orderId,paymentKey,claimedAmountKrw:39000,...p
  }),/genre|Genre|장르|selected|Invalid|Missing|Two distinct/i);
  assert.equal(p.getCalls(),0);
  assert.equal(p.jobs.length,0);
 }
});
test('paid operator email preserves both genres without sending on unpaid request',async()=>{
 const p=makePorts({genreSelection:{mode:'different',genres:['R&B','인디팝']}});
 const calls=[];
 const email=makeResendOperatorEmail({
  apiKey:'re_test_not_live',from:'orders@withu.example',to:'owner@example.test',
  fetchImpl:async(_url,opts)=>{calls.push(JSON.parse(opts.body));return {ok:true,json:async()=>({id:'mail-test'})};}
 });
 const unverified=p.read();
 await assert.rejects(email.sendPaidOrder({
  order:unverified,idempotencyKey:'withu-operator-'+orderId
 }),/unverified payment/);
 assert.equal(calls.length,0);
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p});
 const sent=await executePaidJob({job:p.jobs[0],order:p.read(),operatorEmail:email});
 assert.equal(sent.providerResult.messageId,'mail-test');
 assert.equal(calls.length,1);
 assert.match(calls[0].text,/곡 1 \/ 2 — 선택 장르: R&B/);
 assert.match(calls[0].text,/곡 2 \/ 2 — 선택 장르: 인디팝/);
});
test('paid order processing rejects a tampered stored genre request',async()=>{
 const p=makePorts();
 await confirmCheckoutAndQueue({orderId,paymentKey,claimedAmountKrw:39000,...p});
 const tampered={...p.read(),genreSelection:{mode:'different',genres:['발라드','재즈']}};
 await assert.rejects(executePaidJob({
  job:p.jobs[0],order:tampered,operatorEmail:{async sendPaidOrder(){throw Error('must not send');}}
 }),/Persisted paid song plan differs/);
});
