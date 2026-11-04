import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeTossPaymentAdapter} from '../src/toss-payment-adapter.mjs';

test('server-only Toss adapter confirms with original order amount and non-public secret',async()=>{
 const calls=[];
 const adapter=makeTossPaymentAdapter({
  secretKey:'test_sk_example_not_live',
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,status:200,json:async()=>({
    paymentKey:'test_payment_key',orderId:'WITHU123',totalAmount:29000,
    balanceAmount:29000,currency:'KRW',status:'DONE'
   })};
  }
 });
 const result=await adapter.confirm({
  paymentKey:'test_payment_key',orderId:'WITHU123',amountKrw:29000
 });
 assert.equal(result.status,'DONE');
 assert.equal(calls[0].url,'https://api.tosspayments.com/v1/payments/confirm');
 assert.equal(calls[0].options.method,'POST');
 assert.deepEqual(JSON.parse(calls[0].options.body),{
  paymentKey:'test_payment_key',orderId:'WITHU123',amount:29000
 });
 assert.equal(calls[0].options.headers['Idempotency-Key'],'withu-confirm-WITHU123');
 assert.equal(
  calls[0].options.headers.Authorization,
  'Basic '+Buffer.from('test_sk_example_not_live:').toString('base64')
 );
 await adapter.retrieve({paymentKey:'test_payment_key'});
 assert.equal(calls[1].url,'https://api.tosspayments.com/v1/payments/test_payment_key');
 assert.equal(calls[1].options.method,'GET');
});
test('Toss adapter refuses missing keys, malformed payment and PG rejection',async()=>{
 assert.throws(()=>makeTossPaymentAdapter({secretKey:''}),/not configured/);
 const adapter=makeTossPaymentAdapter({
  secretKey:'test_sk_example_not_live',
  fetchImpl:async()=>({ok:false,status:403})
 });
 await assert.rejects(adapter.confirm({
  paymentKey:'short',orderId:'WITHU123',amountKrw:29000
 }),/Invalid verified-order/);
 await assert.rejects(adapter.confirm({
  paymentKey:'test_payment_key',orderId:'WITHU123',amountKrw:1
 }),/Toss Payments API rejected/);
});
