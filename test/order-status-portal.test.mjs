import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizePaidOrder,sendPaidOrderReceipt,handleOrderStatus} from '../src/order-status-portal.mjs';
import {makeProductionId,tokenHash,makeOpaqueToken} from '../src/production-contract.mjs';
import {encodeSecret} from '../src/production-runtime.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const order={paymentStatus:'paid',paymentKey:'pg_valid',paymentVerifiedAt:176000000,
 productId:'audio',production:{status:'manual_required',lyricsReady:true},
 confirmedLyrics:'[Verse 1] test',delivery:{status:'not_sent'},tracks:[]};
test('status response includes payment but never exposes customer contacts or files',()=>{
 const s=summarizePaidOrder(order);
 assert.equal(s.status,'in_production');assert.equal(s.steps.delivery,'pending');
 assert.equal(s.listeningUrl,undefined);assert.equal(s.customerEmail,undefined);
});
test('final status does not require a customer download grant',()=>{
 const s=summarizePaidOrder({...order,delivery:{status:'sent'}});
 assert.equal(s.status,'delivered');assert.equal(s.steps.delivery,'completed');
});
test('receipt API requires a paid order and scoped 43-character bearer token',()=>{
 const s=read('src/order-status-portal.mjs');
 assert.match(s,/paid\(order\)/);assert.match(s,/withuStatusLinks/);
 assert.match(s,/checkOrigin\(req,env\)/);assert.match(s,/tokenHash\(token\)/);
 assert.match(read('docs/order-status.js'),/api\/order-status\/resolve/);
});

/* In-memory Firestore contract stub: tests real receipt + status handler behavior
 * without contacting Resend or claiming that production email was delivered. */
function fakeFirestore(orderId,order){
 const rows=new Map([['withuOrders/'+orderId,structuredClone(order)]]);
 const snapshot=key=>({exists:rows.has(key),data:()=>structuredClone(rows.get(key))});
 const apply=(key,patch)=>{
  const old=rows.get(key)||{};
  for(const [k,v] of Object.entries(patch)){
   const parts=k.split('.');let cursor=old;
   for(let i=0;i<parts.length-1;i++)cursor=cursor[parts[i]]??={};
   cursor[parts.at(-1)]=v;
  }
  rows.set(key,old);
 };
 const db={
  collection:name=>({doc:id=>({
   key:name+'/'+id,
   async get(){return snapshot(this.key)},
   async update(patch){apply(this.key,patch)}
  })}),
  async runTransaction(fn){
   return fn({
    get:async doc=>snapshot(doc.key),
    update:(doc,patch)=>apply(doc.key,patch),
    set:(doc,data)=>rows.set(doc.key,structuredClone(data))
   });
  }
 };
 return {rows,db};
}
function statusRequest(token,{origin='https://withu.example'}={}){
 const body={token};
 return {
  method:'POST',originalUrl:'/api/order-status/resolve',
  body,rawBody:Buffer.from(JSON.stringify(body)),
  is:type=>type==='application/json',
  get:key=>key==='origin'?origin:undefined
 };
}
function statusResponse(){
 return {
  code:0,result:null,
  set(){return this},
  status(code){this.code=code;return this},
  json(body){this.result=body;return this}
 };
}
const emailEnv={
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',
 WITHU_LINK_ENCRYPTION_KEY:'a'.repeat(64),
 RESEND_API_KEY:'re_fake_unit_test',
 WITHU_FROM_EMAIL:'WITHU <music@withu.example>'
};
test('verified payment produces one protected status email and a private pending status',async()=>{
 const id=makeProductionId();
 const {db,rows}=fakeFirestore(id,{...order,id,contact:{customerEmail:'buyer@example.test'}});
 let sent=0,emailBody;
 const fetcher=async(url,args)=>{
  assert.equal(url,'https://api.resend.com/emails');
  sent++;emailBody=JSON.parse(args.body);
  return {ok:true,async json(){return {id:'resend-test-receipt-id'}}};
 };
 const receipt=await sendPaidOrderReceipt({db,orderId:id,env:emailEnv,fetcher});
 assert.equal(receipt.status,'provider_accepted_not_inbox_verified');
 assert.equal(sent,1);
 assert.deepEqual(emailBody.to,['buyer@example.test']);
 assert.match(emailBody.text,/order-status\.html#status=/);
 const token=emailBody.text.match(/#status=([A-Za-z0-9_-]{43})/)[1];
 const doc=rows.get('withuOrders/'+id);
 assert.equal(doc.statusReceipt.status,'sent');
 assert.equal(doc.statusReceipt.tokenHash,tokenHash(token));
 assert.equal(rows.get('withuStatusLinks/'+tokenHash(token)).orderId,id);
 const response=statusResponse();
 assert.equal(await handleOrderStatus(statusRequest(token),response,{db,env:emailEnv}),true);
 assert.equal(response.code,200);
 assert.equal(response.result.status,'in_production');
 assert.equal(response.result.listeningUrl,null);
 assert.equal(response.result.customerEmail,undefined);
 assert.equal(response.result.privateMediaUrl,undefined);
 const retry=await sendPaidOrderReceipt({db,orderId:id,env:emailEnv,fetcher});
 assert.equal(retry.status,'already_sent');
 assert.equal(sent,1);
 const finalToken=makeOpaqueToken();
 doc.delivery={status:'sent',tokenHash:tokenHash(finalToken),
  encryptedToken:encodeSecret(finalToken,emailEnv.WITHU_LINK_ENCRYPTION_KEY),
  expiresAt:Date.now()+60000};
 rows.set('withuOrders/'+id,doc);
 const completed=statusResponse();
 await handleOrderStatus(statusRequest(token),completed,{db,env:emailEnv});
 assert.equal(completed.result.status,'delivered');
 assert.equal(completed.result.listeningUrl,
  'https://withu.example/my-music.html#delivery='+finalToken);
 const expired=rows.get('withuStatusLinks/'+tokenHash(token));
 expired.expiresAt=Date.now()-1;
 rows.set('withuStatusLinks/'+tokenHash(token),expired);
 await assert.rejects(
  handleOrderStatus(statusRequest(token),statusResponse(),{db,env:emailEnv}),
  {status:403}
 );
 await assert.rejects(
  handleOrderStatus(statusRequest(token,{origin:'https://attacker.example'}),statusResponse(),{db,env:emailEnv}),
  {status:403}
 );
});
test('unpaid orders cannot receive a receipt email',async()=>{
 const id=makeProductionId(),{db}=fakeFirestore(id,{
  ...order,paymentStatus:'pending',paymentVerifiedAt:null,
  contact:{customerEmail:'buyer@example.test'}
 });
 let calls=0;
 await assert.rejects(sendPaidOrderReceipt({db,orderId:id,env:emailEnv,
  fetcher:async()=>{calls++;throw Error('unexpected')}}),{status:403});
 assert.equal(calls,0);
});
