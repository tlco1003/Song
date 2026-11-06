/**
 * Pure, testable invariants shared by Firebase production and local tests.
 * Only server-owned prices, a real PG DONE receipt and a per-order session
 * may grant a customer access. Browser values are never proof of payment.
 */
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {quoteOrderAmount} from './order-pricing.mjs';
export const UPGRADE_KRW=10000;
const ID=/^withu_[a-f0-9]{32}$/;
const UPGRADE_ID=/^upg_[a-f0-9]{32}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function makeProductionId(prefix='withu'){
 if(!['withu','upg'].includes(prefix))throw new Error('Invalid id prefix');
 return prefix+'_'+randomBytes(16).toString('hex');
}
export function requireProductionId(id,{upgrade=false}={}){
 if(typeof id!=='string'||!(upgrade?UPGRADE_ID:ID).test(id))
  throw new Error('Unrecognized server-generated order id');
 return id;
}
export function makeOpaqueToken(){return randomBytes(32).toString('base64url');}
export function tokenHash(token){
 if(typeof token!=='string'||!TOKEN.test(token))throw new Error('Invalid access token');
 return createHash('sha256').update(token,'utf8').digest('hex');
}
export function safeHashEqual(a,b){
 if(!/^[a-f0-9]{64}$/.test(String(a))||!/^[a-f0-9]{64}$/.test(String(b)))return false;
 return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
export function assertExactTossPayment({orderId,amountKrw,paymentKey,kind}={},receipt={}){
 requireProductionId(orderId,{upgrade:kind==='upgrade'});
 if(typeof paymentKey!=='string'||paymentKey.length<6||paymentKey.length>200)
  throw new Error('Invalid Toss paymentKey');
 if(!Number.isSafeInteger(amountKrw)||amountKrw<=0)
  throw new Error('Invalid server-owned price');
 if(receipt.orderId!==orderId||receipt.paymentKey!==paymentKey
   ||receipt.status!=='DONE'||receipt.currency!=='KRW'
   ||receipt.totalAmount!==amountKrw||receipt.balanceAmount!==amountKrw)
  throw new Error('Toss receipt fails order, status, currency or amount check');
 return true;
}
export function commercialMode(env=process.env){
 const mode=env.WITHU_PAYMENT_MODE;
 if(!['test','live'].includes(mode))return null;
 const live=mode==='live';
 const publicKey=env.TOSS_CLIENT_KEY||'';
 const secret=env.TOSS_SECRET_KEY||'';
 if(!publicKey.startsWith(live?'live_gck':'test_gck')
  ||!secret.startsWith(live?'live_gsk':'test_gsk'))
  return null;
 if(live&&env.WITHU_LIVE_PAYMENTS_ENABLED!=='true')return null;
 if(!/^https:\/\/[^/]+\/?$/.test(env.WITHU_PUBLIC_BASE_URL||''))return null;
 if(!env.WITHU_FROM_EMAIL||!env.RESEND_API_KEY)return null;
 return {mode,clientKey:publicKey};
}
export function assertValidPreparedOrder(draft){
 if(draft?.status!=='awaiting_verified_payment'||draft.verifiedPaid!==false)
  throw new Error('Expected protected server-generated draft');
 const quote=quoteOrderAmount({
  productId:draft.productId,genreSelection:draft.genreSelection,
  thirdVerse:draft.thirdVerse,dedicationOutro:draft.dedicationOutro,
  dedicationText:draft.dedicationText
 });
 if(quote.quoteRequired||quote.amountKrw!==draft.amountBreakdown?.amountKrw)
  throw new Error('Server-owned price did not match prepared draft');
 return quote.amountKrw;
}
export function authorizeOrderMedia({sessionOrderId,assetOrderId,kind,order}={}){
 requireProductionId(sessionOrderId);
 requireProductionId(assetOrderId);
 if(sessionOrderId!==assetOrderId)throw new Error('Other customer song not authorized');
 if(!order||order.paymentStatus!=='paid'||order.delivery?.status!=='sent')
  throw new Error('Unpaid or undelivered song not authorized');
 if(kind==='download'&&!(order.upgrade?.paymentStatus==='paid'
    &&order.upgrade?.rightsVerified===true))
  throw new Error('Download rights and separate payment required');
 if(!['playback','download'].includes(kind))throw new Error('Invalid media access kind');
 return true;
}
