import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareServerOrderDraft} from '../src/order-draft-preparation.mjs';
import {createPendingCheckoutIntent}
 from '../src/create-verified-checkout-intent.mjs';

const draftId='00000000-2222-4333-8444-555555555555';
const draft=prepareServerOrderDraft({
 selectedProduct:'audio',
 genreSelection:{mode:'single',genres:['발라드']},
 thirdVerse:true,
 story:{
  recipient:'엄마',memory:'저녁마다 엄마와 집 앞을 함께 걷던 기억',
  message:'항상 감사해요',gratitudeApology:'미안해요',occasion:'감사',
  recipientAgeGroup:'50s',relativePosition:'family',
  speechStyle:'polite',genre:'발라드',mood:'감동적인',
  eraPreference:'1980s',lyricLength:'full'
 }
});
const contact={
 customerEmail:'buyer@example.test',
 customerPhone:'01012345678',
 deliveryChannel:'email',deliveryConsent:true
};
test('future checkout creates a pending order from encrypted price, not browser supplied prompts',async()=>{
 let saved=null;
 const result=await createPendingCheckoutIntent({
  draftId,contact,clientAmountKrw:39000
 },{
  privateDrafts:{readById:async id=>{assert.equal(id,draftId);return draft;}},
  orders:{
   createPendingPaymentOrderAtomic:async request=>{
    saved=request;return {outcome:'created',orderId:'WITHU_PENDING_ORDER_001'};
   }
  }
 });
 assert.equal(result.status,'pending_provider_checkout');
 assert.equal(result.paymentVerified,false);
 assert.equal(result.customerDeliveryEnabled,false);
 assert.equal(result.amountKrw,39000);
 assert.equal(saved.amountKrw,39000);
 assert.equal(saved.nextState,'payment_pending');
 assert.equal(saved.deliveryChannel,'email');
 assert.equal(saved.privateDraftId,draftId);
 assert.equal(saved.idempotencyKey,'checkout-from-private-draft:'+draftId);
 assert.ok(!JSON.stringify(result).includes('엄마'));
 assert.ok(!JSON.stringify(result).includes('lyricPrompt'));
 assert.ok(!JSON.stringify(saved).includes('lyricPrompt'));
});
test('there is no pay state without durable trusted storage or when client changes amount',async()=>{
 let stores=0;
 const opts={
  privateDrafts:{readById:async()=>draft},
  orders:{createPendingPaymentOrderAtomic:async()=>{stores++;
   return {outcome:'created',orderId:'WITHU_PENDING_ORDER_001'};
  }}
 };
 for(const extra of [
  {clientAmountKrw:10},{clientPaymentComplete:true},
  {clientLyricPrompt:'fake'}, {clientStylePrompt:'fake'}
 ]){
  await assert.rejects(createPendingCheckoutIntent({
   draftId,contact,...extra
  },opts));
 }
 assert.equal(stores,0);
 await assert.rejects(createPendingCheckoutIntent({
  draftId,contact
 },{privateDrafts:opts.privateDrafts}),/database/);
 await assert.rejects(createPendingCheckoutIntent({
  draftId,contact:{...contact,deliveryConsent:false}
 },opts),/consent/);
 assert.equal(stores,0);
});
