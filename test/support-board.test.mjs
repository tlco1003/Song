import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSupportQuestion,supportReady,handleSupportBoard} from '../src/production-support.mjs';
const env={WITHU_SUPPORT_INQUIRIES_ENABLED:'true',WITHU_SUPPORT_PRIVACY_REVIEWED:'true',
 WITHU_SUPPORT_OPERATOR_VERIFIED:'true',WITHU_SUPPORT_HMAC_KEY:'a'.repeat(64),
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',WITHU_ADMIN_UID:'admin123456789'};
const base={nickname:'희망',email:'client@example.com',category:'general',title:'노래 제작은 언제 시작하나요?',
 body:'노래 주문을 마친 다음 제작 시작을 어떻게 알 수 있을까요?',visibility:'private',
 publicConsent:false,privacyAccepted:true,replyAccepted:true,policyVersion:'support-v1-20261115',honeypot:''};
function fakeDb(){
 const records=new Map();
 const collection=(name)=>({
  doc(id){return {path:name+'/'+id,id};},
  orderBy(field,dir){return {limit(count){return {async get(){
   const docs=[...records].filter(([path])=>path.startsWith(name+'/')).map(([path,data])=>({
    id:path.slice(name.length+1),data:()=>structuredClone(data)
   })).sort((a,b)=>dir==='desc'?b.data()[field]-a.data()[field]:a.data()[field]-b.data()[field]);
   return {docs:docs.slice(0,count)};
  }};}};}
 });
 return {collection,runTransaction:async fn=>{
  const writes=[];const tx={
   get:async ref=>({exists:records.has(ref.path),data:()=>structuredClone(records.get(ref.path))}),
   set:(ref,v)=>writes.push(()=>records.set(ref.path,structuredClone(v))),
   create:(ref,v)=>writes.push(()=>{if(records.has(ref.path))throw Error('already exists');records.set(ref.path,structuredClone(v));}),
   update:(ref,v)=>writes.push(()=>Object.assign(records.get(ref.path),structuredClone(v)))
  };
  const x=await fn(tx);writes.forEach(w=>w());return x;
 },records};
}
function req(method,path,body=null,admin=false){
 const data=body?JSON.stringify(body):null;
 return {method,url:path,originalUrl:path,ip:'192.0.2.40',socket:{remoteAddress:'192.0.2.40'},
  headers:{},body,rawBody:data?Buffer.from(data):null,
  is:type=>type==='application/json',
  get:name=>name==='origin'?'https://withu.example':name==='authorization'&&admin?'Bearer '+'x'.repeat(72):undefined};
}
function res(){return {code:0,body:null,set(){return this;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};}
const auth={verifyIdToken:async()=>({uid:env.WITHU_ADMIN_UID,email_verified:true})};
async function call(db,method,path,body=null,admin=false,e=env){
 const out=res();await handleSupportBoard(req(method,path,body,admin),out,{db,auth,env:e});return out;
}
test('support board fails closed unless operational privacy and admin gates are approved',async()=>{
 assert.equal(supportReady(env),true);
 assert.equal(supportReady({...env,WITHU_SUPPORT_PRIVACY_REVIEWED:'false'}),false);
 const d=fakeDb(),r=await call(d,'GET','/api/support/readiness',null,false,{});
 assert.equal(r.body.canSubmit,false);
 await assert.rejects(call(d,'POST','/api/support/questions',base,false,{...env,WITHU_SUPPORT_INQUIRIES_ENABLED:'false'}),/개인정보 보호/);
});
test('public questions reject contact details and refunds cannot be public',()=>{
 assert.equal(normalizeSupportQuestion(base).visibility,'private');
 assert.throws(()=>normalizeSupportQuestion({...base,category:'refund',visibility:'public',publicConsent:true}),/비공개/);
 assert.throws(()=>normalizeSupportQuestion({...base,visibility:'public',publicConsent:true,body:'연락주세요 client@example.com 문의드립니다'}),/이메일/);
 assert.throws(()=>normalizeSupportQuestion({...base,policyVersion:'outdated'}),/개인정보/);
});
test('guest private contact never leaks publicly, only operator can see email',async()=>{
 const db=fakeDb(),created=await call(db,'POST','/api/support/questions',base);
 assert.equal(created.code,202);
 const listing=await call(db,'GET','/api/support/questions');assert.equal(listing.body.questions.length,0);
 await assert.rejects(call(db,'GET','/api/admin/support/questions'),/관리자 로그인/);
 const adminList=await call(db,'GET','/api/admin/support/questions',null,true);
 assert.equal(adminList.body.questions[0].email,base.email);
 const id=created.body.reference;
 await assert.rejects(call(db,'POST','/api/admin/support/questions/'+id+'/moderate',{action:'publish',answer:'답변입니다.'},true),/비공개/);
 const resolved=await call(db,'POST','/api/admin/support/questions/'+id+'/moderate',{action:'resolved'},true);
 assert.equal(resolved.body.status,'resolved');
});
test('public question is published only with consent and an operator answer',async()=>{
 const db=fakeDb(),question={...base,visibility:'public',publicConsent:true};
 const created=await call(db,'POST','/api/support/questions',question);
 const id=created.body.reference;
 assert.equal((await call(db,'GET','/api/support/questions')).body.questions.length,0);
 await assert.rejects(call(db,'POST','/api/admin/support/questions/'+id+'/moderate',{action:'publish',answer:'짧음'},true),/공개 답변/);
 await call(db,'POST','/api/admin/support/questions/'+id+'/moderate',{action:'publish',answer:'결제 확인 후 주문별로 제작 상태가 변경됩니다.'},true);
 const published=(await call(db,'GET','/api/support/questions')).body.questions;
 assert.equal(published.length,1);assert.equal(published[0].title,base.title);
 assert.equal(published[0].email,undefined);
 await call(db,'POST','/api/admin/support/questions/'+id+'/moderate',{action:'hide'},true);
 assert.equal((await call(db,'GET','/api/support/questions')).body.questions.length,0);
});
test('rate limits block fourth support form and never charge or send mail',async()=>{
 const db=fakeDb();
 for(let i=0;i<3;i++)await call(db,'POST','/api/support/questions',{...base,title:'주문 관련 질문 '+i});
 await assert.rejects(call(db,'POST','/api/support/questions',base),/일일 문의 접수 한도/);
});
