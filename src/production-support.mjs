/**
 * WITHU first-party support/Q&A board. Private by default; public only
 * after explicit customer opt-in AND verified operator answer/approval.
 * The operator reads/replies using the existing Firebase-authenticated admin.
 * Static GitHub Pages only shows mailto fallback until Firebase API is live.
 */
import {createHmac,randomBytes} from 'node:crypto';
import {admin,checkOrigin,json,now,respond,stop} from './production-runtime.mjs';

const POLICY='support-v1-20261115';
const ID=/^sup_[a-f0-9]{32}$/;
const CATEGORIES=new Set(['general','order','refund','technical','other']);
const MS_DAY=86400000;
export const SUPPORT_CONTACT='tlco1003@naver.com';

export function supportReady(env={}){
 return env.WITHU_SUPPORT_INQUIRIES_ENABLED==='true'
  &&env.WITHU_SUPPORT_PRIVACY_REVIEWED==='true'
  &&env.WITHU_SUPPORT_OPERATOR_VERIFIED==='true'
  &&typeof env.WITHU_SUPPORT_HMAC_KEY==='string'
  &&env.WITHU_SUPPORT_HMAC_KEY.length>=32
  &&/^https:\/\/[^/]+\/?$/.test(env.WITHU_PUBLIC_BASE_URL||'')
  &&typeof env.WITHU_ADMIN_UID==='string'&&env.WITHU_ADMIN_UID.length>=10;
}
function textField(x,label,min,max){
 if(typeof x!=='string'||x.length>max*2)throw Error(label+' 입력 형식이 올바르지 않습니다.');
 const s=x.trim().replace(/\r\n?/g,'\n');
 if(s.length<min||s.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(s))
  throw Error(label+' 길이·특수문자를 확인해 주세요.');
 return s;
}
function containsContactOrLinks(s){
 return /https?:\/\/|www\.|\b[^\s@]+@[^\s@]+\.[^\s@]+\b|(?:\+?82[-. ]?)?01[016789][-. ]?\d{3,4}[-. ]?\d{4}/i.test(s);
}
export function normalizeSupportQuestion(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('문의 형식이 올바르지 않습니다.');
 const allowed=new Set(['nickname','email','category','title','body','visibility',
  'publicConsent','privacyAccepted','replyAccepted','policyVersion','honeypot']);
 if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('지원하지 않는 입력 항목입니다.');
 if(input.honeypot)throw Error('자동 등록 요청은 처리할 수 없습니다.');
 if(input.privacyAccepted!==true||input.replyAccepted!==true||input.policyVersion!==POLICY)
  throw Error('문의 및 이메일 답변을 위한 개인정보 동의가 필요합니다.');
 if(!CATEGORIES.has(input.category)||!['public','private'].includes(input.visibility))
  throw Error('문의 종류 또는 공개 여부를 확인해 주세요.');
 if(input.visibility==='public'&&input.publicConsent!==true)
  throw Error('공개 문의에 대한 별도 동의가 필요합니다.');
 if(input.category==='refund'&&input.visibility!=='private')
  throw Error('환불 문의는 반드시 비공개로 접수해 주세요.');
 const nickname=textField(input.nickname,'작성자 별명',2,24);
 const email=textField(input.email,'이메일',6,254).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('이메일 주소를 확인해 주세요.');
 const title=textField(input.title,'제목',4,90);
 const body=textField(input.body,'본문',10,1200);
 if(input.visibility==='public'&&[nickname,title,body].some(containsContactOrLinks))
  throw Error('공개 문의에는 이메일·전화번호·웹 주소를 적지 마세요.');
 return Object.freeze({nickname,email,category:input.category,title,body,
  visibility:input.visibility,publicConsent:input.visibility==='public',
  privacyAccepted:true,replyAccepted:true,policyVersion:POLICY});
}
function publicItem(d,id){
 return {id,category:d.category,nickname:d.nickname,title:d.title,body:d.body,
  answer:d.answer||'',createdAt:d.createdAt,answeredAt:d.answeredAt||null};
}
function adminItem(d,id){
 return {id,...publicItem(d,id),email:d.email,
  visibility:d.visibility,status:d.status,updatedAt:d.updatedAt};
}
function limiterKey(req,env,day){
 return createHmac('sha256',env.WITHU_SUPPORT_HMAC_KEY)
  .update('support/v1|'+day+'|'+String(req.ip||req.socket?.remoteAddress||'unknown')).digest('hex');
}
export async function handleSupportBoard(req,res,{db,auth,env}){
 const path=new URL(req.originalUrl||req.url,'https://invalid.example').pathname;
 const publicPath=path==='/api/support/questions';
 if(req.method==='GET'&&path==='/api/support/readiness'){
  respond(res,200,{canSubmit:supportReady(env),moderated:true,contactEmail:SUPPORT_CONTACT,policyVersion:POLICY});
  return true;
 }
 if(publicPath&&req.method==='GET'){
  if(!supportReady(env)){
   respond(res,200,{canSubmit:false,questions:[],moderated:true});return true;
  }
  const snapshot=await db.collection('withuSupportQuestions').orderBy('createdAt','desc').limit(80).get();
  respond(res,200,{canSubmit:true,moderated:true,
   questions:snapshot.docs.filter(d=>d.data().status==='published'
    &&d.data().visibility==='public'&&d.data().publicConsent===true)
    .slice(0,30).map(d=>publicItem(d.data(),d.id))});
  return true;
 }
 if(publicPath&&req.method==='POST'){
  checkOrigin(req,env);
  if(!supportReady(env))stop(503,'문의 게시판의 개인정보 보호·운영 준비가 완료되지 않았습니다.');
  let input;
  try{input=normalizeSupportQuestion(json(req,4200));}
  catch(e){stop(400,e.message);}
  const created=now(),date=new Date(created).toISOString().slice(0,10);
  const id='sup_'+randomBytes(16).toString('hex');
  const limit=db.collection('withuSupportLimits').doc(limiterKey(req,env,date));
  const ref=db.collection('withuSupportQuestions').doc(id);
  await db.runTransaction(async tx=>{
   const existing=await tx.get(limit);
   if((existing.data()?.count||0)>=3)stop(429,'일일 문의 접수 한도를 초과했습니다. 이메일 문의를 이용해 주세요.');
   tx.set(limit,{count:(existing.data()?.count||0)+1,day:date,deleteAfter:new Date(created+7*MS_DAY)});
   tx.create(ref,{...input,id,status:'pending',answer:'',answeredAt:null,
    createdAt:created,updatedAt:created,deleteAfter:new Date(created+90*MS_DAY)});
  });
  respond(res,202,{status:'pending',reference:id,
   message:'문의가 비공개로 접수됐습니다. 공개를 선택한 글도 관리자 검토 전에는 게시되지 않습니다.'});
  return true;
 }
 if(publicPath)stop(405,'허용되지 않은 문의 요청입니다.');
 if(path==='/api/admin/support/questions'&&req.method==='GET'){
  await admin(req,auth,env);
  const snap=await db.collection('withuSupportQuestions').orderBy('createdAt','desc').limit(80).get();
  respond(res,200,{questions:snap.docs.map(d=>adminItem(d.data(),d.id))});
  return true;
 }
 const mod=/^\/api\/admin\/support\/questions\/(sup_[a-f0-9]{32})\/moderate$/.exec(path);
 if(mod){
  if(req.method!=='POST')stop(405,'POST 요청만 가능합니다.');
  await admin(req,auth,env);checkOrigin(req,env);
  const payload=json(req,1700);
  if(!['publish','hide','resolved'].includes(payload.action)
   ||Object.keys(payload).some(k=>!['action','answer'].includes(k)))
   stop(400,'관리자 처리 요청 형식이 올바르지 않습니다.');
  let answer='';
  if(payload.action==='publish'){
   try{answer=textField(payload.answer,'공개 답변',5,900);}
   catch(e){stop(400,e.message);}
   if(containsContactOrLinks(answer))stop(400,'공개 답변에 연락처·외부 링크를 넣지 마세요.');
  }
  const ref=db.collection('withuSupportQuestions').doc(mod[1]);
  await db.runTransaction(async tx=>{
   const doc=await tx.get(ref);
   if(!doc.exists)stop(404,'문의 기록이 없습니다.');
   const row=doc.data();
   if(payload.action==='publish'&&(row.visibility!=='public'||row.publicConsent!==true||row.category==='refund'))
    stop(403,'비공개·환불 문의는 공개할 수 없습니다.');
   tx.update(ref,{status:payload.action==='publish'?'published':
    payload.action==='hide'?'hidden':'resolved',updatedAt:now(),
    ...(payload.action==='publish'?{answer,answeredAt:now(),
     deleteAfter:new Date(now()+365*MS_DAY)}:{})});
  });
  respond(res,200,{status:payload.action==='publish'?'published':
   payload.action==='hide'?'hidden':'resolved',reference:mod[1]});
  return true;
 }
 return false;
}
