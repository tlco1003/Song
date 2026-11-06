/**
 * Real server-side HTTP adapters, intentionally disabled without operator
 * credentials, registered sender and approved Alimtalk template.
 *
 * Bizgo Omni: https://developers.bizgo.io/api-sdk/api-reference/comm/kakao-alimtalk
 *              https://developers.bizgo.io/api-sdk/api-reference/comm/mt
 * Resend: https://resend.com/docs/api-reference/emails/send-email
 *
 * Never import this file in browser code. Never put keys into GitHub Pages.
 */
import {normalizeKoreanMobile,normalizeDeliveryChannel}
 from './customer-notification-contact.mjs';

const BIZGO_URL='https://mars.ibapi.kr/api/comm/v1/send/omni';
const RESEND_URL='https://api.resend.com/emails';
const ID=/^[A-Za-z0-9_-]{6,110}$/;

function requirePublicListeningUrl(value,publicBaseUrl){
 if(typeof value!=='string'||typeof publicBaseUrl!=='string')
  throw new Error('Approved service domain is required');
 const target=new URL(value),base=new URL(publicBaseUrl);
 if(target.protocol!=='https:'||base.protocol!=='https:'||target.origin!==base.origin
  ||target.pathname!=='/my-music.html'||target.search
  ||!/^#delivery=[A-Za-z0-9_-]{43}$/.test(target.hash))
  throw new Error('Only authorized HTTPS My Music links may be delivered');
 return target.href;
}
function requireIdempotencyKey(id){
 if(!ID.test(id))throw new Error('Valid delivery idempotency key required');
 return id;
}
function configField(value,name){
 if(typeof value!=='string'||!value.trim()
  ||/^(?:changeme|placeholder|test-key|your-key|todo|123456)$/i.test(value.trim()))
  throw new Error(name+' must be configured in a protected server environment');
 return value.trim();
}
async function jsonResponse(response){
 if(!response||typeof response.ok!=='boolean')
  throw new Error('Notification provider response missing');
 if(!response.ok)throw new Error('Notification provider request failed');
 const result=await response.json().catch(()=>null);
 if(!result||typeof result!=='object')
  throw new Error('Notification provider returned no confirmation');
 return result;
}
export function createBizgoMobileNotifier({
 config=process.env,fetcher=globalThis.fetch
}={}){
 if(typeof fetcher!=='function')throw new Error('Server fetch capability required');
 return Object.freeze({
  async sendMobileListeningLink({channel,phone,listeningUrl,orderId,idempotencyKey}={}){
   const via=normalizeDeliveryChannel(channel);
   if(via==='email')throw new Error('Email cannot use mobile notifier');
   const to=normalizeKoreanMobile(phone);
   if(typeof orderId!=='string'||orderId.length<6)
    throw new Error('Verified paid order reference required');
   const url=requirePublicListeningUrl(listeningUrl,
    config.WITHU_PUBLIC_BASE_URL);
   const token=configField(config.WITHU_BIZGO_AUTHORIZATION,
    'WITHU_BIZGO_AUTHORIZATION');
   // Body uses the documented Bizgo Omni V2 REST shape; SMS links are longer
   // than 90 bytes, so send LMS (mms without attachments), not truncated SMS.
   let flow;
   if(via==='sms'){
    const sender=String(config.WITHU_BIZGO_SMS_SENDER||'').replace(/\D/g,'');
    if(!/^\d{8,12}$/.test(sender))
     throw new Error('Registered SMS sender number is required');
    flow={mms:{
     from:sender,title:'WITHU 노래 완성 안내',
     text:'[WITHU] 주문하신 노래가 완성됐어요.\n나의 노래함: '+url
    }};
   }else{
    const senderKey=configField(config.WITHU_BIZGO_KAKAO_SENDER_KEY,
     'WITHU_BIZGO_KAKAO_SENDER_KEY');
    const templateCode=configField(config.WITHU_BIZGO_KAKAO_TEMPLATE_CODE,
     'WITHU_BIZGO_KAKAO_TEMPLATE_CODE');
    const approvedText=configField(config.WITHU_BIZGO_KAKAO_TEMPLATE_TEXT,
     'WITHU_BIZGO_KAKAO_TEMPLATE_TEXT');
    if(approvedText.length>1300)throw new Error('Approved Kakao template is too long');
    // This text and button name/type must match the operator's APPROVED
    // Kakao Alimtalk template. Only the dynamic URL placeholder varies.
    flow={alimtalk:{
     msgType:'AT',senderKey,templateCode,text:approvedText,
     attachment:{button:[{
      type:'WL',name:'나의 노래함',urlPc:url,urlMobile:url
     }]}
    }};
   }
   const key=requireIdempotencyKey(idempotencyKey);
   const body={
    destinations:[{to}],
    messageFlow:[flow],
    idempotencyKey:key,idempotencyTtl:86400,ref:key
   };
   const result=await jsonResponse(await fetcher(BIZGO_URL,{
    method:'POST',
    headers:{Authorization:token,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(10000)
   }));
   const recipient=result.data?.data?.destinations?.[0];
   if(result.common?.authCode!=='A000'||result.data?.code!=='A000'
     ||recipient?.code!=='A000'||typeof recipient.msgKey!=='string'
     ||recipient.msgKey.length<5)
    throw new Error('Bizgo has not accepted the transactional message');
   return Object.freeze({
    accepted:true,channel:via,messageId:recipient.msgKey,provider:'bizgo'
   });
  }
 });
}
export function createResendTransactionalMailer({
 config=process.env,fetcher=globalThis.fetch
}={}){
 if(typeof fetcher!=='function')throw new Error('Server fetch capability required');
 return Object.freeze({
  async sendPersonalListeningLink({to,listeningUrl,subject,idempotencyKey}={}){
   if(typeof to!=='string'||to.length>254
     ||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(to))
    throw new Error('Verified customer email is required');
   const url=requirePublicListeningUrl(listeningUrl,config.WITHU_PUBLIC_BASE_URL);
   const apiKey=configField(config.RESEND_API_KEY,'RESEND_API_KEY');
   const from=configField(config.WITHU_FROM_EMAIL,'WITHU_FROM_EMAIL');
   const key=requireIdempotencyKey(idempotencyKey);
   const body={
    from,to:[to],subject:subject||'WITHU · 주문하신 노래가 완성됐어요',
    text:'WITHU 노래가 완성됐어요.\n본인 전용 나의 노래함 링크:\n'+url+
      '\n다른 사람에게 공유하지 마세요.'
   };
   const result=await jsonResponse(await fetcher(RESEND_URL,{
    method:'POST',
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',
      'Idempotency-Key':key},
    body:JSON.stringify(body),signal:AbortSignal.timeout(10000)
   }));
   if(typeof result.id!=='string'||result.id.length<5)
    throw new Error('Email provider has not accepted the delivery');
   return Object.freeze({messageId:result.id,provider:'resend'});
  }
 });
}
