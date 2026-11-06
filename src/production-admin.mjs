/**
 * Protected operator dashboard. Firebase Authentication's verified UID is
 * checked on the server for EVERY request; no client-side admin flag.
 */
import {randomUUID} from 'node:crypto';
import {admin,now,json,checkOrigin,stop,respond,paid,
 countTracks,adminSummary,hash,approvedTracks}
 from './production-runtime.mjs';
import {sendCompletedEmail} from './production-delivery.mjs';

function validateSound(name,bytes){
 if(typeof name!=='string'||!/^[a-zA-Z0-9_. -]{1,100}\.(mp3|m4a|wav)$/i.test(name))
  stop(400,'MP3, M4A, WAV 형식의 음원을 선택하세요.');
 if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>25*1024*1024)
  stop(413,'음원 크기는 25MB 이하이어야 합니다.');
 const ext=name.split('.').at(-1).toLowerCase();
 const valid=ext==='wav'?
  bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':
  ext==='m4a'?bytes.toString('ascii',4,8)==='ftyp':
  bytes.toString('ascii',0,3)==='ID3'||
   bytes[0]===255&&(bytes[1]&224)===224;
 if(!valid)stop(400,'음원 실제 형식이 파일 확장자와 일치하지 않습니다.');
 return {ext,contentType:ext==='wav'?'audio/wav':ext==='m4a'?'audio/mp4':'audio/mpeg'};
}
export async function handleProductionAdmin(req,res,{db,bucket,auth,env,fetcher}){
 const path=new URL(req.originalUrl||req.url,'https://placeholder.invalid').pathname;
 if(!path.startsWith('/api/admin/'))return false;
 await admin(req,auth,env);
 if(req.method==='GET'&&path==='/api/admin/orders'){
  const docs=await db.collection('withuOrders').orderBy('createdAt','desc').limit(100).get();
  respond(res,200,{orders:docs.docs.map(snap=>adminSummary(snap.data()))});
  return true;
 }
 const detail=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})$/.exec(path);
 if(req.method==='GET'&&detail){
  const snap=await db.collection('withuOrders').doc(detail[1]).get();
  if(!snap.exists)stop(404,'주문을 찾지 못했습니다.');
  respond(res,200,{order:adminSummary(snap.data())});return true;
 }
 if(!['POST','PUT'].includes(req.method))stop(405,'해당 작업을 지원하지 않습니다.');
 checkOrigin(req,env);
 const upload=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/tracks\/([12])\/audio$/.exec(path);
 if(req.method==='PUT'&&upload){
  const id=upload[1],index=Number(upload[2]);
  const ref=db.collection('withuOrders').doc(id);
  const snapshot=await ref.get();
  if(!snapshot.exists)stop(404,'주문이 없습니다.');
  const order=snapshot.data();paid(order);
  if(index>countTracks(order)||order.delivery?.status==='sent')
   stop(409,'구매곡 수 또는 전달 완료 상태를 확인하세요.');
  const bytes=req.rawBody;
  let filename;
  try{filename=decodeURIComponent(req.get('x-withu-file-name')||'');}
  catch(_){stop(400,'파일 이름이 올바르지 않습니다.');}
  const {ext,contentType}=validateSound(filename,bytes);
  const storagePath='orders/'+id+'/tracks/'+index+'-'+randomUUID()+'.'+ext;
  const file=bucket.file(storagePath);
  await file.save(bytes,{
   resumable:false,contentType,
   metadata:{cacheControl:'private,no-store',
    metadata:{customerOrderId:id,sha256:hash(bytes)}}
  });
  try{
   await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists)stop(404,'주문 없음');
    const current=snap.data();paid(current);
    if(current.delivery?.status==='sent')stop(409,'이미 전달한 곡은 변경할 수 없습니다.');
    const tracks=Array.from({length:countTracks(current)},(_,i)=>
     current.tracks?.[i]||null);
    tracks[index-1]={index,storagePath,fileName:filename,ext,contentType,
     reviewed:false,rightsVerified:false,uploadedAt:now()};
    tx.update(ref,{tracks});
   });
  }catch(err){
   await file.delete({ignoreNotFound:true}).catch(()=>{});
   throw err;
  }
  respond(res,201,{status:'uploaded',orderId:id,index,fileName:filename});
  return true;
 }
 const song=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/tracks\/([12])$/.exec(path);
 if(req.method==='POST'&&song){
  const input=json(req,11000),id=song[1],index=Number(song[2]);
  if(typeof input.title!=='string'||input.title.trim().length<2||input.title.length>100
   ||typeof input.lyrics!=='string'||input.lyrics.trim().length<12
   ||input.lyrics.length>5500||input.rightsVerified!==true||input.reviewed!==true)
   stop(400,'제작곡 제목·가사·검수 및 권리 확인이 필요합니다.');
  const ref=db.collection('withuOrders').doc(id);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)stop(404,'주문 없음');
   const o=snap.data();paid(o);
   if(o.delivery?.status==='sent'||index>countTracks(o))
    stop(409,'해당 곡을 편집할 수 없습니다.');
   const tracks=Array.from({length:countTracks(o)},(_,i)=>o.tracks?.[i]||null);
   if(!tracks[index-1]?.storagePath)stop(409,'비공개 음원을 먼저 올려주세요.');
   if(input.genre!==o.draft.songStyles[index-1].genre)
    stop(409,'결제 시 선택된 장르와 다릅니다.');
   tracks[index-1]={...tracks[index-1],index,
    title:input.title.trim(),genre:input.genre,
    lyrics:input.lyrics.trim(),rightsVerified:true,reviewed:true,
    reviewedAt:now()};
   tx.update(ref,{tracks});
  });
  respond(res,200,{status:'approved',index});return true;
 }
 const deliver=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/deliver$/.exec(path);
 if(req.method==='POST'&&deliver){
  json(req,400);
  const ref=db.collection('withuOrders').doc(deliver[1]);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)stop(404,'주문 없음');
   const o=snap.data();paid(o);
   const tracks=approvedTracks(o);
   if(!tracks.every(t=>t.rightsVerified===true))
    stop(409,'제공할 완성곡의 권리 확인이 누락됐습니다.');
   tx.update(ref,{'upgrade.rightsVerified':true});
  });
  const result=await sendCompletedEmail({
   db,env,fetcher,id:deliver[1]
  });
  respond(res,200,result);return true;
 }
 const revoke=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/revoke-link$/.exec(path);
 if(req.method==='POST'&&revoke){
  json(req,400);
  const ref=db.collection('withuOrders').doc(revoke[1]);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)stop(404,'주문 없음');
   const o=snap.data(),hash=o.delivery?.tokenHash;
   if(!hash)stop(409,'아직 링크가 없습니다.');
   tx.update(ref,{'delivery.status':'revoked','delivery.revokedAt':now()});
   tx.update(db.collection('withuLinks').doc(hash),{revoked:true});
  });
  respond(res,200,{status:'revoked'});return true;
 }
 const retry=/^\/api\/admin\/orders\/(withu_[a-f0-9]{32})\/retry-production$/.exec(path);
 if(req.method==='POST'&&retry){
  json(req,400);
  const ref=db.collection('withuOrders').doc(retry[1]);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)stop(404,'주문 없음');
   const o=snap.data();paid(o);
   if(o.production?.status==='working'&&o.production?.startedAt>now()-900000)
    stop(409,'작사 작업이 이미 진행 중입니다.');
   if(o.delivery?.status==='sent')stop(409,'전달된 주문은 재생성할 수 없습니다.');
   tx.update(ref,{production:{status:'pending',
    attempts:o.production?.attempts||0,updatedAt:now()}});
  });
  respond(res,200,{status:'queued'});return true;
 }
 stop(404,'관리자 API를 찾을 수 없습니다.');
}
