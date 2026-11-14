/**
 * Durable Firestore post-payment processing.
 * Real paid state -> private AI lyrics -> private style plan -> operator alert.
 * Official Lyria is an optional protected branch; unapproved use stays manual.
 * Trigger events are at least-once, claimed with a Firestore transaction.
 */
import {makeLyricsFromPrivatePrompt} from './providers.mjs';
import {buildSongProductionPlan} from './song-production-plan.mjs';
import {now,paid} from './production-runtime.mjs';
import {sendPaidOrderReceipt} from './order-status-portal.mjs';
import {configuredLyriaAutoMode,runLyriaPaidAutomation} from './lyria-paid-automation.mjs';
import {artistSearchEnabled,researchArtistMusicalTraits}
 from './artist-research-provider.mjs';

function musicPlan(order,lyrics){
 const draft=order.draft;
 return buildSongProductionPlan({
  productId:order.productId,genreSelection:order.genreSelection,
  confirmedLyrics:lyrics,songTitle:draft.title,mood:draft.mood,
  eraPreference:draft.eraPreference,
  trackPreferences:draft.trackPreferences,
  thirdVerse:draft.thirdVerse===true,
  dedicationOutro:draft.dedicationOutro===true,
  story:{...draft.story,
   recipientAgeGroup:draft.delivery?.recipientAgeGroup||'unknown',
   speechStyle:draft.delivery?.speechStyle||'auto',
   eraPreference:draft.eraPreference},
  sharedStyleNotes:'',artistPreference:draft.artistPreference||''
 });
}
async function researchPaidArtistIfEnabled({db,orderId,order,env,fetcher}){
 const artist=order.draft?.artistPreference;
 if(!artist||!artistSearchEnabled(env))return null;
 const ref=db.collection('withuArtistResearch').doc(orderId);
 // Payable search requests are claimed once. An unknown outcome requires
 // reconciliation rather than an implicit second charge.
 try{await ref.create({
  status:'submitted',artistName:artist,createdAt:now(),orderId
 });}catch(_){return {status:'previous_research_must_be_reviewed'};}
 try{
  const result=await researchArtistMusicalTraits({
   artistName:artist,genre:order.genreSelection.genres[0],
   era:order.draft?.eraPreference||'auto',
   apiKey:env.GEMINI_API_KEY,fetcher
  });
  await ref.update({...result,updatedAt:now()});
  return result;
 }catch(error){
  const code=typeof error?.code==='string'?error.code:'RESEARCH_FAILED';
  await ref.update({status:'needs_operator_review',reason:code,updatedAt:now()});
  return {status:'needs_operator_review',reason:code};
 }
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
  '음악 제작: '+(order.production?.status==='awaiting_review'
   ?'공식 Lyria API로 비공개 후보 저장 완료 — 관리자 품질·권리 검수 필요'
   :'관리자 직접 제작 또는 자동 제작 실패 점검 필요'),
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
export async function processVerifiedPaidWork({db,bucket,orderId,env=process.env,fetcher=fetch}){
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
 // Send the paid-order receipt before AI lyrics generation, which may take time.
 // A failed email is recorded for authenticated operator retry; never block music.
 let receiptStatus='failed';
 try{
  const receipt=await sendPaidOrderReceipt({db,orderId,env,fetcher});
  receiptStatus=receipt.status;
 }catch(_){/* statusReceipt.failed remains in Firestore. */}
 const artistResearch=await researchPaidArtistIfEnabled({db,orderId,order,env,fetcher});
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
 // Record approved server-only lyrics/style before any billable provider call.
 if(lyrics&&plan)await ref.update({confirmedLyrics:lyrics,privateProductionPlan:plan,
  ...(artistResearch?{artistResearch}:{} )});
 let generation=null,generationError=null;
 if(lyrics&&plan&&configuredLyriaAutoMode(env)){
  try{
   generation=await runLyriaPaidAutomation({
    db,bucket,orderId,order,plan,env,fetcher
   });
  }catch(error){
   // External calls can have unknown billable outcomes. Never silently retry.
   generationError=typeof error?.code==='string'?error.code:'AUTOMATIC_GENERATION_FAILED';
  }
 }
 const production={
  status:generation?.status==='awaiting_review'?'awaiting_review':'manual_required',
  lyricsReady:Boolean(lyrics&&plan),
  styleReady:Boolean(plan),
  lyricError,source:'verified_paid_order',
  reason:generation?'generated_private_candidates_review_required':
   generationError||'commercial_music_api_not_enabled',
  ...(generation?{provider:generation.provider,
   candidateCount:generation.candidateCount}:{}),
  attempts:(order.production?.attempts||0)+1,
  updatedAt:now(),alertStatus:'pending'
 };
 await ref.update({production});
 // Manual fallback always remains visible in Firestore regardless of email.
 const updated={...order,confirmedLyrics:plan?lyrics:null,production};
 let receipt=null;
 try{receipt=await alertOwner({orderId,order:updated,env,fetcher});}
 catch(_){/* Keep persistent pending alert for admin to see/retry. */}
 if(receipt)await ref.update({'production.alertStatus':'provider_accepted',
  'production.alertMessageId':receipt});
 return {status:production.status,lyricsReady:Boolean(plan),
  operatorEmailAccepted:Boolean(receipt),receiptStatus};
}
