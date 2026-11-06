import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORDER_STATES} from '../src/commerce.mjs';
import {prepareServerOrderDraft} from '../src/order-draft-preparation.mjs';
import {runClaimedVerifiedOrder} from '../src/verified-fulfillment-worker.mjs';
import {confirmCheckoutAndQueue,FULFILLMENT_ROUTE} from '../src/paid-order-pipeline.mjs';
import {makeOperatorFallbackAlerts} from '../src/operator-alert-channels.mjs';

const input={
 selectedProduct:'audio',genreSelection:{mode:'single',genres:['발라드']},
 story:{
  recipient:'엄마',occasion:'감사',
  memory:'어릴 때 늦은 밤 집 앞에서 기다리던 엄마를 기억해요.',
  message:'늘 고맙고 사랑해요',gratitudeApology:'감사를 전하지 못했어요',
  recipientAgeGroup:'50s',relativePosition:'family',speechStyle:'polite',
  genre:'발라드',mood:'감동적인',eraPreference:'1980s',lyricLength:'full'
 }
};
const privateDraft=prepareServerOrderDraft(input);
const id='WITHU_PAY_00001',paymentKey='provider-verified-payment';
const draftId='00000000-1111-4222-8333-444444444444';
const lyric='[Verse 1]\n기다리던 밤을 기억해요\n[Chorus]\n사랑하는 엄마에게';
function memoryPorts({route=FULFILLMENT_ROUTE.HUMAN,agreement=false}={}){
 let order={
  id,productId:'audio',genreSelection:input.genreSelection,
  privateDraftId:draftId,amountKrw:29000,currency:'KRW',
  state:ORDER_STATES.PAID,paymentKey,paymentVerifiedAt:'2026-11-06T05:00:00Z',
  fulfillmentRoute:route,confirmedLyrics:null,
  songTitle:'엄마에게',story:input.story,mood:'감동적인',
  eraPreference:'1980s',sharedStyleNotes:'',
  commercialApiAgreementVerified:agreement,
  thirdVerse:false,dedicationOutro:false,dedicationText:''
 };
 let lyricsStored=0,plansStored=0,notifications=0,candidatesStored=0,fallbacks=0;
 const orders={
  async getById(idValue){assert.equal(idValue,id);return structuredClone(order);},
  async storeGeneratedLyricsAtomic(value){
   assert.equal(value.orderId,id);
   assert.equal(value.expectedState,ORDER_STATES.PAID);
   assert.equal(value.boundDraftId,draftId);
   assert.ok(value.confirmedLyrics.includes('엄마'));
   lyricsStored++;
   order={...order,confirmedLyrics:value.confirmedLyrics,songTitle:value.title};
   return {outcome:'created'};
  },
  async persistPaidSongPlanAtomic(payload){
   assert.equal(payload.orderId,id);
   assert.equal(payload.privateDraftId,draftId);
   assert.ok(order.confirmedLyrics);
   assert.ok(payload.songPlan.songs.every(s=>s.stylePrompt.length<=1000));
   plansStored++;
   order={...order,paidSongPlan:structuredClone(payload.songPlan)};
   return {outcome:'created'};
  },
  async routeUnstartedJobToManualAtomic(input){
   assert.equal(input.reason,'no_verified_commercial_music_api');
   fallbacks++;
   order={...order,fulfillmentRoute:FULFILLMENT_ROUTE.HUMAN};
   return {key:'fulfill:'+id,orderId:id,route:FULFILLMENT_ROUTE.HUMAN,status:'claimed'};
  },
  async recordPrivateMusicCandidatesAtomic(payload){
   assert.equal(payload.expectedPurchasedSongCount,1);
   candidatesStored++;return {outcome:'created'};
  }
 };
 const operatorEmail={
  async sendPaidOrder({order:current,songPlan,idempotencyKey}){
   notifications++;
   assert.equal(current.state,ORDER_STATES.PAID);
   assert.equal(idempotencyKey,'withu-operator-'+id);
   assert.equal(songPlan.songs.length,1);
   return {messageId:'operator_mock_email'};
  }
 };
 const job={key:'fulfill:'+id,orderId:id,route,status:'claimed'};
 return {orders,job,operatorEmail,read:()=>structuredClone(order),metrics:()=>({
  lyricsStored,plansStored,notifications,candidatesStored,fallbacks
 })};
}
const source=()=>({readById:async()=>structuredClone(privateDraft)});

test('an authentic server payment may queue PRE-lyric intent without fabricating finished lyrics',async()=>{
 const pending={
  id,privateDraftId:draftId,state:ORDER_STATES.PAYMENT_PENDING,
  productId:'audio',genreSelection:input.genreSelection,
  amountKrw:29000,currency:'KRW',confirmedLyrics:null
 };
 let paidCalls=0,queued=0;
 const orders={
  getById:async()=>pending,
  confirmPaidAndEnqueueAtomic:async(payload)=>{
   queued++;
   assert.equal(payload.songPlan,null);
   assert.equal(payload.productionIntent.status,'prepare_lyrics_after_verified_payment');
   assert.equal(payload.productionIntent.privateDraftId,draftId);
   return {outcome:'created',route:FULFILLMENT_ROUTE.HUMAN};
  }
 };
 const payments={confirm:async()=>{paidCalls++;return {
  status:'DONE',orderId:id,paymentKey,currency:'KRW',
  totalAmount:29000,balanceAmount:29000
 }},retrieve:async()=>{throw Error('unused')}};
 const result=await confirmCheckoutAndQueue({
  orderId:id,paymentKey,claimedAmountKrw:29000,orders,payments
 });
 assert.equal(result.status,'paid_verified');
 assert.equal(paidCalls,1);assert.equal(queued,1);
 const wrong=await assert.rejects(confirmCheckoutAndQueue({
  orderId:id,paymentKey,claimedAmountKrw:29001,orders,payments
 }),/amount mismatch/);
 assert.equal(paidCalls,1);
});
test('manual fulfillment: paid order -> private lyrics -> song style -> operator email, not customer link',async()=>{
 const m=memoryPorts();let aiCalls=0;
 const result=await runClaimedVerifiedOrder({
  job:m.job,orders:m.orders,privateDrafts:source(),
  lyricProvider:async({prompt})=>{
   aiCalls++;assert.ok(prompt.includes('엄마'));return lyric;
  },
  operatorEmail:m.operatorEmail
 });
 assert.equal(result.route,'manual_operator');
 assert.equal(result.awaitingHumanReview,true);
 assert.equal(result.customerDeliveryStarted,false);
 assert.equal(result.promptPrivate,true);
 assert.equal(m.read().confirmedLyrics,lyric);
 assert.ok(m.read().paidSongPlan.songs[0].stylePrompt.length<=1000);
 assert.deepEqual(m.metrics(),{
  lyricsStored:1,plansStored:1,notifications:1,candidatesStored:0,fallbacks:0
 });
 assert.equal(aiCalls,1);
});
test('unavailable licensed Suno business API causes durable manual fallback, never consumer MCP',async()=>{
 const m=memoryPorts({route:FULFILLMENT_ROUTE.APPROVED_API});
 let generated=0;
 const r=await runClaimedVerifiedOrder({
  job:m.job,orders:m.orders,privateDrafts:source(),
  lyricProvider:async()=>lyric,operatorEmail:m.operatorEmail,
  musicProvider:{async createLicensedSong(){generated++;return {id:'never'};}},
  commercialApiAgreementVerified:false,musicProviderReady:false
 });
 assert.equal(r.route,'manual_operator');
 assert.equal(m.metrics().fallbacks,1);
 assert.equal(m.metrics().notifications,1);
 assert.equal(generated,0);
});
test('approved B2B path creates only paid private candidates pending manual quality approval',async()=>{
 const m=memoryPorts({route:FULFILLMENT_ROUTE.APPROVED_API,agreement:true});
 let created=0;
 const outcome=await runClaimedVerifiedOrder({
  job:m.job,orders:m.orders,privateDrafts:source(),
  lyricProvider:async()=>lyric,operatorEmail:m.operatorEmail,
  commercialApiAgreementVerified:true,musicProviderReady:true,
  musicProvider:{async createLicensedSong({song}){created++;
   assert.equal(song.genre,'발라드');
   assert.ok(song.stylePrompt.length<=1000);
   return {providerJobId:'licensed_b2b_fake_id',privateStatus:'candidate_unreviewed'};
  }}
 });
 assert.equal(outcome.route,'approved_music_api');
 assert.equal(outcome.customerDeliveryStarted,false);
 assert.equal(created,1);
 assert.equal(m.metrics().candidatesStored,1);
 assert.equal(m.metrics().notifications,0);
});
test('no provider, prompt or operator notification is triggered by an unpaid order',async()=>{
 const m=memoryPorts();
 const original=m.orders.getById;
 m.orders.getById=async()=>({...await original(id),state:ORDER_STATES.PAYMENT_PENDING});
 let ai=0,alerts=0;
 await assert.rejects(runClaimedVerifiedOrder({
  job:m.job,orders:m.orders,privateDrafts:source(),
  lyricProvider:async()=>{ai++;return lyric;},
  operatorEmail:{sendPaidOrder:async()=>{alerts++;return {messageId:'bad'};}}
 }),/verified-paid/);
 assert.equal(ai,0);assert.equal(alerts,0);
});
test('operator SMS contains only order reference, never full prompt or customer contact',async()=>{
 const m=memoryPorts();
 const lyricProvider=async()=>lyric;
 await runClaimedVerifiedOrder({
  job:m.job,orders:m.orders,privateDrafts:source(),
  lyricProvider,operatorEmail:m.operatorEmail
 });
 let requests=[];
 const mail=makeOperatorFallbackAlerts({
  config:{
   WITHU_OPERATOR_ALERT_CHANNEL:'sms',
   WITHU_OPERATOR_PHONE:'010-9999-8888',
   WITHU_BIZGO_SMS_SENDER:'0212345678',
   WITHU_BIZGO_AUTHORIZATION:'configured_test_mock_auth'
  },
  fetcher:async(_url,options)=>{
   requests.push(JSON.parse(options.body));
   return {ok:true,json:async()=>({
    common:{authCode:'A000'},
    data:{code:'A000',data:{destinations:[{code:'A000',msgKey:'mock_alert_001'}]}}
   })};
  }
 });
 const result=await mail.sendPaidOrder({
  order:m.read(),songPlan:m.read().paidSongPlan,
  idempotencyKey:'withu-operator-'+id
 });
 assert.equal(result.status,'operator_alert_accepted');
 assert.equal(result.sent[0].channel,'sms');
 assert.equal(requests.length,1);
 const body=JSON.stringify(requests[0]);
 assert.ok(body.includes(id));
 assert.ok(!body.includes('도시락'));
 assert.ok(!body.includes('기다리던 밤'));
 assert.ok(!body.includes('buyer@example'));
});
