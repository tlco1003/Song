/**
 * Resend delivery status webhook verification. This does NOT declare an
 * email as delivered merely because the initial Resend POST returned 200.
 *
 * Svix-compatible HMAC: id.timestamp.RAW_BODY, whsec_ base64 key, v1 signature.
 * Reject replayed/stale/malformed requests before any database mutations.
 * Docs: https://resend.com/docs/dashboard/webhooks/introduction
 *       https://www.svix.com/guides/receiving/receive-webhooks-with-typescript-nodejs/
 */
import {createHmac,timingSafeEqual} from 'node:crypto';

const TYPES=Object.freeze({
 'email.sent':'provider_sent',
 'email.delivered':'recipient_server_accepted',
 'email.bounced':'recipient_rejected',
 'email.failed':'send_failed',
 'email.delivery_delayed':'recipient_delivery_delayed',
 'email.suppressed':'recipient_suppressed'
});
export function verifyResendDeliveryWebhook({
 rawBody,headers,signingSecret,nowMs=Date.now()
}={}){
 if(typeof signingSecret!=='string'||!/^whsec_[A-Za-z0-9+/=_-]{20,}$/.test(signingSecret))
  throw new Error('Verified Resend webhook signing secret is required');
 const id=headers?.['svix-id'],timestamp=headers?.['svix-timestamp'];
 const signature=headers?.['svix-signature'];
 if(typeof id!=='string'||id.length<8||id.length>200
  ||typeof timestamp!=='string'||!/^\d{10,12}$/.test(timestamp)
  ||typeof signature!=='string'||signature.length>800)
  throw new Error('Missing authenticated webhook headers');
 const when=Number(timestamp)*1000;
 if(!Number.isFinite(when)||Math.abs(nowMs-when)>5*60*1000)
  throw new Error('Webhook timestamp expired or too far into future');
 if(!Buffer.isBuffer(rawBody)||rawBody.length<4||rawBody.length>64000)
  throw new Error('Raw webhook body is missing or too large');
 const secret=Buffer.from(signingSecret.slice('whsec_'.length),'base64');
 if(secret.length<16)throw new Error('Invalid webhook key material');
 const mac=createHmac('sha256',secret)
  .update(id+'.'+timestamp+'.','utf8').update(rawBody).digest();
 const valid=signature.split(/\s+/).some(item=>{
  if(!item.startsWith('v1,'))return false;
  const raw=item.slice(3);
  if(!/^[A-Za-z0-9+/=]{40,100}$/.test(raw))return false;
  const actual=Buffer.from(raw,'base64');
  return actual.length===mac.length&&timingSafeEqual(actual,mac);
 });
 if(!valid)throw new Error('Webhook signature verification failed');
 let parsed;
 try{parsed=JSON.parse(rawBody.toString('utf8'));}
 catch(_){throw new Error('Invalid verified webhook JSON');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
  throw new Error('Invalid verified webhook payload');
 const status=TYPES[parsed.type];
 if(!status)throw new Error('Unsupported email status event');
 const emailId=parsed.data?.email_id||parsed.data?.id;
 if(typeof emailId!=='string'||emailId.length<8||emailId.length>200)
  throw new Error('Unknown email delivery record');
 return Object.freeze({
  eventId:id,emailId,status,
  createdAt:typeof parsed.created_at==='string'?parsed.created_at:null,
  source:'resend_signed_webhook',
  // Never store full raw email body, listening links or address in analytics.
  providerDeliveredToServer:status==='recipient_server_accepted'
 });
}
export async function recordResendDeliveryWebhook({
 verifiedEvent,deliveryStore
}={}){
 if(verifiedEvent?.source!=='resend_signed_webhook'
  ||typeof verifiedEvent.eventId!=='string'
  ||typeof deliveryStore?.recordDeliveryStatusAtomic!=='function')
  throw new Error('Durable protected delivery tracking store required');
 const result=await deliveryStore.recordDeliveryStatusAtomic({
  eventId:verifiedEvent.eventId,
  providerMessageId:verifiedEvent.emailId,
  nextStatus:verifiedEvent.status,
  providerDeliveredToServer:verifiedEvent.providerDeliveredToServer,
  idempotencyKey:'resend-webhook:'+verifiedEvent.eventId
 });
 if(!result||!['created','duplicate'].includes(result.outcome))
  throw new Error('Signed email webhook status was not recorded durably');
 return Object.freeze({acknowledged:true,outcome:result.outcome});
}
