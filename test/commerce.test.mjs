import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORDER_STATES,assertOrderTransition,publicCommerceReadiness,publicPriceCatalog} from '../src/commerce.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const checkout=read('docs/checkout.html');
const checkoutJs=read('docs/checkout.js');
const payment=read('docs/payment.html');
const paymentJs=read('docs/payment.js');
const styles=read('docs/checkout.css');
const create=read('docs/create.html');
const server=read('src/server.mjs');

test('story and product stages navigate to a separate payment page',()=>{
 assert.match(create,/href="checkout\.html"/);
 for(const id of ['product-audio','product-video','product-audio-duo','song-genre-first','song-genre-second',
   'checkout-prev','checkout-next','go-payment','order-title','order-mood-era']){
  assert.ok(checkout.includes('id="'+id+'"'),id);
 }
 for(const stage of ['product','review']){
  assert.ok(checkout.includes('data-checkout-step="'+stage+'"'));
 }
 assert.ok(!checkout.includes('data-checkout-step="genre"'));
 assert.ok(!checkout.includes('data-checkout-step="video"'));
 for(const id of ['inline-genre-options','video-inline-options','order-memory','order-message',
  'order-gratitudeApology','order-occasion','order-recipientAgeGroup',
  'order-relativePosition','order-speechStyle'])assert.ok(checkout.includes('id="'+id+'"'),id);
 assert.ok(checkout.includes('href="payment.html"'));
 assert.ok(server.includes("'/payment.html':'docs/payment.html'"));
 assert.ok(server.includes("'/payment.js':'docs/payment.js'"));
 assert.match(checkoutJs,/sessionStorage\.getItem/);
 assert.ok(!checkout.includes('id="order-lyrics"'));
 assert.ok(!checkout.includes('확정 가사'));
 assert.match(checkoutJs,/api\/commerce\/drafts/);
 assert.match(checkoutJs,/history\.pushState/);
 assert.match(checkoutJs,/saveChoices/);
 assert.match(checkoutJs,/stage:currentStage/);
 assert.match(styles,/payment-page-layout/);
 assert.ok(!payment.includes('payment-summary'));
 assert.ok(payment.includes('payment-total-line'));
 assert.ok(!payment.includes('id="payment-song-genres"'));
 assert.match(create,/href="checkout.html"/);
 assert.ok(!checkout.includes('id="delivery-email"'));
 assert.ok(!checkout.includes('class="prepay-demo"'));
 assert.ok(!checkout.includes('운영자가 직접 제작'));
 assert.ok(!checkout.includes('FUTURE · API 승인 후'));
});

test('the legacy local server stays locked, while real Firebase checkout requires configured PG and server proof',()=>{
 const c=publicCommerceReadiness();
 assert.equal(c.canCharge,false);
 assert.equal(c.paymentVerified,false);
 assert.equal(c.orderStoreVerified,false);
 assert.deepEqual(c.products,['audio','audio_duo','audio_video']);
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.match(paymentJs,/fetch\('\/api\/runtime'/);
 assert.match(paymentJs,/cfg\.canCharge!==true/);
 assert.match(paymentJs,/fetch\('\/api\/orders'/);
 assert.match(paymentJs,/widgets\.requestPayment/);
 const pg=read('src/production-payments.mjs');
 assert.match(pg,/assertExactTossPayment/);
 assert.match(pg,/confirmLockUntil/);
 assert.match(pg,/prepareServerOrderDraft/);
 assert.ok(!pg.includes('TEST_PAYMENT_COMPLETE_NO_CHARGE'));
});
test('payment never considered paid without provider proof and server-owned amount',()=>{
 assert.throws(()=>assertOrderTransition(ORDER_STATES.PAYMENT_PENDING,ORDER_STATES.PAID,{}));
 assert.throws(()=>assertOrderTransition(ORDER_STATES.PAYMENT_PENDING,ORDER_STATES.PAID,{verifiedProviderPayment:true}));
 assert.ok(assertOrderTransition(ORDER_STATES.PAYMENT_PENDING,ORDER_STATES.PAID,{
  verifiedProviderPayment:true,matchesServerOrderAmount:true
 }));
});

test('commercial music generation and delivery require separately verified proof',()=>{
 assert.throws(()=>assertOrderTransition(ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,{}));
 assert.ok(assertOrderTransition(ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,{commercialMusicLicenseVerified:true}));
 assert.throws(()=>assertOrderTransition(ORDER_STATES.READY_TO_DELIVER,ORDER_STATES.DELIVERING,{storedOutputVerified:true}));
 assert.ok(assertOrderTransition(ORDER_STATES.READY_TO_DELIVER,ORDER_STATES.DELIVERING,{
  storedOutputVerified:true,recipientVerified:true
 }));
});

test('Toss v2 payment methods render inside provider-owned widget, not fake clickable payment chips',()=>{
 assert.match(payment,/https:\/\/js\.tosspayments\.com\/v2\/standard/);
 assert.match(payment,/id="toss-payment-methods"/);
 assert.match(payment,/id="toss-payment-agreement"/);
 assert.match(paymentJs,/widgets\.renderPaymentMethods/);
 assert.match(paymentJs,/widgets\.renderAgreement/);
 assert.match(paymentJs,/widgets\.requestPayment/);
 for(const label of ['토스페이','카카오페이','네이버페이','신용·체크카드','계좌이체']){
  assert.ok(payment.includes(label),label);
 }
 for(const id of ['payment-methods','delivery-email','delivery-phone',
  'delivery-channel-options','consent-delivery','consent-service','payment-price'])
  assert.ok(payment.includes('id="'+id+'"'),id);
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.ok(!payment.includes('id="delivery-email-again"'));
 for(const channel of ['deliver-email','deliver-sms','deliver-kakao'])
  assert.ok(payment.includes('id="'+channel+'"'));
 assert.doesNotMatch(payment,/name="(?:cardNumber|cardCvv|cardPassword|accountPassword)"|autocomplete="cc-number"/i);
 assert.doesNotMatch(paymentJs,/TOSS_SECRET_KEY|paymentStatus:\s*['"]paid['"]/);
 assert.ok(styles.includes('.payment-methods'));
});
test('catalog prices and advance quote remain unchanged',()=>{
 const catalog=publicPriceCatalog();
 assert.equal(catalog.currency,'KRW');
 assert.deepEqual(catalog.products.map(p=>[p.id,p.amountKrw,p.priceKind,p.quoteRequired]),[
  ['audio',29000,'fixed',false],
  ['audio_duo',39000,'fixed',false],
  ['audio_video',300000,'starting_at',true]
 ]);
 assert.equal(catalog.products[0].amountKrw*2-catalog.products[1].amountKrw,19000);
 assert.deepEqual(catalog,JSON.parse(read('docs/prices.json')));
 for(const id of ['audio','audio_duo','audio_video']){
  assert.ok(checkout.includes('data-price-for="'+id+'"'));
 }
 assert.match(checkoutJs,/fetch\('prices.json'/);
 assert.match(checkoutJs,/quoteRequired/);
 assert.match(paymentJs,/product\.quoteRequired/);
 assert.equal(publicCommerceReadiness().canCharge,false);
});
