import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeFirestoreOrderStore} from '../src/firestore-order-store.mjs';
import {ORDER_STATES} from '../src/commerce.mjs';

function fixture(){
  const data=new Map();
  let chain=Promise.resolve();
  const ref=(name,id)=>({
    key:name+'/'+id,
    async get(){return snapshot(data.get(this.key));}
  });
  const snapshot=value=>({
    exists:value!==undefined,
    data:()=>structuredClone(value)
  });
  const db={
    collection:name=>({doc:id=>ref(name,id)}),
    async runTransaction(fn){
      const previous=chain;
      let release;
      chain=new Promise(done=>{release=done;});
      await previous;
      const updates=[];
      const tx={
        get:async r=>snapshot(data.get(r.key)),
        create(r,v){updates.push(['create',r.key,v]);},
        set(r,v,options){updates.push(['set',r.key,v,options]);},
        update(r,v){updates.push(['update',r.key,v]);}
      };
      try{
        const outcome=await fn(tx);
        for(const [op,key,value,options] of updates){
          if(op==='create'&&data.has(key))throw new Error('Duplicate Firestore document');
          const original=data.get(key)||{};
          if(op==='update'&&!data.has(key))throw new Error('Missing Firestore document');
          data.set(key,structuredClone(op==='update'||(op==='set'&&options?.merge)
            ?{...original,...value}:value));
        }
        return outcome;
      }finally{release();}
    }
  };
  const FieldValue={serverTimestamp:()=>'[SERVER_TIMESTAMP]'};
  return {db,data,orders:makeFirestoreOrderStore({db,FieldValue,now:()=>1000000})};
}
function pending(overrides={}){
  return {
    id:'WITHU_test000000000000000000000001',ownerUid:'buyer-uid',
    customerEmail:'buyer@example.test',productId:'audio',
    amountKrw:29000,currency:'KRW',state:ORDER_STATES.PAYMENT_PENDING,
    ...overrides
  };
}
const requestId='0a1b2c3d-aaaa-4bbb-8ccc-123456789012';
const paymentKey='valid-payment-key-0001';
const fields=orderId=>({
  orderId,paymentKey,amountKrw:29000,
  expectedState:ORDER_STATES.PAYMENT_PENDING,nextState:ORDER_STATES.PAID,
  route:'manual_operator',jobKey:'fulfill:'+orderId,
  songPlan:{version:1,songs:[{index:1}]}
});

test('same requestId creates exactly one order across duplicate checkout calls',async()=>{
  const {orders,data}=fixture();
  const first=await orders.createOnce({order:pending(),requestId});
  const second=await orders.createOnce({order:pending({id:'WITHU_different0000000000000000001'}),requestId});
  assert.equal(first.duplicate,false);
  assert.equal(second.duplicate,true);
  assert.equal(second.order.id,first.order.id);
  assert.equal([...data.keys()].filter(x=>x.startsWith('withuOrders/')).length,1);
});
test('checkout order creation is rate limited per buyer',async()=>{
  const {orders}=fixture();
  for(let i=0;i<5;i++)await orders.createOnce({
    order:pending({id:'WITHU_'+String(i).padStart(32,'0')}),
    requestId:'0a1b2c3d-aaaa-4bbb-8ccc-'+String(i).padStart(12,'0')
  });
  await assert.rejects(orders.createOnce({
    order:pending({id:'WITHU_overlimit000000000000000000'}),
    requestId:'0a1b2c3d-aaaa-4bbb-8ccc-999999999999'
  }),/CHECKOUT_RATE_LIMITED/);
});
test('concurrent payment confirmation reserves one payment key and rejects other keys',async()=>{
  const {orders}=fixture();
  const order=pending();
  await orders.createOnce({order,requestId});
  assert.deepEqual(await Promise.all([
    orders.reserveConfirmationAtomic({orderId:order.id,paymentKey}),
    orders.reserveConfirmationAtomic({orderId:order.id,paymentKey})
  ]),['reserved','busy']);
  await assert.rejects(orders.reserveConfirmationAtomic({
    orderId:order.id,paymentKey:'DIFFERENT_KEY_000000'
  }),/ORDER_ALREADY_BOUND_TO_ANOTHER_PAYMENT/);
});
test('paid transition and fulfillment outbox insert are atomic and idempotent',async()=>{
  const {orders,data}=fixture();
  const order=pending();
  await orders.createOnce({order,requestId});
  await orders.reserveConfirmationAtomic({orderId:order.id,paymentKey});
  const params=fields(order.id);
  assert.deepEqual(await orders.confirmPaidAndEnqueueAtomic(params),
    {outcome:'created',route:'manual_operator'});
  assert.deepEqual(await orders.confirmPaidAndEnqueueAtomic(params),
    {outcome:'duplicate',route:'manual_operator'});
  const paid=await orders.getById(order.id);
  assert.equal(paid.state,ORDER_STATES.PAID);
  assert.equal(paid.paymentKey,paymentKey);
  assert.equal([...data.keys()].filter(x=>x.startsWith('withuFulfillmentOutbox/')).length,1);
  await assert.rejects(orders.confirmPaidAndEnqueueAtomic({
    ...params,paymentKey:'ANOTHER_PAYMENT_KEY'
  }),/Paid order inconsistency/);
});
test('unreserved or changed-amount payment cannot reach atomic paid/outbox transaction',async()=>{
  const {orders,data}=fixture();
  const order=pending();
  await orders.createOnce({order,requestId});
  await assert.rejects(orders.confirmPaidAndEnqueueAtomic(fields(order.id)),
    /Concurrent or mismatched/);
  await orders.reserveConfirmationAtomic({orderId:order.id,paymentKey});
  await assert.rejects(orders.confirmPaidAndEnqueueAtomic({
    ...fields(order.id),amountKrw:1
  }),/Concurrent or mismatched/);
  assert.equal([...data.keys()].filter(x=>x.startsWith('withuFulfillmentOutbox/')).length,0);
});
test('virtual account issuance stays unpaid and stores original key for future reconciliation',async()=>{
  const {orders,data}=fixture();
  const order=pending();
  await orders.createOnce({order,requestId});
  await orders.reserveConfirmationAtomic({orderId:order.id,paymentKey});
  await orders.recordPendingDepositAtomic({orderId:order.id,paymentKey,
    providerSecret:'server-only-token'});
  const current=await orders.getById(order.id);
  assert.equal(current.state,ORDER_STATES.PAYMENT_PENDING);
  assert.equal(current.issuedPaymentKey,paymentKey);
  assert.equal(current.issuedDepositSecret,'server-only-token');
  assert.equal([...data.keys()].filter(x=>x.startsWith('withuFulfillmentOutbox/')).length,0);
});
test('Firestore client rules deny customer/order/outbox direct reads and writes',()=>{
  const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  assert.match(rules,/match \/withuOrders\/\{id\}/);
  assert.match(rules,/match \/withuFulfillmentOutbox\/\{id\}/);
  const allows=[...rules.matchAll(/allow\s+(?:read|write|[\w, ]+):\s*if\s+([^;]+);/g)];
  assert.ok(allows.length>=5);
  assert.ok(allows.every(m=>m[1].trim()==='false'));
});
test('release requires explicit reviewed code change and never ships secret key in public pages',()=>{
  const functions=readFileSync(new URL('../firebase/functions.mjs',import.meta.url),'utf8');
  assert.match(functions,/const REVIEWED_FOR_LIVE_CHARGES=false/);
  const publicCode=[
    'docs/payment-live.js','docs/payment-success.js','docs/withu-payment-public-config.js'
  ].map(f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')).join('\n');
  assert.doesNotMatch(publicCode,/\bTOSS_SECRET_KEY\b/);
  assert.doesNotMatch(publicCode,/api\.tosspayments\.com\/v1\/payments\/confirm/);
  assert.match(publicCode,/confirmWithuPayment/);
});
