/**
 * Durable shareable order-only listening links, private GCS byte-range audio,
 * and a separately verified 10,000 KRW file download right.
 */
import {makeOpaqueToken,tokenHash,authorizeOrderMedia} from './production-contract.mjs';
import {createResendTransactionalMailer} from './withu-notification-providers.mjs';
import {LINK_TTL,SESSION_TTL,UPGRADE_PRICE,now,json,checkOrigin,
 stop,respond,paid,approvedTracks,currentSession,customerOrder,
 customerResponse,encodeSecret,decodeSecret,linkUrl}
 from './production-runtime.mjs';
function library(o){return customerResponse(o);}
async function sendCompletedEmail({db,env,fetcher,id}){
 const ref=db.collection('withuOrders').doc(id);
 let details;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)stop(404,'주문을 찾을 수 없습니다.');
  const order=snap.data();
  paid(order);approvedTracks(order);
  if(order.delivery?.status==='sent'){details={already:true};return;}
  if(order.delivery?.status==='sending'&&order.delivery.lockUntil>now())
   stop(409,'이미 발송 작업이 진행 중입니다.');
  let token,hash,encrypted,expiresAt;
  if(order.delivery?.encryptedToken){
   token=decodeSecret(order.delivery.encryptedToken,env.WITHU_LINK_ENCRYPTION_KEY);
   hash=tokenHash(token);expiresAt=order.delivery.expiresAt;
   encrypted=order.delivery.encryptedToken;
  }else{
   token=makeOpaqueToken();hash=tokenHash(token);
   encrypted=encodeSecret(token,env.WITHU_LINK_ENCRYPTION_KEY);
   expiresAt=now()+LINK_TTL;
  }
  tx.update(ref,{delivery:{
   ...order.delivery,status:'sending',lockUntil:now()+120000,
   tokenHash:hash,encryptedToken:encrypted,expiresAt,
   attempts:(order.delivery?.attempts||0)+1
  }});
  tx.set(db.collection('withuLinks').doc(hash),{
   orderId:id,expiresAt,revoked:false,createdAt:now()
  });
  details={token,email:order.contact.customerEmail,channel:order.contact.deliveryChannel};
 });
 if(details.already)return {status:'already_sent'};
 let receipt;
 try{
  const mailer=createResendTransactionalMailer({config:env,fetcher});
  receipt=await mailer.sendPersonalListeningLink({
   to:details.email,listeningUrl:linkUrl(env,details.token),
   idempotencyKey:'delivery-'+id
  });
 }catch(error){
  await ref.update({'delivery.status':'failed','delivery.lockUntil':0,
   'delivery.lastError':'Transaction email was not accepted by mail service'});
  throw error;
 }
 await ref.update({'delivery.status':'sent','delivery.lockUntil':0,
  'delivery.messageId':receipt.messageId,'delivery.sentAt':now()});
 return {status:'provider_accepted_not_inbox_verified',
  messageId:receipt.messageId,channel:'email'};
}
export async function handleProductionDelivery(req,res,{db,bucket,env,fetcher}){
 const path=new URL(req.originalUrl||req.url,'https://placeholder.invalid').pathname;
 if(req.method==='POST'&&path==='/api/delivery/resolve'){
  checkOrigin(req,env);
  const input=json(req,1024);
  const hash=tokenHash(input.token);
  const link=await db.collection('withuLinks').doc(hash).get();
  if(!link.exists||link.data().revoked||link.data().expiresAt<=now())
   stop(403,'링크가 만료되었거나 취소됐습니다.');
  const ref=db.collection('withuOrders').doc(link.data().orderId);
  const snap=await ref.get();
  if(!snap.exists)stop(404,'주문을 찾지 못했습니다.');
  const order=snap.data();paid(order);
  if(order.delivery?.status!=='sent'||order.delivery?.tokenHash!==hash)
   stop(403,'현재 주문에 유효한 공유 링크가 아닙니다.');
  const session=makeOpaqueToken();
  await db.collection('withuSessions').doc(tokenHash(session)).create({
   orderId:order.id,createdAt:now(),expiresAt:now()+SESSION_TTL
  });
  res.setHeader('Set-Cookie','withu_session='+session+
   '; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age='+Math.floor(SESSION_TTL/1000));
  respond(res,200,library(order));return true;
 }
 if(req.method==='GET'&&path==='/api/delivery/library'){
  const order=await customerOrder(req,db);
  respond(res,200,library(order));return true;
 }
 const media=/^\/api\/delivery-(assets|downloads)\/(withu_[a-f0-9]{32})_([12])$/.exec(path);
 if(media&&['GET','HEAD'].includes(req.method)){
  const type=media[1]==='downloads'?'download':'playback';
  const session=await currentSession(req,db);
  const snap=await db.collection('withuOrders').doc(session.orderId).get();
  if(!snap.exists)stop(404,'음원 파일이 없습니다.');
  const order=snap.data();
  try{authorizeOrderMedia({
   sessionOrderId:session.orderId,assetOrderId:media[2],kind:type,order
  });}catch(_){stop(403,'이 고객에게 허가되지 않은 음원입니다.');}
  const track=approvedTracks(order)[Number(media[3])-1];
  if(!track)stop(404,'음원 파일을 찾을 수 없습니다.');
  const file=bucket.file(track.storagePath);
  const [metadata]=await file.getMetadata();
  const size=Number(metadata.size);
  if(!Number.isSafeInteger(size)||size<44)stop(503,'음원 파일이 올바르지 않습니다.');
  let start=0,end=size-1,partial=false;
  const range=String(req.headers.range||'');
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   if(!match||(!match[1]&&!match[2]))stop(416,'올바르지 않은 음원 범위입니다.');
   partial=true;
   if(match[1]){
    start=Number(match[1]);end=match[2]?Number(match[2]):end;
   }else{
    const suffix=Number(match[2]);
    if(!Number.isSafeInteger(suffix)||suffix<=0)stop(416,'음원 범위 오류');
    start=Math.max(0,size-suffix);
   }
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)
    ||start<0||end<start||start>=size)stop(416,'음원 크기를 벗어난 범위입니다.');
   end=Math.min(end,size-1);
  }
  res.status(partial?206:200);
  res.setHeader('Content-Type',track.contentType||'audio/mpeg');
  res.setHeader('Accept-Ranges','bytes');
  res.setHeader('Content-Length',String(end-start+1));
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(partial)res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+size);
  if(type==='download'){
   res.setHeader('Content-Disposition','attachment; filename="withu-song-'+media[3]+
    '.'+(track.ext||'mp3')+'"');
  }
  if(req.method==='HEAD'){res.end();return true;}
  file.createReadStream({start,end}).on('error',()=>res.destroy()).pipe(res);
  return true;
 }
 return false;
}
export {sendCompletedEmail};
