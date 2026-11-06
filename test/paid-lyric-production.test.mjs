import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORDER_STATES} from '../src/commerce.mjs';
import {prepareServerOrderDraft} from '../src/order-draft-preparation.mjs';
import {generatePaidOrderLyrics} from '../src/paid-lyric-production.mjs';

const input={
 selectedProduct:'audio',genreSelection:{mode:'single',genres:['발라드']},
 story:{recipient:'엄마',memory:'어릴 때 밤마다 집 앞에서 기다려 주셨던 기억이 있어요.',
  message:'언제나 사랑하고 감사합니다',gratitudeApology:'',
  occasion:'감사',recipientAgeGroup:'50s',relativePosition:'older',
  speechStyle:'polite',genre:'발라드',mood:'감동적인',
  eraPreference:'1980s',lyricLength:'full'}
};
const draft=prepareServerOrderDraft(input);
function paidOrder(){
 return {id:'order_id_12345',productId:'audio',genreSelection:input.genreSelection,
  state:ORDER_STATES.PAID,paymentKey:'verified-key-1234',
  paymentVerifiedAt:'2026-11-06T00:00:00Z',privateDraftId:'11111111-1111-4111-8111-111111111111'};
}
test('private lyric generation cannot run before a real verified payment',async()=>{
 let calls=0;
 const provider=async()=>{calls++;return '[Verse]\n엄마 사랑해\n[Chorus]\n언제나 고마워'};
 const store={storeGeneratedLyricsAtomic:async()=>({outcome:'created'})};
 for(const changes of [
  {state:ORDER_STATES.PAYMENT_PENDING},{paymentKey:''},
  {paymentVerifiedAt:null},{privateDraftId:''}
 ]){
  await assert.rejects(generatePaidOrderLyrics({
   order:{...paidOrder(),...changes},privateDraft:draft,lyricProvider:provider,orders:store
  }),/Verified paid order/);
 }
 assert.equal(calls,0);
});
test('verified payment creates private lyrics and style once through transactional store',async()=>{
 let observed=null,calls=0;
 const order=paidOrder();
 const provider=async({prompt,lyricLength})=>{
  calls++;assert.ok(prompt.includes('기다려 주셨던'));assert.equal(lyricLength,'full');
  return '[Verse]\n엄마, 어릴 때 밤을 기억해요\n[Chorus]\n늘 고마웠어요';
 };
 const store={async storeGeneratedLyricsAtomic(data){
  observed=data;return {outcome:'created'};
 }};
 const result=await generatePaidOrderLyrics({order,privateDraft:draft,lyricProvider:provider,orders:store});
 assert.equal(calls,1);
 assert.deepEqual(result,{status:'server_lyrics_saved',orderId:order.id,outcome:'created'});
 assert.equal(observed.orderId,order.id);
 assert.equal(observed.boundDraftId,order.privateDraftId);
 assert.equal(observed.jobKey,'paid-lyrics:'+order.id);
 assert.equal(observed.selectedStyles.length,1);
 assert.ok(observed.selectedStyles[0].style.length<=1000);
 assert.ok(!JSON.stringify(result).includes('어릴 때'));
});
test('server rejects a switched genre or an invalid generated song',async()=>{
 let calls=0;
 const provider=async()=>{calls++;return '가사가 아닌 문장'};
 const order=paidOrder(),store={storeGeneratedLyricsAtomic:async()=>({outcome:'created'})};
 await assert.rejects(generatePaidOrderLyrics({
  order:{...order,genreSelection:{mode:'single',genres:['재즈']}},
  privateDraft:draft,lyricProvider:provider,orders:store
 }),/choice changed/);
 assert.equal(calls,0);
 await assert.rejects(generatePaidOrderLyrics({
  order,privateDraft:draft,lyricProvider:provider,orders:store
 }),/structure contract/);
 assert.equal(calls,1);
});
