/**
 * Private fallback alert to the owner for verified-paid manual production.
 * Do not put the full customer story, song prompt or any private listening
 * token in SMS. The private operator email adapter includes fuller details.
 */
import {makeResendOperatorEmail} from './operator-notification.mjs';
import {normalizeKoreanMobile} from './customer-notification-contact.mjs';
import {ORDER_STATES} from './commerce.mjs';
import {verifyPaidSongPlan} from './song-production-plan.mjs';

export function makeOperatorFallbackAlerts({
 config=process.env,fetcher=globalThis.fetch
}={}){
 const preference=config.WITHU_OPERATOR_ALERT_CHANNEL||'email';
 if(!['email','sms','both'].includes(preference))
  throw new Error('Unknown operator notification preference');
 const sender={
  async sendPaidOrder({order,songPlan,idempotencyKey}={}){
   if(order?.state!==ORDER_STATES.PAID||!order.paymentVerifiedAt
     ||typeof order.paymentKey!=='string'||!order.paymentKey
     ||idempotencyKey!=='withu-operator-'+order.id)
    throw new Error('No operator alert before real verified payment');
   verifyPaidSongPlan(order);
   if(songPlan&&JSON.stringify(songPlan)!==JSON.stringify(order.paidSongPlan))
    throw new Error('Unverified owner work specification');
   const sent=[];
   if(preference==='email'||preference==='both'){
    const operatorEmail=makeResendOperatorEmail({
     apiKey:config.RESEND_API_KEY,
     from:config.WITHU_FROM_EMAIL,
     to:config.WITHU_OPERATOR_EMAIL,
     fetchImpl:fetcher
    });
    const result=await operatorEmail.sendPaidOrder({
     order,songPlan,idempotencyKey
    });
    sent.push({channel:'email',messageId:result.messageId});
   }
   if(preference==='sms'||preference==='both'){
    const phone=normalizeKoreanMobile(config.WITHU_OPERATOR_PHONE);
    const from=String(config.WITHU_BIZGO_SMS_SENDER||'').replace(/\D/g,'');
    const key=config.WITHU_BIZGO_AUTHORIZATION;
    if(typeof key!=='string'||!key.trim()
      ||!/^\d{8,12}$/.test(from))
     throw new Error('Private SMS provider keys and registered sender required');
    const text='[WITHU 주문 제작 요청]\n결제 확인된 주문 '+order.id+
     '\n'+(songPlan?.songs.length||1)+'곡. 비공개 관리자 화면에서 확인하세요.';
    const response=await fetcher('https://mars.ibapi.kr/api/comm/v1/send/omni',{
     method:'POST',headers:{Authorization:key,'Content-Type':'application/json'},
     body:JSON.stringify({
      destinations:[{to:phone}],
      messageFlow:[{mms:{from,title:'WITHU 제작 주문',text}}],
      idempotencyKey:'operator-'+order.id,
      idempotencyTtl:86400
     }),
     signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw new Error('Operator mobile gateway rejected request');
    const data=await response.json();
    const receipt=data?.data?.data?.destinations?.[0];
    if(data?.common?.authCode!=='A000'||data.data?.code!=='A000'
      ||receipt?.code!=='A000'||typeof receipt?.msgKey!=='string')
     throw new Error('Operator SMS was not accepted by provider');
    sent.push({channel:'sms',messageId:receipt.msgKey});
   }
   return Object.freeze({
    status:'operator_alert_accepted',orderId:order.id,
    sent:Object.freeze(sent)
   });
  }
 };
 return Object.freeze(sender);
}
