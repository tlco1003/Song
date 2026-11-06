/**
 * Durable Firestore post-payment processing.
 * Real paid state -> private AI lyrics -> private style plan -> operator alert.
 * Without a licensed commercial Suno REST contract, work is manual.
 * Trigger events are at least-once, claimed with a Firestore transaction.
 */
import {makeLyricsFromPrivatePrompt} from './providers.mjs';
import {buildSongProductionPlan} from './song-production-plan.mjs';
import {now,paid} from './production-runtime.mjs';

function musicPlan(order,lyrics){
 const draft=order.draft;
 return buildSongProductionPlan({
  productId:order.productId,genreSelection:order.genreSelection,
  confirmedLyrics:lyrics,songTitle:draft.title,mood:draft.mood,
  eraPreference:draft.eraPreference,
  story:{...draft.story,
   recipientAgeGroup:draft.delivery?.recipientAgeGroup||'unknown',
   speechStyle:draft.delivery?.speechStyle||'auto',
   eraPreference:draft.eraPreference},
  sharedStyleNotes:''
 });
}
async function alertOwner({orderId,order,env,fetcher}){
 if(typeof env.WITHU_OPERATOR_EMAIL!=='string'||!env.WITHU_OPERATOR_EMAIL.includes('@')
  ||!env.RESEND_API_KEY||!env.WITHU_FROM_EMAIL)return null;
 const subject='[WITHU 제작 주문] 실제 결제 확인 · '+orderId;
 const page=new URL('admin.html',env.WITHU_PUBLIC_BASE_URL).href;
 const text=[
  '고객의 실제 결제가 확인되어 WITHU 제작 대기 목록에 등록됐습니다.',
  '주문 ID: '+orderId,
  '상품: '+(order.productId==='audio_duo'?'2곡':'1곡'),
  '주문금액: '+order.amountKrw+'원',
  'AI 가사 상태: '+(order.confirmedLyrics?'자동 작사 완료':'관리자 수동 작사 필요'),
  '음악 제작: Suno 사업용 API 미연동 — 관리자 직접 제작 및 음원 등록',
  '고객 사연과 서버 전용 스타일 지시를 관리자 화면에서만 확인:',
  page
 ].join('\n');
 const r=await fetcher('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:'Bearer '+env.RESEND_API_KEY,
   'Content-Type':'application/json',
   'Idempotency-Key':'operator-'+orderId},
  body:JSON.stringify({
   from:env.WITHU_FROM_EMAIL,to:[env.WITHU_OPERATOR_EMAIL],subject,text
  }),
  signal:AbortSignal.timeout(12000)
 });
 if(!r.ok)throw new Error('Operator alert provider rejected notification');
 const data=await r.json();
 if(typeof data?.id!=='string')throw new Error('Operator alert not accepted');
 return data.id;
}
export async function processVerifiedPaidWork({db,orderId,env=process.env,fetcher=fetch}){
 const ref=db.collection('withuOrders').doc(orderId);
 let order;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)return;
  const data=snap.data();
  if(data.paymentStatus!=='paid'||data.production?.status!=='pending')return;
  paid(data);order=data;
  tx.update(ref,{production:{
   status:'working',attempts:(data.production?.attempts||0)+1,
   startedAt:now(),updatedAt:now()
  }});
 });
 if(!order)return {status:'skipped'};
 let lyrics=order.confirmedLyrics||null,plan=null;
 let lyricError=null;
 if(!lyrics){
  try{
   lyrics=await makeLyricsFromPrivatePrompt({
    prompt:order.draft?.lyricPrompt,
    lyricLength:order.draft?.lyricLength||'full'
   },env);
  }catch(error){lyricError=error?.name||'AI_PROVIDER_ERROR';}
 }
 if(lyrics){
  try{plan=musicPlan(order,lyrics);}
  catch(error){lyricError='STYLE_CONTRACT_ERROR';plan=null;}
 }
 await ref.update({
  ...(lyrics&&plan?{confirmedLyrics:lyrics,privateProductionPlan:plan}:{}),
  production:{
   status:'manual_required',
   lyricsReady:Boolean(lyrics&&plan),
   styleReady:Boolean(plan),
   lyricError,source:'verified_paid_order',
   reason:'commercial_suno_api_not_connected',
   attempts:(order.production?.attempts||0)+1,
   updatedAt:now(),alertStatus:'pending'
  }
 });
 // Manual fallback always remains visible in Firestore regardless of email.
 const updated={...order,confirmedLyrics:plan?lyrics:null};
 let receipt=null;
 try{receipt=await alertOwner({orderId,order:updated,env,fetcher});}
 catch(_){/* Keep persistent pending alert for admin to see/retry. */}
 if(receipt)await ref.update({'production.alertStatus':'provider_accepted',
  'production.alertMessageId':receipt});
 return {status:'manual_required',lyricsReady:Boolean(plan),
  operatorEmailAccepted:Boolean(receipt)};
}
