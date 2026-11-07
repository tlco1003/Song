/**
 * Order-scoped music gift replies. Anonymous-to-identity but authenticated
 * by a legitimate share session, rate limited and owner-moderated.
 * No comment goes public before a verified Firebase operator approves it.
 */
import {randomUUID} from 'node:crypto';
import {admin,now,stop,respond,json,checkOrigin,hash,
 customerOrder,paid,approvedTracks,currentSession} from './production-runtime.mjs';
export function validateGiftComment({nickname,text}={}){
 if(typeof nickname!=='string'||typeof text!=='string')
  throw new Error('댓글 작성자와 내용을 입력해 주세요.');
 const name=nickname.trim().replace(/\s+/g,' ');
 const message=text.trim().replace(/\r\n?/g,'\n');
 if(name.length<1||name.length>24||/[\x00-\x1f<>]/.test(name))
  throw new Error('작성자 이름은 1~24자의 일반 텍스트만 허용합니다.');
 if(message.length<2||message.length>300||/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/.test(message))
  throw new Error('댓글 내용은 2~300자의 일반 텍스트만 허용합니다.');
 if(/https?:\/\/|www\.|(?:[a-z0-9-]+\.){1,2}(?:com|kr|net|org)\b/i.test(message))
  throw new Error('광고 및 외부 링크는 댓글에 등록할 수 없습니다.');
 return Object.freeze({nickname:name,text:message});
}
function pathOf(req){return new URL(req.originalUrl||req.url,'https://placeholder.invalid').pathname;}
function present(d,id){
 return {id,nickname:d.nickname,text:d.text,
  createdAt:d.createdAt,status:d.status};
}
export async function handleProductionComments(req,res,{db,auth,env}){
 const path=pathOf(req);
 if(path==='/api/gift/comments'){
  if(req.method==='GET'){
   const o=await customerOrder(req,db);
   const docs=await db.collection('withuOrders').doc(o.id).collection('comments')
    .orderBy('createdAt','desc').limit(100).get();
   const comments=docs.docs.filter(d=>d.data().status==='published').slice(0,40)
    .map(d=>present(d.data(),d.id));
   respond(res,200,{comments,moderation:'approval_required'});
   return true;
  }
  if(req.method==='POST'){
   checkOrigin(req,env);
   const values=json(req,1400);
   let clean;
   try{clean=validateGiftComment(values);}
   catch(error){stop(400,error.message);}
   const o=await customerOrder(req,db);
   paid(o);approvedTracks(o);
   const session=await currentSession(req,db);
   if(session.orderId!==o.id)stop(403,'이 노래에 댓글을 남길 수 없습니다.');
   const cookie=(String(req.headers.cookie||'').match(
    /(?:^|;\s*)withu_session=([A-Za-z0-9_-]{43})(?=;|$)/)||[])[1];
   if(!cookie)stop(401,'감상 링크를 다시 열어 주세요.');
   const hour=Math.floor(now()/3600000),day=Math.floor(now()/86400000);
   const limit=db.collection('withuCommentLimits');
   const visitor=limit.doc(hash('visitor:'+cookie+':'+hour));
   const ip=limit.doc(hash('network:'+String(req.ip||'unknown')+':'+day));
   const ref=db.collection('withuOrders').doc(o.id).collection('comments').doc(randomUUID());
   await db.runTransaction(async tx=>{
    const oldVisitor=await tx.get(visitor),oldNetwork=await tx.get(ip);
    const visitorCount=oldVisitor.data()?.count||0,networkCount=oldNetwork.data()?.count||0;
    if(visitorCount>=3||networkCount>=30)
     stop(429,'댓글 작성 횟수 제한에 도달했습니다. 잠시 후 다시 이용해 주세요.');
    tx.set(visitor,{count:visitorCount+1,expiresAt:now()+7200000});
    tx.set(ip,{count:networkCount+1,expiresAt:now()+172800000});
    tx.create(ref,{...clean,orderId:o.id,status:'pending',
     createdAt:now(),moderatedAt:null});
   });
   respond(res,201,{status:'pending',message:'댓글이 접수됐어요. 관리자 확인 후 표시됩니다.'});
   return true;
  }
  stop(405,'댓글 요청 방식을 확인해 주세요.');
 }
 const list=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/comments$/.exec(path);
 if(list&&req.method==='GET'){
  await admin(req,auth,env);
  const snap=await db.collection('withuOrders').doc(list[1]).get();
  if(!snap.exists)stop(404,'주문을 찾을 수 없습니다.');
  const docs=await snap.ref.collection('comments').orderBy('createdAt','desc').limit(100).get();
  respond(res,200,{comments:docs.docs.map(d=>present(d.data(),d.id))});
  return true;
 }
 const mod=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/comments\/([a-f0-9-]{36})\/moderate$/.exec(path);
 if(mod&&req.method==='POST'){
  await admin(req,auth,env);checkOrigin(req,env);
  const input=json(req,500);
  if(!['publish','hide'].includes(input.action))
   stop(400,'댓글 승인 또는 숨김을 선택하세요.');
  const ref=db.collection('withuOrders').doc(mod[1]).collection('comments').doc(mod[2]);
  await db.runTransaction(async tx=>{
   const doc=await tx.get(ref);
   if(!doc.exists)stop(404,'이 주문의 댓글을 찾을 수 없습니다.');
   if(doc.data().orderId!==mod[1])stop(403,'다른 주문의 댓글입니다.');
   tx.update(ref,{status:input.action==='publish'?'published':'hidden',moderatedAt:now()});
  });
  respond(res,200,{status:input.action==='publish'?'published':'hidden'});
  return true;
 }
 return false;
}
