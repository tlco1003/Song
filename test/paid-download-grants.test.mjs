import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 ensurePaidDownloadGrant,hasDownloadGrant,redeemDownloadRecovery,sendRecoveryEmail
} from '../src/production-download-grants.mjs';
const orderId='withu_'+'a'.repeat(32),intentId='upg_'+'b'.repeat(32);
const env={
 WITHU_LINK_ENCRYPTION_KEY:'c'.repeat(64),
 WITHU_PUBLIC_BASE_URL:'https://music.example/',
 RESEND_API_KEY:'re_test',WITHU_FROM_EMAIL:'WITHU <mail@example.com>'
};
function fixture(){
 const store=new Map();
 const doc=path=>({
  path,
  async get(){return {exists:store.has(path),data:()=>store.get(path)}},
  async update(patch){store.set(path,{...store.get(path),...patch})},
  async create(value){if(store.has(path))throw Error('duplicate');store.set(path,value)}
 });
 const db={
  collection:collection=>({doc:id=>doc(collection+'/'+id)}),
  async runTransaction(fn){
   return fn({
    get:ref=>ref.get(),
    create(ref,v){
     if(store.has(ref.path))throw Error('Duplicate grant');
     store.set(ref.path,v);
    },
    update(ref,v){store.set(ref.path,{...store.get(ref.path),...v})}
   });
  }
 };
 store.set('withuOrders/'+orderId,{
  id:orderId,paymentStatus:'paid',paymentKey:'pay_main',
  paymentVerifiedAt:123,delivery:{status:'sent'},
  upgrade:{paymentStatus:'paid',rightsVerified:true}
 });
 store.set('withuUpgradeIntents/'+intentId,{
  id:intentId,originalOrderId:orderId,paymentStatus:'paid',
  paymentKey:'pay_upgrade',paymentVerifiedAt:456,customerEmail:'buyer@example.com'
 });
 return {db,store};
}
test('verified buyer grant is independent of freely shared listening cookie',async()=>{
 const {db,store}=fixture();
 const res={headers:{},setHeader(k,v){this.headers[k]=v}};
 const grant=await ensurePaidDownloadGrant({db,env,intentId,res});
 assert.equal(grant.orderId,orderId);
 assert.equal(grant.customerEmail,'buyer@example.com');
 assert.match(res.headers['Set-Cookie'],/^withu_download=[A-Za-z0-9_-]{43}; HttpOnly/);
 const cookie=res.headers['Set-Cookie'].split(';')[0];
 assert.equal(await hasDownloadGrant({headers:{cookie}},db,orderId),true);
 assert.equal(await hasDownloadGrant({headers:{cookie}},db,orderId),true);
 assert.equal(await hasDownloadGrant({headers:{cookie:'withu_session=gift'}},db,orderId),false);
 assert.equal(await hasDownloadGrant({headers:{cookie}},db,'withu_'+'d'.repeat(32)),false);
 const replay=await ensurePaidDownloadGrant({db,env,intentId,res});
 assert.equal(replay.token,grant.token);
 assert.equal([...store.keys()].filter(x=>x.startsWith('withuDownloadGrants/')).length,1);
 const recovery={headers:{},setHeader(k,v){this.headers[k]=v}};
 const original=await redeemDownloadRecovery({db,req:{headers:{}},res:recovery,token:grant.token});
 assert.equal(original.id,orderId);
 assert.equal(recovery.headers['Set-Cookie'].length,2);
 assert.equal(recovery.headers['Set-Cookie'][1].split(';')[0],cookie);
});
test('recovery mail goes to paid purchaser and retains a private distinct token',async()=>{
 const {db,store}=fixture();
 const res={setHeader(){}};
 const grant=await ensurePaidDownloadGrant({db,env,intentId,res});
 let sent;
 const receipt=await sendRecoveryEmail({
  db,env,intentId,grant,fetcher:async(url,options)=>{
   sent={url,body:JSON.parse(options.body)};
   return {ok:true,json:async()=>({id:'message_123'})};
  }
 });
 assert.equal(receipt.status,'accepted');
 assert.equal(sent.url,'https://api.resend.com/emails');
 assert.equal(sent.body.to[0],'buyer@example.com');
 assert.ok(sent.body.text.includes(
  'https://music.example/my-music.html#download='+grant.token));
 assert.ok(!sent.body.text.includes('#delivery='));
 assert.equal(store.get('withuUpgradeIntents/'+intentId).recoveryEmailStatus,'accepted');
});
test('no grant is issued when the additional PG payment is not verified',async()=>{
 const {db,store}=fixture();
 store.get('withuUpgradeIntents/'+intentId).paymentStatus='pending';
 await assert.rejects(()=>ensurePaidDownloadGrant({
  db,env,intentId,res:{setHeader(){}}
 }),/실제 추가 결제 승인/);
});
