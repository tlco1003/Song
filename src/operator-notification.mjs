/**
 * Private operator email adapter (Resend).
 * It is NOT called by the public order form; only executePaidJob may invoke it
 * after the durable order is marked PAID by verified PG confirmation.
 */
import {ORDER_STATES} from './commerce.mjs';
import {verifyPaidSongPlan} from './song-production-plan.mjs';

function requiredEmail(value,label){
  if(typeof value!=='string'||value.length>254||!/^\S+@\S+\.\S+$/.test(value)||/[\r\n]/.test(value))
    throw new Error('Invalid '+label+' email');
  return value;
}
function safeText(value,max=6000){
  return typeof value==='string'?value.slice(0,max).trim():'';
}
export function makeResendOperatorEmail({
  apiKey=process.env.RESEND_API_KEY,
  from=process.env.WITHU_FROM_EMAIL,
  to=process.env.WITHU_OPERATOR_EMAIL,
  fetchImpl=globalThis.fetch
}={}){
  if(typeof apiKey!=='string'||!apiKey.startsWith('re_'))
    throw new Error('Resend server API key is not configured');
  requiredEmail(from,'from');requiredEmail(to,'operator');
  if(typeof fetchImpl!=='function')throw new Error('Resend HTTP transport missing');
  return Object.freeze({
    async sendPaidOrder({order,songPlan,idempotencyKey}){
      if(order?.state!==ORDER_STATES.PAID||!order.paymentVerifiedAt
        ||typeof order.paymentKey!=='string'||!Number.isSafeInteger(order.amountKrw))
        throw new Error('Operator alert prohibited for unverified payment');
      if(idempotencyKey!=='withu-operator-'+order.id)
        throw new Error('Invalid operator email idempotency key');
      const recipient=requiredEmail(order.customerEmail,'customer');
      const validatedPlan=verifyPaidSongPlan(order);
      if(songPlan&&JSON.stringify(songPlan)!==JSON.stringify(validatedPlan))
        throw new Error('Unapproved genre selection in operator notification');
      const trackLines=validatedPlan.songs.flatMap(track=>[
        '곡 '+track.index+' / '+validatedPlan.songs.length+' — 선택 장르: '+track.genre,
        '곡별 음악 스타일 요청: '+safeText(track.stylePrompt,1200)
      ]);
      const lines=[
        'WITHU — 결제 검증 완료 / 운영자 직접 제작 주문',
        '주문번호: '+safeText(order.id,64),
        '결제상태: PG 서버 확인 완료 (PAID)',
        '상품: '+safeText(order.productId,64),
        '금액: '+order.amountKrw.toLocaleString('ko-KR')+'원',
        '고객 이메일: '+recipient,
        '곡 제목: '+safeText(order.songTitle,100),
        '공통 음악 요청: '+safeText(order.sharedStyleNotes,500),
        '장르 선택 방식: '+validatedPlan.mode,
        '고객 제공 완성곡 수: '+validatedPlan.songs.length+'곡 (각 곡당 최종 검수된 1개만 전달)',
        ...trackLines,
        '확정 가사:',
        safeText(order.confirmedLyrics,5500),
        '사연/특이사항:',
        safeText(order.customerStory,6000),
        '',
        '첨부된 얼굴·목소리 원본은 이 이메일에 포함하지 않습니다.',
        '주문 상세 정보와 결제 증빙은 비공개 주문 관리 시스템에서 확인하세요.',
        '완성곡을 고객에게 전송하기 전에 권리·제작 품질·수신 주소를 확인하세요.'
      ];
      const response=await fetchImpl('https://api.resend.com/emails',{
        method:'POST',
        headers:{
          Authorization:'Bearer '+apiKey,
          'Content-Type':'application/json',
          'Idempotency-Key':idempotencyKey
        },
        body:JSON.stringify({
          from,to:[to],
          subject:'[WITHU 결제확인 주문] '+safeText(order.id,64),
          text:lines.join('\n')
        })
      });
      if(!response.ok)
        throw new Error('Operator email provider rejected the request (HTTP '+response.status+')');
      const result=await response.json();
      if(typeof result?.id!=='string'||!result.id)
        throw new Error('Operator email provider did not return a message ID');
      return Object.freeze({messageId:result.id});
    }
  });
}
