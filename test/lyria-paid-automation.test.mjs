import test from 'node:test';
import assert from 'node:assert/strict';
import {runLyriaPaidAutomation,configuredLyriaAutoMode,verifyLyriaRightsRecord}
 from '../src/lyria-paid-automation.mjs';

const ID='withu_'+'b'.repeat(32);
const env={
 WITHU_AUTOMATED_MUSIC_PROVIDER:'google_lyria',
 WITHU_ADMIN_UID:'admin_uid_12345',
 GEMINI_API_KEY:'fake_gemini_api_key_testing_only'
};
const song={index:1,title:'마음의 노래',genre:'발라드',
 lyrics:'[Verse 1]\n사랑하는 우리 엄마\n고마워요 늘 함께해요',
 stylePrompt:'An original slow Korean ballad. Acoustic piano, cello.'};
const paidOrder={id:ID,productId:'audio',paymentStatus:'paid',
 paymentKey:'toss_verified_key_123',paymentVerifiedAt:1700000000000,
 delivery:{status:'not_sent'},tracks:[]};
const audio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(2000)]).toString('base64');
const response={steps:[{type:'model_output',content:[{type:'audio',data:audio}]}]};
const approval=()=>({
 providerId:'google_lyria',model:'lyria-3.5',status:'approved',
 verifiedByUid:env.WITHU_ADMIN_UID,
 allowedUseCases:['customer_specific_paid_music_delivery'],
 privateEvidenceRef:'private/legal/google-lyria-agreement-2026',
 verifiedAt:Date.now()-60000,validUntil:Date.now()+86400000
});
function fakeDb({rights=approval(),order=paidOrder}={}){
 const store=new Map([['withuOrders/'+ID,structuredClone(order)]]);
 if(rights)store.set('withuProviderApprovals/google_lyria',rights);
 const snap=path=>({exists:store.has(path),data:()=>structuredClone(store.get(path))});
 const patch=(path,value)=>Object.assign(store.get(path),structuredClone(value));
 const doc=path=>({
  path,get:async()=>snap(path),
  create:async(value)=>{if(store.has(path))throw Error('already exists');
   store.set(path,structuredClone(value));},
  update:async(value)=>patch(path,value)
 });
 return {
  collection:name=>({doc:id=>doc(name+'/'+id)}),
  runTransaction:async(fn)=>{
   const writes=[];
   const tx={
    get:async(ref)=>snap(ref.path),
    update:(ref,value)=>writes.push(()=>patch(ref.path,value))
   };
   const result=await fn(tx);
   for(const write of writes)write();
   return result;
  },
  readOrder:()=>structuredClone(store.get('withuOrders/'+ID)),
  readJob:()=>structuredClone(store.get('withuMusicJobs/'+ID+'_1'))
 };
}
const fakeBucket=()=>{
 const assets=new Map();
 return {
  assets,file:path=>({
   save:async(bytes,meta)=>assets.set(path,{bytes:Buffer.from(bytes),meta})
  })
 };
};
const requestPayload=()=>({db:fakeDb(),bucket:fakeBucket(),orderId:ID,
 order:structuredClone(paidOrder),plan:{version:2,songs:[song]},env});

test('automatic branch is disabled unless explicitly selected',()=>{
 assert.equal(configuredLyriaAutoMode({}),false);
 assert.equal(configuredLyriaAutoMode(env),true);
});
test('operator-reviewed private rights record must match model, scope and validity',()=>{
 assert.equal(verifyLyriaRightsRecord(approval(),{adminUid:env.WITHU_ADMIN_UID}),true);
 assert.equal(verifyLyriaRightsRecord({...approval(),validUntil:Date.now()-1000},{
  adminUid:env.WITHU_ADMIN_UID}),false);
 assert.equal(verifyLyriaRightsRecord({...approval(),allowedUseCases:[]},{
  adminUid:env.WITHU_ADMIN_UID}),false);
 assert.equal(verifyLyriaRightsRecord({...approval(),privateEvidenceRef:''},{
  adminUid:env.WITHU_ADMIN_UID}),false);
});
test('verified paid order generates once, saves to private Storage, never auto-approves or emails',async()=>{
 const db=fakeDb(),bucket=fakeBucket(),calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});return {
  ok:true,json:async()=>response
 };};
 const result=await runLyriaPaidAutomation({
  db,bucket,orderId:ID,order:structuredClone(paidOrder),
  plan:{version:2,songs:[song]},env,fetcher
 });
 assert.equal(result.status,'awaiting_review');
 assert.equal(result.candidateCount,1);
 assert.equal(calls.length,1);
 const order=db.readOrder();
 assert.equal(order.tracks.length,1);
 assert.equal(order.tracks[0].reviewed,false);
 assert.equal(order.tracks[0].rightsVerified,false);
 assert.equal(order.tracks[0].lyrics,song.lyrics);
 assert.match(order.tracks[0].storagePath,new RegExp('^orders/'+ID+'/tracks/1-'));
 assert.equal(bucket.assets.size,1);
 assert.equal(db.readJob().status,'candidate_stored_awaiting_review');
 // Retry after a completed candidate is blocked before spending.
 await assert.rejects(runLyriaPaidAutomation({
  db,bucket,orderId:ID,order:db.readOrder(),
  plan:{version:2,songs:[song]},env,fetcher
 }),/EXISTING_TRACKS_REQUIRE_HUMAN_REVIEW/);
 assert.equal(calls.length,1);
});
test('missing rights record fails before an external call',async()=>{
 const db=fakeDb({rights:null}),bucket=fakeBucket();
 let sent=0;
 await assert.rejects(runLyriaPaidAutomation({
  db,bucket,orderId:ID,order:structuredClone(paidOrder),
  plan:{version:2,songs:[song]},env,
  fetcher:async()=>{sent++;throw Error('should not call');}
 }),/COMMERCIAL_RIGHTS_REVIEW_REQUIRED/);
 assert.equal(sent,0);assert.equal(bucket.assets.size,0);
});
test('unpaid order cannot submit an automatic music job',async()=>{
 const {db,bucket,plan}=requestPayload();
 await assert.rejects(runLyriaPaidAutomation({
  db,bucket,orderId:ID,
  order:{...paidOrder,paymentStatus:'pending'},plan,env
 }),/PAID_ORDER_REQUIRED/);
 assert.equal(bucket.assets.size,0);
});
test('failed provider call remains claimed and is not automatically resubmitted',async()=>{
 const db=fakeDb(),bucket=fakeBucket(),calls={count:0};
 const inputs={db,bucket,orderId:ID,order:structuredClone(paidOrder),
  plan:{version:2,songs:[song]},env,fetcher:async()=>{
   calls.count++;return {ok:false,status:503};
  }};
 await assert.rejects(runLyriaPaidAutomation(inputs),/PROVIDER_REJECTED/);
 assert.equal(db.readJob().status,'submitted');
 await assert.rejects(runLyriaPaidAutomation(inputs),/JOB_ALREADY_CLAIMED_RECONCILE_MANUALLY/);
 assert.equal(calls.count,1);
});
