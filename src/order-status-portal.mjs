/** Paid-order status is not a music download grant. */
import {makeOpaqueToken,tokenHash} from './production-contract.mjs';
import {now,paid,stop,json,respond,checkOrigin,encodeSecret,decodeSecret,LINK_TTL} from './production-runtime.mjs';
import {createResendTransactionalMailer} from './withu-notification-providers.mjs';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function summarizePaidOrder(o){
 paid(o);
 const complete=o.delivery?.status==='sent';
 const working=o.production?.status==='working';
 const manual=o.production?.status==='manual_required';
 const autoReview=o.production?.status==='awaiting_review';
 const lyrics=typeof o.confirmedLyrics==='string'&&o.confirmedLyrics.length>0;
 const qc=Array.isArray(o.tracks)&&o.tracks.some(t=>t?.reviewed===true);
 const phase=complete?'노래가 완성되어 전달됐어요.':
  qc||autoReview?'AI 음악 생성 후보를 저장했어요. 제작자가 노래를 검수하고 있어요.':
  manual?(lyrics?'가사가 준비됐어요. 제작자가 음원을 제작·검수하고 있어요.':'제작자가 가사와 음원을 준비하고 있어요.'):
  working?'가사를 준비하고 있어요.':'노래 제작을 준비하고 있어요.';
 return {status:complete?'delivered':'in_production',
  productLabel:o.productId==='audio_duo'?'맞춤 노래 2곡':'맞춤 노래 1곡',
  steps:{payment:'completed',lyrics:lyrics?'completed':working?'in_progress':'pending',
   music:complete?'completed':manual||qc||autoReview?'in_progress':'pending',
   delivery:complete?'completed':o.delivery?.status==='sending'?'in_progress':'pending'},
  phase};
}
function statusUrl(env,token){
 const base=new URL(env.WITHU_PUBLIC_BASE_URL||'https://invalid.example');
 if(base.protocol!=='https:'||base.pathname!=='/')throw Error('Approved HTTPS service origin required');
 return new URL('order-status.html#status='+token,base).href;
}
export async function sendPaidOrderReceipt({db,orderId,env=process.env,fetcher=fetch}){
 const ref=db.collection('withuOrders').doc(orderId);
 let job;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)stop(404,'주문 없음');
  const o=snap.data();paid(o);
  if(o.statusReceipt?.status==='sent'&&o.statusReceipt.expiresAt>now()){
   job={skip:true};return;
  }
  if(o.statusReceipt?.status==='sending'&&o.statusReceipt.lockUntil>now()){job={busy:true};return;}
  const old=o.statusReceipt||{},reuse=old.encryptedToken&&old.expiresAt>now();
  const token=reuse?decodeSecret(old.encryptedToken,env.WITHU_LINK_ENCRYPTION_KEY):makeOpaqueToken();
  const hash=tokenHash(token),expiresAt=reuse?old.expiresAt:now()+LINK_TTL;
  const encryptedToken=reuse?old.encryptedToken:encodeSecret(token,env.WITHU_LINK_ENCRYPTION_KEY);
  tx.update(ref,{statusReceipt:{status:'sending',tokenHash:hash,encryptedToken,expiresAt,
   attempts:(old.attempts||0)+1,lockUntil:now()+120000,updatedAt:now()}});
  tx.set(db.collection('withuStatusLinks').doc(hash),{orderId,expiresAt,revoked:false,createdAt:now()});
  job={token,email:o.contact.customerEmail};
 });
 if(job.skip)return {status:'already_sent'};
 if(job.busy)return {status:'already_sending'};
 try{
  const receipt=await createResendTransactionalMailer({config:env,fetcher}).sendOrderStatusLink({
   to:job.email,orderStatusUrl:statusUrl(env,job.token),idempotencyKey:'receipt-'+orderId+'-'+tokenHash(job.token).slice(0,12)
  });
  await ref.update({'statusReceipt.status':'sent','statusReceipt.lockUntil':0,
   'statusReceipt.messageId':receipt.messageId,'statusReceipt.sentAt':now()});
  return {status:'provider_accepted_not_inbox_verified',messageId:receipt.messageId};
 }catch(e){
  await ref.update({'statusReceipt.status':'failed','statusReceipt.lockUntil':0,
   'statusReceipt.lastError':'Receipt provider did not accept message'});
  throw e;
 }
}
export async function handleOrderStatus(req,res,{db,env}){
 const path=new URL(req.originalUrl||req.url,'https://placeholder.invalid').pathname;
 if(path!=='/api/order-status/resolve')return false;
 if(req.method!=='POST')stop(405,'POST만 허용합니다.');
 checkOrigin(req,env);
 const token=json(req,1024).token;
 if(!TOKEN.test(token||''))stop(400,'주문 링크 형식이 유효하지 않습니다.');
 const hash=tokenHash(token);
 const link=await db.collection('withuStatusLinks').doc(hash).get();
 if(!link.exists||link.data().revoked||link.data().expiresAt<=now())
  stop(403,'만료되거나 취소된 주문 링크입니다.');
 const snap=await db.collection('withuOrders').doc(link.data().orderId).get();
 if(!snap.exists)stop(404,'주문 없음');
 const order=snap.data();paid(order);
 if(order.statusReceipt?.tokenHash!==hash)stop(403,'다른 주문의 링크입니다.');
 const view=summarizePaidOrder(order);
 let listeningUrl=null;
 if(view.status==='delivered'&&order.delivery?.encryptedToken&&order.delivery?.expiresAt>now()){
  const songToken=decodeSecret(order.delivery.encryptedToken,env.WITHU_LINK_ENCRYPTION_KEY);
  if(tokenHash(songToken)!==order.delivery.tokenHash)stop(409,'전달 링크 무결성 오류');
  listeningUrl=new URL('my-music.html#delivery='+songToken,env.WITHU_PUBLIC_BASE_URL).href;
 }
 respond(res,200,{...view,listeningUrl});return true;
}
