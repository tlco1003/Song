import test from 'node:test';
import assert from 'node:assert/strict';
import {processVerifiedPaidWork} from '../src/production-worker.mjs';
import {pollMurekaMusicJobs} from '../src/mureka-paid-automation.mjs';
const ID='withu_'+'e'.repeat(32);
const lyrics='[Verse 1]\n엄마 언제나 고마워요\n[Chorus]\n우리 오래 함께해요';
const order={
 id:ID,productId:'audio',state:'paid',paymentStatus:'paid',
 paymentVerifiedAt:1700000000000,paymentKey:'verified_pg_9876',
 currency:'KRW',amountKrw:29000,tracks:[],
 production:{status:'pending',attempts:0},
 delivery:{status:'not_sent'},
 contact:{customerEmail:'test-recipient@example.com',deliveryChannel:'email'},
 genreSelection:{mode:'single',genres:['발라드']},
 confirmedLyrics:lyrics,
 draft:{
  title:'엄마에게',mood:'따뜻한',eraPreference:'auto',lyricLength:'full',
  delivery:{recipientAgeGroup:'50s',speechStyle:'polite'},
  story:{recipient:'엄마'},trackPreferences:[{
   mood:'따뜻한',eraPreference:'auto'
  }]
 }
};
const env={
 WITHU_AUTOMATED_MUSIC_PROVIDER:'mureka',
 MUREKA_API_KEY:'mureka_private_test_key_not_real',
 WITHU_ADMIN_UID:'operator_uid_test_987',
 WITHU_MUREKA_AUDIO_HOST_ALLOWLIST:'verified-cdn.example',
 WITHU_PUBLIC_BASE_URL:'https://example.com/',
 WITHU_LINK_ENCRYPTION_KEY:'1'.repeat(64),
 RESEND_API_KEY:'resend_fake_key_for_tests',
 WITHU_FROM_EMAIL:'WITHU <music@example.com>',
 WITHU_OPERATOR_EMAIL:'operator@example.com'
};
const rights={
 providerId:'mureka',model:'mureka-9.5',
 status:'approved',verifiedByUid:env.WITHU_ADMIN_UID,
 allowedUseCases:['customer_specific_paid_music_delivery'],
 privateEvidenceRef:'private/legal/mureka-api-evidence-2026',
 verifiedAt:Date.now()-60000,validUntil:Date.now()+86400000
};
function fixture(){
 const data=new Map([
  ['withuOrders/'+ID,structuredClone(order)],
  ['withuProviderApprovals/mureka',structuredClone(rights)]
 ]);
 const clone=v=>structuredClone(v);
 const snapshot=path=>({exists:data.has(path),data:()=>clone(data.get(path))});
 function patch(path,updates){
  const obj=data.get(path);
  if(!obj)throw Error('missing '+path);
  for(const [key,value] of Object.entries(updates)){
   let t=obj;const pieces=key.split('.');
   for(const part of pieces.slice(0,-1))t=t[part]??={};
   t[pieces.at(-1)]=clone(value);
  }
 }
 const ref=path=>({
  path,get:async()=>snapshot(path),
  create:async o=>{
   if(data.has(path))throw Error('duplicate');
   data.set(path,clone(o));
  },update:async o=>patch(path,o)
 });
 const db={
  collection:name=>({
   doc:id=>ref(name+'/'+id),
   where:(field,op,list)=>({limit:max=>({get:async()=>({
    docs:[...data.entries()].filter(([path,value])=>
     path.startsWith(name+'/')&&(op==='in'?list.includes(value[field]):list===value[field]))
     .slice(0,max).map(([path,value])=>({
      ref:ref(path),data:()=>clone(value)
     }))
   })})})
  }),
  runTransaction:async fn=>{
   const updates=[];let writing=false;
   const tx={
    get:async x=>{
     if(writing)throw Error('Firestore read-after-write');
     return snapshot(x.path);
    },
    set:(x,value)=>{writing=true;updates.push(()=>data.set(x.path,clone(value)));},
    update:(x,value)=>{writing=true;updates.push(()=>patch(x.path,value));}
   };
   const v=await fn(tx);
   updates.forEach(f=>f());
   return v;
  },
  order:()=>clone(data.get('withuOrders/'+ID))
 };
 const files=new Map();
 const bucket={file:path=>({
  save:async(buffer,options)=>files.set(path,{buffer:Buffer.from(buffer),options})
 })};
 const calls=[];
 const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(2000)]);
 const fetcher=async(url,opts={})=>{
  calls.push({url,opts});
  if(url==='https://api.resend.com/emails')return {
   ok:true,json:async()=>({id:'mail_accepted_test_123'})
  };
  if(url==='https://api.mureka.ai/v1/song/generate')
   return {ok:true,json:async()=>({id:'task_100',status:'preparing',
    model:'mureka-9.5'})};
  if(url==='https://api.mureka.ai/v1/song/query/task_100')
   return {ok:true,json:async()=>({id:'task_100',status:'succeeded',
    model:'mureka-9.5',choices:[{url:'https://verified-cdn.example/song.mp3'}]})};
  if(url==='https://verified-cdn.example/song.mp3')
   return {ok:true,headers:{get:()=>null},arrayBuffer:async()=>mp3};
  throw Error('Unexpected external service '+url);
 };
 return {db,bucket,fetcher,files,calls,env};
}
test('paid order uses existing lyrics and style, schedules Mureka, polls into private review without final mail',async()=>{
 const f=fixture();
 const r=await processVerifiedPaidWork({...f,orderId:ID});
 assert.equal(r.status,'generating_music');
 assert.equal(f.db.order().production.provider,'mureka');
 assert.equal(f.db.order().production.submittedCount,1);
 assert.equal(f.db.order().privateProductionPlan.songs[0].lyrics,lyrics);
 assert.equal(f.files.size,0);
 assert.equal(f.calls.filter(x=>x.url.includes('/v1/song/generate')).length,1);
 assert.equal(f.calls.filter(x=>x.url==='https://api.resend.com/emails').length,2);
 assert.equal(f.db.order().delivery.status,'not_sent');
 const polled=await pollMurekaMusicJobs({...f,clock:()=>Date.now()+1000});
 assert.equal(polled.stored,1);
 assert.equal(f.db.order().tracks[0].reviewed,false);
 assert.equal(f.db.order().tracks[0].rightsVerified,false);
 assert.equal(f.files.size,1);
 assert.equal(f.db.order().production.status,'awaiting_review');
 const repeated=await processVerifiedPaidWork({...f,orderId:ID});
 assert.equal(repeated.status,'skipped');
 assert.equal(f.calls.filter(x=>x.url.includes('/v1/song/generate')).length,1);
});
