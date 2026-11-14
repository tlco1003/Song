import test from 'node:test';
import assert from 'node:assert/strict';
import {processVerifiedPaidWork} from '../src/production-worker.mjs';

const ID='withu_'+'f'.repeat(32);
const lyrics='[Verse 1]\n엄마 오늘도 고마워요\n[Chorus]\n우리 오래 함께해요';
const songAudio=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(2100)]).toString('base64');
const baseOrder={
 id:ID,productId:'audio',state:'paid',paymentStatus:'paid',
 paymentVerifiedAt:1700000000000,paymentKey:'pg_verified_key_123456',
 currency:'KRW',amountKrw:29000,tracks:[],production:{status:'pending',attempts:0},
 delivery:{status:'not_sent'},
 contact:{customerEmail:'recipient@example.com',deliveryChannel:'email'},
 genreSelection:{mode:'single',genres:['발라드']},
 confirmedLyrics:lyrics,
 draft:{
  title:'엄마에게',mood:'따뜻한',eraPreference:'auto',lyricLength:'full',
  delivery:{recipientAgeGroup:'adult',speechStyle:'auto'},
  story:{recipient:'엄마'}
 }
};
const baseEnv={
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',
 WITHU_LINK_ENCRYPTION_KEY:'a'.repeat(64),
 RESEND_API_KEY:'resend_mock_private_key',
 WITHU_FROM_EMAIL:'WITHU <music@example.com>',
 WITHU_OPERATOR_EMAIL:'owner@example.com',
 WITHU_ADMIN_UID:'operator_verified_uid',
 WITHU_AUTOMATED_MUSIC_PROVIDER:'google_lyria',
 GEMINI_API_KEY:'gemini_test_key_not_real'
};
const rights=()=>({
 providerId:'google_lyria',model:'lyria-3.5',status:'approved',
 verifiedByUid:'operator_verified_uid',
 allowedUseCases:['customer_specific_paid_music_delivery'],
 privateEvidenceRef:'private/legal/verified-provider-evidence',
 verifiedAt:Date.now()-60000,validUntil:Date.now()+86400000
});
function fakeDB({license=rights()}={}){
 const map=new Map([['withuOrders/'+ID,structuredClone(baseOrder)]]);
 if(license)map.set('withuProviderApprovals/google_lyria',license);
 const snap=path=>({exists:map.has(path),data:()=>structuredClone(map.get(path))});
 const patch=(path,value)=>{
  const old=map.get(path);
  if(!old)throw Error('Missing record '+path);
  for(const [key,v] of Object.entries(value)){
   if(key.includes('.')){
    const keys=key.split('.');let target=old;
    for(const p of keys.slice(0,-1))target=target[p]??={};
    target[keys.at(-1)]=structuredClone(v);
   }else old[key]=structuredClone(v);
  }
 };
 const ref=path=>({
  path,
  get:async()=>snap(path),
  update:async data=>patch(path,data),
  create:async data=>{
   if(map.has(path))throw Error('Duplicate create');
   map.set(path,structuredClone(data));
  }
 });
 const db={
  collection:name=>({doc:id=>ref(name+'/'+id)}),
  runTransaction:async fn=>{
   const ops=[];
   const tx={
    get:async target=>snap(target.path),
    update:(target,data)=>ops.push(()=>patch(target.path,data)),
    set:(target,data)=>ops.push(()=>map.set(target.path,structuredClone(data)))
   };
   const value=await fn(tx);
   ops.forEach(op=>op());
   return value;
  },
  getOrder:()=>structuredClone(map.get('withuOrders/'+ID)),
  jobs:()=>[...map.keys()].filter(x=>x.startsWith('withuMusicJobs/'))
 };
 return db;
}
function harness({license=rights(),auto=true}={}){
 const db=fakeDB({license}),files=new Map(),calls=[];
 const bucket={file:path=>({save:async(bytes,metadata)=>{
  files.set(path,{bytes:Buffer.from(bytes),metadata});
 }})};
 const env={...baseEnv,...(!auto?{WITHU_AUTOMATED_MUSIC_PROVIDER:'off'}:{})};
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('generativelanguage.googleapis.com'))
   return {ok:true,json:async()=>({steps:[{
    type:'model_output',content:[{type:'audio',data:songAudio}]
   }]})};
  if(url==='https://api.resend.com/emails')
   return {ok:true,json:async()=>({id:'email_accepted_mock_12345'})};
  throw Error('Unexpected external API '+url);
 };
 return {db,bucket,env,fetcher,calls,files};
}
test('verified paid Firebase worker runs Lyria once, stores unreviewed MP3 and sends only receipt/owner emails',async()=>{
 const h=harness();
 const result=await processVerifiedPaidWork({...h,orderId:ID});
 assert.equal(result.status,'awaiting_review');
 const o=h.db.getOrder();
 assert.equal(o.production.status,'awaiting_review');
 assert.equal(o.production.candidateCount,1);
 assert.equal(o.tracks.length,1);
 assert.equal(o.tracks[0].reviewed,false);
 assert.equal(o.tracks[0].rightsVerified,false);
 assert.equal(o.confirmedLyrics,lyrics);
 assert.equal(h.files.size,1);
 assert.equal(h.db.jobs().length,1);
 assert.equal(h.calls.filter(c=>c.url.includes('generativelanguage.googleapis.com')).length,1);
 const mails=h.calls.filter(c=>c.url==='https://api.resend.com/emails');
 assert.equal(mails.length,2);
 assert.ok(mails.some(m=>JSON.parse(m.options.body).to.includes('recipient@example.com')));
 assert.ok(mails.some(m=>JSON.parse(m.options.body).to.includes('owner@example.com')));
 // No final customer completed-song notification or delivery link before QA.
 assert.equal(o.delivery.status,'not_sent');
 const replay=await processVerifiedPaidWork({...h,orderId:ID});
 assert.equal(replay.status,'skipped');
 assert.equal(h.calls.filter(c=>c.url.includes('generativelanguage.googleapis.com')).length,1);
});
test('no private rights approval never calls music API; manual fallback stays available',async()=>{
 const h=harness({license:null});
 const result=await processVerifiedPaidWork({...h,orderId:ID});
 assert.equal(result.status,'manual_required');
 assert.equal(h.db.getOrder().production.reason,'COMMERCIAL_RIGHTS_REVIEW_REQUIRED');
 assert.equal(h.files.size,0);
 assert.equal(h.calls.filter(c=>c.url.includes('generativelanguage.googleapis.com')).length,0);
});
test('disabled optional provider uses existing manual workflow',async()=>{
 const h=harness({auto:false});
 const result=await processVerifiedPaidWork({...h,orderId:ID});
 assert.equal(result.status,'manual_required');
 assert.equal(h.db.jobs().length,0);
 assert.equal(h.files.size,0);
});
