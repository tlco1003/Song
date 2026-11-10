import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAdminSongTiming,timingExport} from '../src/admin-song-timing.mjs';

function setup(){
 const records=new Map(),objects=new Map();
 const db={
  collection(){
   return {
    doc(id){return {
     id,async get(){return {exists:records.has(id),data:()=>records.get(id)}},
     async create(value){if(records.has(id))throw Error('duplicate');records.set(id,value)},
     async update(patch){const item=records.get(id);if(!item)throw Error('missing');
       for(const [k,v] of Object.entries(patch))item[k]=v;records.set(id,item)}
    }},
    orderBy(){return {limit(){return {async get(){return {
     docs:[...records.values()].map(value=>({data:()=>value}))
    }}}}}},
   };
  },
  async runTransaction(fn){
   const tx={get:ref=>ref.get(),update:(ref,changes)=>ref.update(changes)};
   return fn(tx);
  }
 };
 const bucket={file(path){return {
  async save(bytes){objects.set(path,Buffer.from(bytes))},
  async download(){return [objects.get(path)]}
 }}};
 const env={WITHU_ADMIN_UID:'test-owner-uid',
  WITHU_PUBLIC_BASE_URL:'https://owner.example/'};
 const auth={async verifyIdToken(token){
  if(token==='x'.repeat(70))return {uid:'test-owner-uid',email_verified:true};
  if(token==='y'.repeat(70))return {uid:'other',email_verified:true};
  throw Error('bad token');
 }};
 const context={db,bucket,env,auth};
 async function call(method,path,body=null,token='x'.repeat(70),origin='https://owner.example'){
  const headers={authorization:token?'Bearer '+token:null,origin};
  if(Buffer.isBuffer(body)){headers['x-withu-file-name']='mother-song.mp3';headers['content-type']='application/octet-stream'}
  else if(body!==null)headers['content-type']='application/json';
  const rawBody=Buffer.isBuffer(body)?body:Buffer.from(body===null?'':JSON.stringify(body));
  const req={method,originalUrl:'/api/admin/timing'+path,
   rawBody,body:Buffer.isBuffer(body)?null:body,
   is:x=>headers['content-type']===x,
   get:key=>headers[key.toLowerCase()]||null};
  const res={
   statusCode:200,headers:{},value:null,
   set(k,v){this.headers[k]=v;return this},
   status(n){this.statusCode=n;return this},
   json(v){this.value=v;return this},
   send(v){this.value=v;return this}
  };
  try{await handleAdminSongTiming(req,res,context)}
  catch(e){res.statusCode=e.status||500;res.value={error:e.message}}
  return res;
 }
 return {records,objects,env,call};
}
const file=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(96,1)]);
test('owner authentication protects all private timing project and media endpoints',async()=>{
 const t=setup();
 assert.equal((await t.call('GET','/projects',null,'')).statusCode,401);
 assert.equal((await t.call('GET','/projects',null,'y'.repeat(70))).statusCode,403);
 assert.equal((await t.call('POST','/projects',{title:'m',lyrics:'엄마'},'x'.repeat(70),'https://attacker.example')).statusCode,403);
 assert.equal((await t.call('GET','/status')).value.ownerVerified,true);
 assert.equal((await t.call('GET','/status')).value.workerConfigured,false);
});
test('real-song upload, repeat occurrence review and Kling export are private and gated',async()=>{
 const t=setup();
 const created=await t.call('POST','/projects',{title:'엄마에게 전하는 노래',
  lyrics:'엄마 난 가끔\n엄마 난 가끔'});
 assert.equal(created.statusCode,201);
 const id=created.value.project.id;
 assert.match(id,/^timing_[0-9a-f]{32}$/);
 assert.equal((await t.call('GET','/projects/'+id)).value.project.review,null);
 assert.equal((await t.call('GET','/projects/'+id+'/audio')).statusCode,404);
 const upload=await t.call('PUT','/projects/'+id+'/audio',file);
 assert.equal(upload.statusCode,200);
 assert.deepEqual((await t.call('GET','/projects/'+id+'/audio')).value,file);
 const p=(await t.call('GET','/projects/'+id)).value.project;
 assert.equal(p.audioSHA256,upload.value.audioSHA256);
 assert.equal((await t.call('GET','/projects/'+id+'/export/kling')).statusCode,409);
 assert.equal((await t.call('POST','/projects/'+id+'/analyze',{})).statusCode,503);
 const candidate={schema:'SONG_AI_LINE_TIMING_DRAFT_V1',
  source:'real_audio_asr_unverified',reviewedByHuman:false,
  lyricsSHA256:p.lyricsSHA256,audioSHA256:p.audioSHA256,durationSec:100,
  lines:[
   {index:0,text:'엄마 난 가끔',start:5,end:7,matched:true,flags:['REPEATED_CHORUS_OCCURRENCE']},
   {index:1,text:'엄마 난 가끔',start:75,end:79,matched:true,flags:['REPEATED_CHORUS_OCCURRENCE']}
  ]};
 assert.equal((await t.call('POST','/projects/'+id+'/candidate',candidate)).statusCode,200);
 const rows=candidate.lines.map(x=>({index:x.index,text:x.text,start:x.start,end:x.end}));
 assert.equal((await t.call('POST','/projects/'+id+'/review',{reviewedByHuman:false,lines:rows})).statusCode,422);
 assert.equal((await t.call('POST','/projects/'+id+'/review',{reviewedByHuman:true,lines:[rows[1],rows[0]]})).statusCode,422);
 const good=await t.call('POST','/projects/'+id+'/review',{reviewedByHuman:true,lines:rows});
 assert.equal(good.statusCode,200);
 assert.equal(good.value.review.phonemeTimingVerified,false);
 const exported=await t.call('GET','/projects/'+id+'/export/kling');
 assert.equal(exported.statusCode,200);
 const data=JSON.parse(exported.value);
 assert.deepEqual(data.shots.map(x=>x.startSec),[5,75]);
 assert.equal(data.phonemeTimingVerified,false);
 assert.equal((await t.call('GET','/projects/'+id+'/export/srt')).statusCode,200);
 assert.equal((await t.call('GET','/projects/'+id+'/export/csv')).statusCode,200);
 assert.equal((await t.call('GET','/projects/'+id+'/export/json',null,'y'.repeat(70))).statusCode,403);
 // Replacing audio invalidates all human reviews and stale drafts.
 assert.equal((await t.call('PUT','/projects/'+id+'/audio',
  Buffer.concat([Buffer.from('ID3'),Buffer.alloc(98,2)]))).statusCode,200);
 assert.equal((await t.call('GET','/projects/'+id+'/export/kling')).statusCode,409);
});
test('format exports are precise, no invented video prompt or unmeasured phoneme claims',()=>{
 const review={schema:'SONG_AI_REVIEWED_LINES_V1',source:'human_verified',
  lyricsSHA256:'l',audioSHA256:'a',reviewedByHuman:true,
  lines:[{text:'사랑해, 엄마',start:12.345,end:14.1}]};
 const srt=timingExport(review,'srt');
 assert.match(srt.text,/00:00:12,345 --> 00:00:14,100/);
 const csv=timingExport(review,'csv');
 assert.match(csv.text,/"사랑해, 엄마"/);
 const kling=JSON.parse(timingExport(review,'kling').text);
 assert.equal(kling.shots[0].prompt,'');
 assert.equal(kling.phonemeTimingVerified,false);
});
