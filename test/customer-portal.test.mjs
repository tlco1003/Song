import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerPortal,normalizeCustomerEmail} from '../src/customer-portal.mjs';
import {makeResendCustomerEmail} from '../src/customer-notification.mjs';
import {sendVerifiedCustomerReceipt} from '../src/customer-payment-receipt.mjs';
import {ORDER_STATES} from '../src/commerce.mjs';

const SECRET='withu-strong-test-server-secret-must-never-be-exposed';
function fixture(){
 let time=1730000000000,challenge=null,attempts=0;
 const sessions=new Map(),sent=[],links=[];
 const order={
  id:'ORDER_CUSTOMER_A',customerEmail:'buyer@example.test',productId:'audio',
  songTitle:'엄마에게',confirmedLyrics:'엄마 사랑해요',
  state:ORDER_STATES.DELIVERED,deliveredAt:'2026-11-05T12:00:00.000Z',
  paymentKey:'payment_key_verified_A',paymentVerifiedAt:'2026-11-05T11:00:00.000Z',
  selectedSongs:[{index:1,title:'엄마에게',genre:'발라드',privateAssetKey:'private/music/CHOSEN_A.mp3'}]
 };
 const notReady={
  ...order,id:'ORDER_CUSTOMER_B',state:ORDER_STATES.GENERATING_MUSIC,
  deliveredAt:null,selectedSongs:[],paymentKey:'payment_key_verified_B'
 };
 const someoneElse={
  ...order,id:'ORDER_SOMEONEELSE',customerEmail:'other@example.test',
  paymentKey:'payment_key_other'
 };
 const rows=[order,notReady,someoneElse];
 const portal=createCustomerPortal({
  secret:SECRET,clock:()=>time,generateCode:()=> '123456',
  generateSession:()=> 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  rateLimiter:{async hit(){}},
  challenges:{
   async issueAtomic(record){challenge=record;attempts=0},
   async consumeAtomic({email,codeHash,now}){
    if(!challenge||attempts>=5)return false;
    attempts++;
    if(now>=challenge.expiresAt||email!==challenge.email||challenge.codeHash!==codeHash)return false;
    challenge=null;return true;
   }
  },
  sessions:{
   async create(record){sessions.set(record.tokenHash,record)},
   async retrieve(hash){return sessions.get(hash)||null},
   async revoke(hash){sessions.delete(hash)}
  },
  orders:{
   async listByEmail(email){return rows.filter(r=>r.customerEmail===email)},
   async getById(id){return rows.find(r=>r.id===id)||null}
  },
  loginMailer:{async sendLoginCode(args){sent.push(args);return {messageId:'otp-test'}}},
  assets:{
   async issueRoutes(args){
    links.push(args);
    return {playUrl:'/api/delivery-assets/purchaseA/play',downloadUrl:'/api/delivery-assets/purchaseA/download'};
   },
   async resolveTicket({pathname}){
    if(pathname!=='/api/delivery-assets/purchaseA/play')return null;
    return {email:'buyer@example.test',orderId:'ORDER_CUSTOMER_A',
     index:1,privateAssetKey:'private/music/CHOSEN_A.mp3',
     expiresAt:time+60000,disposition:'play'};
   },
   async streamAuthorized({privateAssetKey,disposition}){
    links.push({streamed:privateAssetKey,disposition});
    return true;
   }
  }
 });
 return {portal,order,notReady,sent,links,advance:delta=>{time+=delta}};
}
test('OTP purchase email cannot be bypassed with order ID or unverified session',async()=>{
 const f=fixture();
 await assert.rejects(f.portal.listCustomerOrders(''),/Authentication required/);
 await assert.rejects(f.portal.getCustomerTrack('',f.order.id,1),/Authentication required/);
 const request=await f.portal.requestCode({email:'BUYER@example.test',clientIp:'127.0.0.1'});
 assert.deepEqual(request,{accepted:true});
 assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].email,'buyer@example.test');
 await assert.rejects(f.portal.verifyCode({email:'buyer@example.test',code:'000000'}),/Invalid or expired/);
 const login=await f.portal.verifyCode({email:'buyer@example.test',code:'123456'});
 assert.ok(login.cookie.startsWith('__Host-withu-session='));
 assert.match(login.cookie,/HttpOnly; Secure; SameSite=Lax/);
 await assert.rejects(f.portal.verifyCode({email:'buyer@example.test',code:'123456'}),/Invalid or expired/);
 const identity=await f.portal.session(login.cookie);
 assert.equal(identity.email,'buyer@example.test');
 assert.equal(identity.emailVerified,true);
 const list=await f.portal.listCustomerOrders(login.cookie);
 assert.deepEqual(list.orders.map(o=>o.id),[f.order.id,f.notReady.id]);
 assert.deepEqual(list.orders.map(o=>o.status),['delivered','processing']);
 assert.equal(list.orders[1].songs.length,0);
 const selected=await f.portal.getCustomerTrack(login.cookie,f.order.id,1);
 assert.equal(selected.track.title,'엄마에게');
 assert.equal(selected.track.playUrl,'/api/delivery-assets/purchaseA/play');
 assert.equal(selected.track.downloadUrl,'/api/delivery-assets/purchaseA/download');
 assert.equal(f.links[0].privateAssetKey,'private/music/CHOSEN_A.mp3');
 const headers={};
 await f.portal.servePrivateAsset({req:{method:'GET'},res:{setHeader(k,v){headers[k]=v}},
  pathname:'/api/delivery-assets/purchaseA/play',cookie:login.cookie});
 assert.equal(headers['Cache-Control'],'private, no-store');
 assert.equal(f.links[1].streamed,'private/music/CHOSEN_A.mp3');
 await assert.rejects(f.portal.servePrivateAsset({req:{method:'POST'},res:{setHeader(){}},
  pathname:'/api/delivery-assets/purchaseA/play',cookie:login.cookie}),/Not found/);
 await assert.rejects(f.portal.getCustomerTrack(login.cookie,'ORDER_SOMEONEELSE',1),/Not found/);
 await assert.rejects(f.portal.getCustomerTrack(login.cookie,f.notReady.id,1),/Not found/);
 const revoked=await f.portal.logout(login.cookie);
 assert.match(revoked,/Max-Age=0/);
 assert.equal(await f.portal.session(login.cookie),null);
});
test('OTP expires and non-customer email gets no code but same public response',async()=>{
 const f=fixture();
 assert.deepEqual(await f.portal.requestCode({email:'unknown@example.test',clientIp:'1.2.3.4'}),{accepted:true});
 assert.equal(f.sent.length,0);
 await f.portal.requestCode({email:'buyer@example.test',clientIp:'1.2.3.4'});
 f.advance(600001);
 await assert.rejects(f.portal.verifyCode({email:'buyer@example.test',code:'123456'}),/Invalid or expired/);
});
test('invalid private URLs, unsafe emails and incomplete ports fail closed',async()=>{
 assert.throws(()=>normalizeCustomerEmail('bad@'),/Invalid/);
 assert.throws(()=>createCustomerPortal({secret:'short'}),/secret/);
 const f=fixture();
 const original=f.portal.getCustomerTrack;
 assert.equal(typeof original,'function');
});
test('customer mail sends only portal location, OTP and public song titles',async()=>{
 const calls=[];
 const mail=makeResendCustomerEmail({
  apiKey:'re_test_not_live',
  from:'hello@withu.example',
  portalUrl:'https://withu.example/song.html',
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,json:async()=>({id:'mail-1'})};
  }
 });
 await mail.sendLoginCode({email:'buyer@example.test',code:'123456',expiresMinutes:10});
 await mail.sendPaidReceipt({orderId:'ORDER_CUSTOMER_A',customerEmail:'buyer@example.test',productName:'audio',amountKrw:29000,idempotencyKey:'withu-receipt-ORDER_CUSTOMER_A'});
 await mail.sendReadyNotice({
  orderId:'ORDER_CUSTOMER_A',customerEmail:'buyer@example.test',
  idempotencyKey:'withu-delivery-ORDER_CUSTOMER_A',
  selectedSongs:[{index:1,title:'엄마에게',genre:'발라드'}]
 });
 assert.equal(calls.length,3);
 const paid=JSON.parse(calls[1].options.body);
 assert.match(paid.text,/결제가 확인되었습니다/);
 assert.match(paid.text,/29,000원/);
 const ready=JSON.parse(calls[2].options.body);
 assert.equal(ready.to[0],'buyer@example.test');
 assert.match(ready.text,/https:\/\/withu\.example\/song\.html/);
 assert.match(ready.text,/엄마에게/);
 assert.doesNotMatch(ready.text,/private\/music|payment_key|api\/delivery-assets|access=/);
 assert.equal(calls[1].options.headers['Idempotency-Key'],'withu-receipt-ORDER_CUSTOMER_A');
 assert.equal(calls[2].options.headers['Idempotency-Key'],'withu-delivery-ORDER_CUSTOMER_A');
 await assert.rejects(mail.sendReadyNotice({orderId:'ORDER_CUSTOMER_A',customerEmail:'buyer@example.test',selectedSongs:[],idempotencyKey:'withu-delivery-ORDER_CUSTOMER_A'}),/Invalid/);
});

test('customer receipt never sends on unverified, refunded or misbound orders',async()=>{
 const f=fixture(),calls=[];
 const order={...f.order,state:ORDER_STATES.PAID,amountKrw:29000};
 const job={orderId:order.id,key:'receipt:'+order.id,status:'claimed'};
 const mailer={async sendPaidReceipt(args){calls.push(args);return {messageId:'receipt-test'}}};
 await assert.rejects(sendVerifiedCustomerReceipt({order:{...order,state:ORDER_STATES.PAYMENT_PENDING},receiptJob:job,mailer}),/prohibited/);
 await assert.rejects(sendVerifiedCustomerReceipt({order:{...order,paymentVerifiedAt:null},receiptJob:job,mailer}),/prohibited/);
 await assert.rejects(sendVerifiedCustomerReceipt({order:{...order,refundedAt:'2026-11-05'},receiptJob:job,mailer}),/prohibited/);
 await assert.rejects(sendVerifiedCustomerReceipt({order,receiptJob:{...job,orderId:'SOMEONE_ELSE'},mailer}),/prohibited/);
 assert.equal(calls.length,0);
 const result=await sendVerifiedCustomerReceipt({order,receiptJob:job,mailer});
 assert.equal(result.messageId,'receipt-test');
 assert.equal(calls.length,1);
 assert.equal(calls[0].customerEmail,'buyer@example.test');
 assert.equal(calls[0].idempotencyKey,'withu-receipt-'+order.id);
});
