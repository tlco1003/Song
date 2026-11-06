/**
 * Construct an emailed personal listening link without placing a customer ID,
 * email, original asset URL or entitlement into public URL query parameters.
 *
 * Persist ONLY the token hash in a protected order store. The raw random token
 * exists solely inside the email job and the customer's URL fragment.
 */
import {randomBytes,createHash} from 'node:crypto';
import {ORDER_STATES} from './commerce.mjs';

const TOKEN_PATTERN=/^[A-Za-z0-9_-]{43}$/;
export function hashPrivateDeliveryToken(token){
 if(typeof token!=='string'||!TOKEN_PATTERN.test(token))
  throw new Error('Invalid personal listening token');
 return createHash('sha256').update(token,'utf8').digest('hex');
}
export function issuePrivateDeliveryInvitation({order,origin,selectedSongs}={}){
 if(!order||![ORDER_STATES.READY_TO_DELIVER,ORDER_STATES.DELIVERED].includes(order.state)
  ||!order.paymentVerifiedAt||typeof order.paymentKey!=='string'||!order.paymentKey
  ||order.recipientVerified!==true||typeof order.customerEmail!=='string'
  ||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customerEmail)
  ||!Array.isArray(selectedSongs)||selectedSongs.length!==(order.productId==='audio_duo'?2:1))
  throw new Error('A verified paid order and selected final songs are required');
 if(typeof origin!=='string')throw new Error('Missing service origin');
 const site=new URL(origin);
 if(site.protocol!=='https:'||site.username||site.password||site.search||site.hash
  ||site.pathname!=='/'||site.host.length<5)
  throw new Error('Email delivery requires a production HTTPS origin');
 const token=randomBytes(32).toString('base64url');
 const url=new URL('/my-music.html',site);
 url.hash='delivery='+token;
 return Object.freeze({
  orderId:order.id,email:order.customerEmail,deliveryUrl:url.href,
  tokenHash:hashPrivateDeliveryToken(token),
  songCount:selectedSongs.length,needsProtectedTokenPersistence:true
 });
}
export async function dispatchPrivateListeningEmail({
 invitation,orders,mailer
}={}){
 if(!invitation||typeof invitation.tokenHash!=='string'
  ||!/^[a-f0-9]{64}$/.test(invitation.tokenHash)
  ||typeof invitation.deliveryUrl!=='string')
  throw new Error('Valid private listening invitation required');
 if(typeof orders?.saveDeliveryTokenHashAtomic!=='function'
  ||typeof mailer?.sendPersonalListeningLink!=='function')
  throw new Error('Protected storage and email adapters required');
 await orders.saveDeliveryTokenHashAtomic({
  orderId:invitation.orderId,tokenHash:invitation.tokenHash,
  idempotencyKey:'delivery-access-'+invitation.orderId
 });
 const result=await mailer.sendPersonalListeningLink({
  to:invitation.email,orderId:invitation.orderId,
  listeningUrl:invitation.deliveryUrl,
  subject:'WITHU · 주문하신 노래가 완성됐어요',
  idempotencyKey:'delivery-email-'+invitation.orderId
 });
 if(!result?.messageId)throw new Error('Email provider did not acknowledge the delivery link');
 return Object.freeze({orderId:invitation.orderId,messageId:result.messageId});
}
