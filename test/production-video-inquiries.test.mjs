import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVideoAdInquiry,videoAdIntakeEnabled,handleVideoAdInquiries}
 from '../src/production-video-inquiries.mjs';

const valid=Object.freeze({
 brand:'새벽 디저트',email:'creator@example.com',
 product:'프리미엄 쇼콜라',productUrl:'https://example.com/chocolate',
 category:'food',format:'vertical_15s',budget:'300k_to_600k',
 brief:'제품의 실제 광택과 초콜릿 단면을 중심으로 세로형 광고를 제작하고 싶습니다.',
 rightsConfirmed:true,privacyAccepted:true,replyAccepted:true,
 honeypot:'',policyVersion:'video-ads-pilot-v1'
});
const env=Object.freeze({
 WITHU_VIDEO_AD_INQUIRIES_ENABLED:'true',
 WITHU_VIDEO_AD_PRIVACY_REVIEWED:'true',
 WITHU_VIDEO_AD_OPERATOR_VERIFIED:'true',
 WITHU_VIDEO_LEAD_HMAC_KEY:'a'.repeat(48),
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',
 WITHU_ADMIN_UID:'withu_operator_001'
});
function makeDb(){
 const rows=new Map();
 const ref=(path)=>({
  path,async get(){return snapshot(path);},
  async update(patch){Object.assign(rows.get(path),structuredClone(patch));}
 });
 const snapshot=path=>({
  exists:rows.has(path),
  data:()=>structuredClone(rows.get(path))
 });
 return {
  rows,
  collection:col=>({
   doc:id=>ref(col+'/'+id),
   orderBy:()=>({
    limit:()=>({
     get:async()=>({docs:[...rows.entries()]
      .filter(([key])=>key.startsWith(col+'/'))
      .sort((a,b)=>b[1].createdAt-a[1].createdAt)
      .map(([,value])=>({data:()=>structuredClone(value)}))})
    })
   })
  }),
  runTransaction:async callback=>{
   const writes=[];
   const tx={
    get:async r=>snapshot(r.path),
    create:(r,value)=>writes.push(()=>{
     if(rows.has(r.path))throw new Error('Duplicate id');
     rows.set(r.path,structuredClone(value));
    }),
    set:(r,value)=>writes.push(()=>rows.set(r.path,structuredClone(value))),
    update:(r,value)=>writes.push(()=>Object.assign(rows.get(r.path),structuredClone(value)))
   };
   const result=await callback(tx);
   for(const write of writes)write();
   return result;
  }
 };
}
function req({method='POST',pathname='/api/video-ads/inquiries',body=valid,token,origin='https://withu.example'}={}){
 return {
  method,originalUrl:pathname,ip:'192.0.2.20',
  body,rawBody:Buffer.from(JSON.stringify(body)),
  is:t=>t==='application/json',
  get:header=>header==='origin'?origin:header==='authorization'?token:undefined
 };
}
function response(){
 return {
  statusCode:null,body:null,
  set(){return this;},
  status(code){this.statusCode=code;return this;},
  json(data){this.body=data;return this;}
 };
}
const AUTH_TOKEN='realAdministratorSessionToken'.repeat(2);
const auth={verifyIdToken:async(token)=>({
 uid:token===AUTH_TOKEN?'withu_operator_001':'not_owner',email_verified:true
})};

test('intake is disabled until all operational, privacy and HMAC conditions are set',()=>{
 assert.equal(videoAdIntakeEnabled({}),false);
 assert.equal(videoAdIntakeEnabled({...env,WITHU_VIDEO_AD_PRIVACY_REVIEWED:'false'}),false);
 assert.equal(videoAdIntakeEnabled({...env,WITHU_VIDEO_LEAD_HMAC_KEY:'short'}),false);
 assert.equal(videoAdIntakeEnabled(env),true);
});

test('validated quote request retains authorized factual fields and rejects malformed values',()=>{
 const lead=normalizeVideoAdInquiry(valid);
 assert.equal(lead.brand,'새벽 디저트');
 assert.equal(lead.email,'creator@example.com');
 assert.equal(lead.replyAccepted,true);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,rightsConfirmed:false}),/확인이 필요/);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,category:'unapproved'}),/선택/);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,email:'not-an-email'}),/이메일/);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,productUrl:'http://example.com'}),/https/);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,honeypot:'spam'}),/자동화/);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,brief:'짧음'}),/길이/);
 assert.throws(()=>normalizeVideoAdInquiry({...valid,unexpected:'PII'}),/지원되지 않는/);
});

test('public readiness reports no checkout and no video auto-generation',async()=>{
 const r=response(),db=makeDb();
 assert.equal(await handleVideoAdInquiries(req({
  method:'GET',pathname:'/api/video-ads/readiness'
 }),r,{db,auth,env}),true);
 assert.equal(r.statusCode,200);
 assert.equal(r.body.canSubmit,true);
 assert.equal(r.body.paymentAvailable,false);
 assert.equal(r.body.autoVideoGeneration,false);
});

test('disabled intake cannot silently store personal contact data',async()=>{
 const db=makeDb(),r=response();
 await assert.rejects(handleVideoAdInquiries(req(),r,{
  db,auth,env:{...env,WITHU_VIDEO_AD_PRIVACY_REVIEWED:'false'}
 }),/개인정보 처리 승인/);
 assert.equal(db.rows.size,0);
 assert.equal(r.body,null);
});

test('real enquiry is stored server-side with private contact and rate-limited',async()=>{
 const db=makeDb(),ids=[];
 for(let i=0;i<3;i++){
  const r=response();
  assert.equal(await handleVideoAdInquiries(req(),r,{db,auth,env}),true);
  assert.equal(r.statusCode,202);
  assert.equal(r.body.status,'received');
  assert.match(r.body.inquiryId,/^vad_[a-f0-9]{32}$/);
  assert.equal(r.body.email,undefined);
  ids.push(r.body.inquiryId);
 }
 assert.equal(new Set(ids).size,3);
 const saved=db.rows.get('withuVideoInquiries/'+ids[0]);
 assert.equal(saved.email,'creator@example.com');
 assert.equal(saved.payment.status,'not_requested');
 assert.equal(saved.fulfillment.status,'not_started');
 assert.ok(saved.deleteAfter instanceof Date);
 await assert.rejects(handleVideoAdInquiries(req(),response(),{db,auth,env}),
  /한도를 초과/);
 assert.equal([...db.rows.keys()].filter(x=>x.startsWith('withuVideoInquiries/')).length,3);
});

test('operator inbox requires verified Firebase identity and returns private requests only to owner',async()=>{
 const db=makeDb();
 await handleVideoAdInquiries(req(),response(),{db,auth,env});
 const url='/api/admin/video-ads/inquiries',r=response();
 await assert.rejects(handleVideoAdInquiries(req({method:'GET',pathname:url}),r,{
  db,auth,env
 }),/관리자 로그인이 필요/);
 assert.equal(r.body,null);
 const token='Bearer '+AUTH_TOKEN;
 const reply=response();
 await handleVideoAdInquiries(req({method:'GET',pathname:url,token}),reply,{db,auth,env});
 assert.equal(reply.statusCode,200);
 assert.equal(reply.body.inquiries.length,1);
 assert.equal(reply.body.inquiries[0].brand,'새벽 디저트');
});

test('authenticated operator updates only permitted inquiry statuses',async()=>{
 const db=makeDb(),created=response();
 await handleVideoAdInquiries(req(),created,{db,auth,env});
 const id=created.body.inquiryId;
 const path='/api/admin/video-ads/inquiries/'+id+'/status';
 const token='Bearer '+AUTH_TOKEN;
 const updated=response();
 await handleVideoAdInquiries(req({pathname:path,token,body:{status:'reviewing'}}),updated,{
  db,auth,env
 });
 assert.equal(updated.body.status,'reviewing');
 assert.equal(db.rows.get('withuVideoInquiries/'+id).status,'reviewing');
 await assert.rejects(handleVideoAdInquiries(req({
  pathname:path,token,body:{status:'paid_verified'}
 }),response(),{db,auth,env}),/상담 상태가 올바르지 않습니다/);
 assert.equal(db.rows.get('withuVideoInquiries/'+id).payment.status,'not_requested');
});
