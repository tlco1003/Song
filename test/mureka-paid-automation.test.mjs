import test from 'node:test';
import assert from 'node:assert/strict';
import {
 configuredMurekaAutoMode,verifyMurekaRightsRecord,
 submitMurekaPaidAutomation,pollMurekaMusicJobs
} from '../src/mureka-paid-automation.mjs';

const ID='withu_'+'d'.repeat(32);
const key='mureka_fake_key_only_for_tests';
const track={index:1,title:'엄마에게',genre:'발라드',
 lyrics:'[Verse 1]\n엄마 고마워요\n[Chorus]\n함께해요 언제나',
 stylePrompt:'Warm Korean piano ballad with intimate cello and original chorus.'};
const plan={version:2,songs:[track]};
const order={id:ID,productId:'audio',paymentStatus:'paid',state:'paid',
 paymentVerifiedAt:1700000000000,paymentKey:'verified_toss_123',
 delivery:{status:'not_sent'},tracks:[],production:{status:'generating_music'},
 privateProductionPlan:plan};
const env={WITHU_AUTOMATED_MUSIC_PROVIDER:'mureka',
 MUREKA_API_KEY:key,WITHU_ADMIN_UID:'withu_operator_verified',
 WITHU_MUREKA_AUDIO_HOST_ALLOWLIST:'verified-cdn.example'};
const rights=()=>({
 providerId:'mureka',model:'mureka-9.5',status:'approved',
 verifiedByUid:env.WITHU_ADMIN_UID,
 allowedUseCases:['customer_specific_paid_music_delivery'],
 privateEvidenceRef:'private/legal/mureka-paid-api-terms-reviewed',
 verifiedAt:Date.now()-30000,validUntil:Date.now()+86400000
});
function mockDB({approval=rights(),orderData=order}={}){
 const map=new Map([['withuOrders/'+ID,structuredClone(orderData)]]);
 if(approval)map.set('withuProviderApprovals/mureka',structuredClone(approval));
 function clone(value){return structuredClone(value);}
 const snapshot=path=>({exists:map.has(path),data:()=>clone(map.get(path))});
 const patch=(path,fields)=>{
  if(!map.has(path))throw Error('Missing record '+path);
  const old=map.get(path);
  for(const [key,value] of Object.entries(fields)){
   const parts=key.split('.');
   let obj=old;
   for(const part of parts.slice(0,-1))obj=obj[part]??={};
   obj[parts.at(-1)]=clone(value);
  }
 };
 const doc=path=>({
  path,get:async()=>snapshot(path),
  create:async fields=>{
   if(map.has(path))throw Error('ALREADY_EXISTS');
   map.set(path,clone(fields));
  },
  update:async fields=>patch(path,fields)
 });
 const db={
  collection:name=>({
   doc:id=>doc(name+'/'+id),
   where:(field,operator,values)=>({
    limit:max=>({
     get:async()=>{
      const docs=[...map.entries()].filter(([path,data])=>
       path.startsWith(name+'/')&&
       (operator==='in'?values.includes(data[field]):data[field]===values))
       .slice(0,max).map(([path,data])=>({
        id:path.split('/').at(-1),ref:doc(path),data:()=>clone(data)
       }));
      return {docs};
     }
    })
   })
  }),
  runTransaction:async fn=>{
   const writes=[];let startedWriting=false;
   const tx={
    get:async ref=>{
     if(startedWriting)throw Error('Firestore transactions must read before write');
     return snapshot(ref.path);
    },
    update:(ref,value)=>{
     startedWriting=true;writes.push(()=>patch(ref.path,value));
    },
    set:(ref,value)=>{
     startedWriting=true;writes.push(()=>map.set(ref.path,clone(value)));
    }
   };
   const result=await fn(tx);
   writes.forEach(write=>write());
   return result;
  },
  order:()=>clone(map.get('withuOrders/'+ID)),
  job:(index=1)=>clone(map.get('withuMusicJobs/'+ID+'_'+index))
 };
 return db;
}
function fakeBucket(){
 const files=new Map();
 return {files,file:path=>({
  save:async(buffer,opts)=>{
   if(files.has(path))throw Error('Already stored GCS generation=0');
   files.set(path,{buffer:Buffer.from(buffer),opts});
  }
 })};
}
const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(2000)]);
function fetchMock({onQuery='succeeded'}={}){
 const calls=[];
 return {
  calls,
  fetcher:async(url,options={})=>{
   calls.push({url,options});
   if(url==='https://api.mureka.ai/v1/song/generate')
    return {ok:true,json:async()=>({id:'10436',status:'preparing',
     model:'mureka-9.5'})};
   if(url==='https://api.mureka.ai/v1/song/query/10436')
    return {ok:true,json:async()=>({
     id:'10436',status:onQuery,model:'mureka-9.5',
     ...(onQuery==='succeeded'?{choices:[{
      id:'single_song_generated_1',
      url:'https://verified-cdn.example/signed/song.mp3?session=abc'
     }]}:{})
    })};
   if(url.startsWith('https://verified-cdn.example/'))
    return {ok:true,headers:{get:k=>k==='content-type'?'audio/mpeg':
     k==='content-length'?String(bytes.length):null},
     arrayBuffer:async()=>bytes};
   throw Error('Unexpected URL '+url);
  }
 };
}
test('Mureka auto mode and specific license are required and do not accept any order',()=>{
 assert.equal(configuredMurekaAutoMode(env),true);
 assert.equal(configuredMurekaAutoMode({}),false);
 assert.equal(verifyMurekaRightsRecord(rights(),{adminUid:env.WITHU_ADMIN_UID}),true);
 assert.equal(verifyMurekaRightsRecord({...rights(),validUntil:0},
  {adminUid:env.WITHU_ADMIN_UID}),false);
 assert.equal(verifyMurekaRightsRecord({...rights(),allowedUseCases:[]},
  {adminUid:env.WITHU_ADMIN_UID}),false);
});
test('post paid Mureka job once, scheduler polls and stores private candidate with no approval',async()=>{
 const db=mockDB(),bucket=fakeBucket(),remote=fetchMock();
 const result=await submitMurekaPaidAutomation({
  db,orderId:ID,order,plan,env,fetcher:remote.fetcher
 });
 assert.equal(result.status,'generating_music');
 assert.equal(result.submittedCount,1);
 assert.equal(db.job().status,'mureka_queued');
 assert.equal(db.job().taskId,'10436');
 assert.equal(remote.calls.length,1);
 await assert.rejects(submitMurekaPaidAutomation({
  db,orderId:ID,order,plan,env,fetcher:remote.fetcher
 }),/MUREKA_JOB_ALREADY_CLAIMED/);
 assert.equal(remote.calls.length,1);
 const polled=await pollMurekaMusicJobs({
  db,bucket,env,fetcher:remote.fetcher,clock:()=>Date.now()+1000
 });
 assert.equal(polled.stored,1);
 assert.equal(db.job().status,'candidate_stored_awaiting_review');
 assert.equal(bucket.files.size,1);
 const saved=db.order();
 assert.equal(saved.production.status,'awaiting_review');
 assert.equal(saved.tracks.length,1);
 assert.equal(saved.tracks[0].source,'mureka');
 assert.equal(saved.tracks[0].reviewed,false);
 assert.equal(saved.tracks[0].rightsVerified,false);
 assert.equal(saved.delivery.status,'not_sent');
 assert.equal(saved.tracks[0].lyrics,track.lyrics);
 assert.equal(saved.confirmedLyrics,undefined);
 const repeat=await pollMurekaMusicJobs({db,bucket,env,fetcher:remote.fetcher});
 assert.equal(repeat.examined,0);
 assert.equal(remote.calls.filter(x=>x.url.endsWith('/v1/song/generate')).length,1);
});
test('Mureka queue stays waiting until provider succeeds and does not publish streaming audio',async()=>{
 const db=mockDB(),bucket=fakeBucket(),remote=fetchMock({onQuery:'running'});
 await submitMurekaPaidAutomation({db,orderId:ID,order,plan,env,fetcher:remote.fetcher});
 const state=await pollMurekaMusicJobs({
  db,bucket,env,fetcher:remote.fetcher,clock:()=>Date.now()+1000
 });
 assert.equal(state.generating,1);
 assert.equal(db.job().status,'mureka_queued');
 assert.equal(bucket.files.size,0);
 assert.equal(db.order().tracks.length,0);
});
test('without reviewed rights or paid order no billed create call may run',async()=>{
 const db=mockDB({approval:null}),remote=fetchMock(),bucket=fakeBucket();
 await assert.rejects(submitMurekaPaidAutomation({
  db,orderId:ID,order,plan,env,fetcher:remote.fetcher
 }),/MUREKA_COMMERCIAL_RIGHTS_REVIEW_REQUIRED/);
 await assert.rejects(submitMurekaPaidAutomation({
  db:mockDB(),orderId:ID,order:{...order,paymentStatus:'unpaid'},
  plan,env,fetcher:remote.fetcher
 }),/MUREKA_PAID_ORDER_REQUIRED/);
 assert.equal(remote.calls.length,0);
 assert.equal(bucket.files.size,0);
});
test('provider submission outcome unknown never triggers automatic paid retry',async()=>{
 const db=mockDB();let calls=0;
 const fetcher=async()=>{calls++;throw Error('Unknown network timeout');};
 await assert.rejects(submitMurekaPaidAutomation({
  db,orderId:ID,order,plan,env,fetcher
 }),/MUREKA_SUBMISSION_OUTCOME_UNKNOWN/);
 assert.equal(db.job().status,'mureka_reconcile_manually');
 await assert.rejects(submitMurekaPaidAutomation({
  db,orderId:ID,order,plan,env,fetcher
 }),/MUREKA_JOB_ALREADY_CLAIMED/);
 assert.equal(calls,1);
});
test('succeeded but missing CDN allowlist falls back to operator, never exposes raw URL',async()=>{
 const db=mockDB(),bucket=fakeBucket(),remote=fetchMock();
 await submitMurekaPaidAutomation({db,orderId:ID,order,plan,env,fetcher:remote.fetcher});
 const result=await pollMurekaMusicJobs({
  db,bucket,env:{...env,WITHU_MUREKA_AUDIO_HOST_ALLOWLIST:''},
  fetcher:remote.fetcher,clock:()=>Date.now()+1000
 });
 assert.equal(result.needsOperator,1);
 assert.equal(db.job().status,'mureka_reconcile_manually');
 assert.equal(db.order().production.status,'manual_required');
 assert.equal(bucket.files.size,0);
 assert.equal(remote.calls.length,2);
});


test('transient GET polling errors back off automatically without a second paid POST',async()=>{
 const db=mockDB(),bucket=fakeBucket(),calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(url==='https://api.mureka.ai/v1/song/generate')
   return {ok:true,json:async()=>({id:'10436',status:'preparing',model:'mureka-9.5'})};
  if(url==='https://api.mureka.ai/v1/song/query/10436')
   throw Error('temporary read timeout');
  throw Error('Unexpected provider endpoint '+url);
 };
 await submitMurekaPaidAutomation({db,orderId:ID,order,plan,env,fetcher});
 const result=await pollMurekaMusicJobs({
  db,bucket,env,fetcher,clock:()=>Date.now()+1000
 });
 assert.equal(result.needsOperator,0);
 assert.equal(db.job().status,'mureka_queued');
 assert.equal(db.job().lastError,'MUREKA_QUERY_RETRYABLE');
 assert.ok(db.job().nextPollAt>Date.now()+10000);
 assert.equal(db.order().production.status,'generating_music');
 assert.equal(calls.filter(c=>c.url.endsWith('/v1/song/generate')).length,1);
 assert.equal(bucket.files.size,0);
});
