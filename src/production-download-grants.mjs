/**
 * A freely shared music-gift link is NOT a 10,000 KRW download entitlement.
 * Only the payer receives an independent, resumable owner grant.
 * The grant may be repeatedly used and recovered from the buyer's email,
 * without revealing it to other listening-link holders.
 */
import {makeOpaqueToken,tokenHash} from './production-contract.mjs';
import {now,stop,paid,encodeSecret,decodeSecret,SESSION_TTL} from './production-runtime.mjs';

export const DOWNLOAD_GRANT_TTL=5*365*86400000;
function tokenCookie(req,name){
 return (String(req.headers?.cookie||'').match(
  new RegExp('(?:^|;\\s*)'+name+'=([A-Za-z0-9_-]{43})(?=;|$)'))||[])[1]||null;
}
function secureCookie(name,token,seconds){
 return name+'='+token+'; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age='+seconds;
}
export function grantCookie(token){
 return secureCookie('withu_download',token,Math.floor(DOWNLOAD_GRANT_TTL/1000));
}
async function lookupGrant(db,token){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))return null;
 const snap=await db.collection('withuDownloadGrants').doc(tokenHash(token)).get();
 if(!snap.exists||snap.data()?.revoked||snap.data()?.expiresAt<=now())return null;
 return snap.data();
}
export async function hasDownloadGrant(req,db,orderId){
 const grant=await lookupGrant(db,tokenCookie(req,'withu_download'));
 return !!grant&&grant.orderId===orderId&&grant.paymentVerified===true;
}
export async function ensurePaidDownloadGrant({db,env,intentId,res}){
 const ref=db.collection('withuUpgradeIntents').doc(intentId);
 let token,info;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)stop(404,'추가 결제 기록을 찾을 수 없습니다.');
  const intent=snap.data();
  if(intent.paymentStatus!=='paid'||!intent.paymentVerifiedAt
   ||!intent.paymentKey)stop(403,'실제 추가 결제 승인이 필요합니다.');
  const root=db.collection('withuOrders').doc(intent.originalOrderId);
  const original=await tx.get(root);
  if(!original.exists)stop(404,'원래 음악 주문을 찾을 수 없습니다.');
  const order=original.data();paid(order);
  if(order.delivery?.status!=='sent'||order.upgrade?.rightsVerified!==true)
   stop(403,'상업적 이용 권리 및 완성곡 전달이 확인되지 않았습니다.');
  token=intent.downloadTokenCipher?
   decodeSecret(intent.downloadTokenCipher,env.WITHU_LINK_ENCRYPTION_KEY):
   makeOpaqueToken();
  const tokenRef=db.collection('withuDownloadGrants').doc(tokenHash(token));
  const old=await tx.get(tokenRef);
  const expiresAt=intent.downloadGrantExpiresAt||now()+DOWNLOAD_GRANT_TTL;
  if(!old.exists)
   tx.create(tokenRef,{orderId:order.id,intentId,expiresAt,
    revoked:false,paymentVerified:true,createdAt:now()});
  if(!intent.downloadTokenCipher)
   tx.update(ref,{
    downloadTokenCipher:encodeSecret(token,env.WITHU_LINK_ENCRYPTION_KEY),
    downloadGrantExpiresAt:expiresAt,
    recoveryEmailStatus:'pending'
   });
  info={orderId:order.id,customerEmail:intent.customerEmail,
   recoveryEmailStatus:intent.recoveryEmailStatus||'pending'};
 });
 res.setHeader('Set-Cookie',grantCookie(token));
 return {...info,token};
}
export async function sendRecoveryEmail({db,env,fetcher,intentId,grant}){
 if(grant.recoveryEmailStatus==='accepted')return {status:'already_accepted'};
 const email=grant.customerEmail;
 if(typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  return {status:'missing_recipient'};
 if(!env.RESEND_API_KEY||!env.WITHU_FROM_EMAIL)return {status:'not_configured'};
 const url=new URL('my-music.html#download='+grant.token,env.WITHU_PUBLIC_BASE_URL).href;
 const subject='WITHU · 구매한 원본 음원 다시 받기';
 const text=[
  '원본 음원과 확인된 상업적 이용 옵션의 결제가 완료됐습니다.',
  '아래 링크는 원본 다운로드 권한을 복구하는 개인 링크입니다.',
  url,
  '이 링크는 무료 감상 공유 링크와 달라요. 다른 사람에게 전달하면 다운로드 권한도 공유됩니다.',
  '같은 구매의 원본 음원은 유효한 권한이 있는 동안 횟수 제한 없이 다시 받을 수 있어요.'
 ].join('\n\n');
 try{
  const response=await fetcher('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+env.RESEND_API_KEY,
    'Content-Type':'application/json',
    'Idempotency-Key':'download-recovery-'+intentId},
   body:JSON.stringify({from:env.WITHU_FROM_EMAIL,to:[email],
    subject,text}),
   signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Resend rejected recovery email');
  const value=await response.json();
  if(typeof value?.id!=='string')throw new Error('Resend did not accept message');
  await db.collection('withuUpgradeIntents').doc(intentId).update({
   recoveryEmailStatus:'accepted',recoveryEmailId:value.id,
   recoveryEmailAcceptedAt:now()
  });
  return {status:'accepted',messageId:value.id};
 }catch(_){
  await db.collection('withuUpgradeIntents').doc(intentId)
   .update({recoveryEmailStatus:'needs_retry'});
  return {status:'needs_retry'};
 }
}
export async function redeemDownloadRecovery({db,req,res,token}){
 const grant=await lookupGrant(db,token);
 if(!grant||grant.paymentVerified!==true)
  stop(403,'다운로드 복구 링크가 만료되었거나 유효하지 않습니다.');
 const snap=await db.collection('withuOrders').doc(grant.orderId).get();
 if(!snap.exists)stop(404,'원본 음악 주문을 찾을 수 없습니다.');
 const order=snap.data();paid(order);
 if(order.delivery?.status!=='sent'||order.upgrade?.rightsVerified!==true)
  stop(403,'이 음악의 다운로드 권한이 없습니다.');
 const session=makeOpaqueToken();
 await db.collection('withuSessions').doc(tokenHash(session)).create({
  orderId:order.id,createdAt:now(),expiresAt:now()+SESSION_TTL
 });
 res.setHeader('Set-Cookie',[
  secureCookie('withu_session',session,Math.floor(SESSION_TTL/1000)),
  grantCookie(token)
 ]);
 return order;
}
