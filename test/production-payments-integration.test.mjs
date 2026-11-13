import test from 'node:test';
import assert from 'node:assert/strict';
import {handleProductionPayments} from '../src/production-payments.mjs';

const ID='withu_'+'a'.repeat(32);
const KEY='pg_payment_mock_987654321';
const UUID='6a183d5a-704a-44c3-a47b-851cc7139d62';

const env=Object.freeze({
 WITHU_PAYMENT_MODE:'test',
 TOSS_CLIENT_KEY:'test_gck_mock_public_key',
 TOSS_SECRET_KEY:'test_gsk_mock_private_key',
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',
 RESEND_API_KEY:'re_mock_only',
 WITHU_FROM_EMAIL:'WITHU <music@example.com>',
 WITHU_LINK_ENCRYPTION_KEY:'a'.repeat(64),
 WITHU_ADMIN_UID:'testoperator123',
 WITHU_OPERATOR_EMAIL:'operator@example.com',
 WITHU_STORAGE_BUCKET:'example.appspot.com',
 WITHU_FIREBASE_WEB_API_KEY:'firebase_mock_key',
 WITHU_FIREBASE_AUTH_DOMAIN:'example.firebaseapp.com',
 WITHU_FIREBASE_PROJECT_ID:'example'
});

function startingOrder(overrides={}){
 return {
  id:ID,amountKrw:29000,currency:'KRW',
  state:'payment_pending',paymentStatus:'pending',
  paymentVerifiedAt:null,confirmLockUntil:0,
  confirmationKey:UUID,production:{status:'not_started',attempts:0},
  ...overrides
 };
}

function makeFakeDb(order){
 const records=new Map([['withuOrders/'+ID,structuredClone(order)]]);
 const at=path=>records.get(path);
 const apply=(path,patch)=>{
  const current=at(path);
  if(!current)throw new Error('Missing record '+path);
  for(const [k,value] of Object.entries(patch)){
   if(k.includes('.')){
    const parts=k.split('.');
    let child=current;
    for(const part of parts.slice(0,-1))child=child[part]??={};
    child[parts.at(-1)]=structuredClone(value);
   }else current[k]=structuredClone(value);
  }
 };
 const ref=path=>({
  path,
  get:async()=>({exists:records.has(path),data:()=>structuredClone(at(path))}),
  update:async patch=>apply(path,patch)
 });
 return {
  collection:name=>({doc:id=>ref(name+'/'+id)}),
  runTransaction:async fn=>{
   const writes=[];
   const tx={
    get:async r=>({exists:records.has(r.path),data:()=>structuredClone(at(r.path))}),
    update:(r,patch)=>writes.push(()=>apply(r.path,patch)),
    create:(r,value)=>writes.push(()=>records.set(r.path,structuredClone(value))),
    set:(r,value)=>writes.push(()=>records.set(r.path,structuredClone(value)))
   };
   const result=await fn(tx);
   writes.forEach(write=>write());
   return result;
  },
  order:()=>structuredClone(at('withuOrders/'+ID))
 };
}

function request(amount=29000,paymentKey=KEY){
 const body={orderId:ID,paymentKey,amount};
 return {
  method:'POST',originalUrl:'/api/payments/confirm',
  body,rawBody:Buffer.from(JSON.stringify(body)),
  is:type=>type==='application/json',
  get:name=>name==='origin'?'https://withu.example':undefined
 };
}

function response(){
 return {
  statusCode:0,body:null,
  set(){return this;},
  status(code){this.statusCode=code;return this;},
  json(payload){this.body=payload;return this;}
 };
}

function pgReceipt(patch={}){
 return {orderId:ID,paymentKey:KEY,status:'DONE',
  currency:'KRW',totalAmount:29000,balanceAmount:29000,...patch};
}

test('pending order always reaches actual Toss confirmation before paid response',async()=>{
 const db=makeFakeDb(startingOrder()),res=response(),calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  return {ok:true,status:200,json:async()=>pgReceipt()};
 };
 const handled=await handleProductionPayments(request(),res,{db,env,fetcher});
 assert.equal(handled,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.tosspayments.com/v1/payments/confirm');
 assert.equal(calls[0].options.headers['Idempotency-Key'],UUID);
 assert.deepEqual(JSON.parse(calls[0].options.body),
  {paymentKey:KEY,orderId:ID,amount:29000});
 assert.equal(res.statusCode,200);
 assert.equal(res.body.status,'paid_verified');
 assert.equal(res.body.already,undefined);
 assert.equal(db.order().paymentStatus,'paid');
 assert.equal(db.order().production.status,'pending');
 assert.equal(db.order().paymentKey,KEY);
 assert.ok(db.order().paymentVerifiedAt>0);
});

test('replaying the same previously verified payment is idempotent and never confirms twice',async()=>{
 const db=makeFakeDb(startingOrder()),callCount={value:0};
 const fetcher=async()=>{
  callCount.value++;
  return {ok:true,status:200,json:async()=>pgReceipt()};
 };
 await handleProductionPayments(request(),response(),{db,env,fetcher});
 const res=response();
 await handleProductionPayments(request(),res,{db,env,fetcher});
 assert.equal(callCount.value,1);
 assert.equal(res.body.status,'paid_verified');
 assert.equal(res.body.already,true);
 assert.equal(db.order().production.status,'pending');
});

test('failed gateway approval must never return paid_verified or change paymentStatus',async()=>{
 const db=makeFakeDb(startingOrder()),res=response();
 let calls=0;
 const fetcher=async()=>{calls++;return {ok:false,status:403};};
 await assert.rejects(
  handleProductionPayments(request(),res,{db,env,fetcher}),
  /Toss Payments API rejected/
 );
 assert.equal(calls,2); // POST confirmation, then GET recovery
 assert.equal(res.body,null);
 assert.equal(db.order().paymentStatus,'pending');
 assert.equal(db.order().production.status,'not_started');
});

test('gateway receipt with wrong amount is rejected even when HTTP 200',async()=>{
 const db=makeFakeDb(startingOrder()),res=response();
 const fetcher=async()=>({
  ok:true,status:200,json:async()=>pgReceipt({totalAmount:1})
 });
 await assert.rejects(
  handleProductionPayments(request(),res,{db,env,fetcher}),
  /Toss receipt fails/
 );
 assert.equal(res.body,null);
 assert.equal(db.order().paymentStatus,'pending');
 assert.equal(db.order().paymentReviewRequired,true);
 assert.equal(db.order().confirmLockUntil,0);
});

test('browser-claimed amount cannot bypass server price',async()=>{
 const db=makeFakeDb(startingOrder()),res=response();
 let calls=0;
 await assert.rejects(
  handleProductionPayments(request(1000),res,{
   db,env,fetcher:async()=>{calls++;throw Error('must not be called');}
  }),
  /주문서와 결제 금액이 일치하지 않습니다/
 );
 assert.equal(calls,0);
 assert.equal(db.order().paymentStatus,'pending');
});

test('previously paid orders refuse a different payment key',async()=>{
 const db=makeFakeDb(startingOrder({paymentStatus:'paid',state:'paid',
  paymentKey:KEY,paymentVerifiedAt:Date.now()})),res=response();
 let calls=0;
 await assert.rejects(
  handleProductionPayments(request(29000,'other_payment_token_abc'),res,{
   db,env,fetcher:async()=>{calls++;throw Error('not expected');}
  }),
  /다른 결제키로 승인된 주문입니다/
 );
 assert.equal(calls,0);
 assert.equal(db.order().paymentKey,KEY);
});
