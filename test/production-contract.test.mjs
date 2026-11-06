import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeProductionId,requireProductionId,makeOpaqueToken,tokenHash,
 assertExactTossPayment,commercialMode,authorizeOrderMedia,UPGRADE_KRW}
 from '../src/production-contract.mjs';
const orderId=makeProductionId(),paymentKey='pay_token_1234567890';
test('new production order IDs and session tokens are unguessable and different',()=>{
 const other=makeProductionId(),t1=makeOpaqueToken(),t2=makeOpaqueToken();
 assert.notEqual(orderId,other);assert.notEqual(t1,t2);
 assert.match(tokenHash(t1),/^[0-9a-f]{64}$/);
 assert.throws(()=>requireProductionId('test_bad'));
 assert.throws(()=>tokenHash('not-a-token'));
 assert.equal(UPGRADE_KRW,10000);
});
test('only exact paid Toss order, amount, currency and status can unlock music',()=>{
 const base={orderId,paymentKey,status:'DONE',currency:'KRW',totalAmount:29000,balanceAmount:29000};
 const request={orderId,paymentKey,amountKrw:29000};
 assert.equal(assertExactTossPayment(request,base),true);
 for(const patch of [{totalAmount:1},{balanceAmount:1},{status:'READY'},
  {currency:'USD'},{orderId:makeProductionId()},{paymentKey:'other'}])
  assert.throws(()=>assertExactTossPayment(request,{...base,...patch}));
});
test('real charges require explicit mode, matching public/secret prefixes and origin',()=>{
 const env={WITHU_PAYMENT_MODE:'live',TOSS_CLIENT_KEY:'live_gck_some',
  TOSS_SECRET_KEY:'live_gsk_some',WITHU_PUBLIC_BASE_URL:'https://music.example/',
  RESEND_API_KEY:'re_secret',WITHU_FROM_EMAIL:'WITHU <music@example.com>'};
 assert.equal(commercialMode(env),null);
 assert.equal(commercialMode({...env,WITHU_LIVE_PAYMENTS_ENABLED:'true'}).mode,'live');
 assert.equal(commercialMode({...env,WITHU_PAYMENT_MODE:'test'}),null);
 assert.equal(commercialMode({...env,WITHU_PAYMENT_MODE:'test',
  TOSS_CLIENT_KEY:'test_gck_abc',TOSS_SECRET_KEY:'test_gsk_abc'}).mode,'test');
});
test('shared music links may only access songs belonging to their own order',()=>{
 const paid={paymentStatus:'paid',delivery:{status:'sent'},upgrade:{paymentStatus:'pending'}};
 assert.equal(authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:orderId,kind:'playback',order:paid
 }),true);
 assert.throws(()=>authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:makeProductionId(),kind:'playback',order:paid
 }));
 assert.throws(()=>authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:orderId,kind:'download',order:paid
 }));
 assert.throws(()=>authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:orderId,kind:'playback',order:{...paid,paymentStatus:'pending'}
 }));
 assert.equal(authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:orderId,kind:'download',
  order:{...paid,upgrade:{paymentStatus:'paid',rightsVerified:true}}
 }),true);
});
