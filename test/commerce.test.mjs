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
   'checkout-prev','checkout-next','go-payment','order-title','order-lyrics']){
  assert.ok(checkout.includes('id="'+id+'"'),id);
 }
 for(const stage of ['product','genre','video','review']){
  assert.ok(checkout.includes('data-checkout-step="'+stage+'"'));
 }
 assert.ok(checkout.includes('href="payment.html"'));
 assert.ok(server.includes("'/payment.html':'docs/payment.html'"));
 assert.ok(server.includes("'/payment.js':'docs/payment.js'"));
 assert.match(checkoutJs,/sessionStorage\.getItem/);
 assert.match(checkoutJs,/history\.pushState/);
 assert.match(checkoutJs,/saveChoices/);
 assert.match(checkoutJs,/stage:currentStage/);
 assert.match(styles,/payment-page-layout/);
 assert.ok(!checkout.includes('id="delivery-email"'));
 assert.ok(!checkout.includes('class="prepay-demo"'));
 assert.ok(!checkout.includes('운영자가 직접 제작'));
 assert.ok(!checkout.includes('FUTURE · API 승인 후'));
});

test('commercial ordering remains disabled and cannot be unlocked by env or user input',()=>{
 const c=publicCommerceReadiness();
 assert.equal(c.canCharge,false);
 assert.equal(c.paymentVerified,false);
 assert.equal(c.musicVerified,false);
 assert.equal(c.licenseVerified,false);
 assert.equal(c.emailVerified,false);
 assert.equal(c.orderStoreVerified,false);
 assert.deepEqual(c.products,['audio','audio_duo','audio_video']);
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.match(paymentJs,/\$\('confirm-checkout'\)\.disabled=true/);
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

test('six planned payment methods are informational, real enabled methods come from Toss widget',()=>{
 const planned=['토스페이','카카오페이','네이버페이','신용·체크카드','계좌이체','가상계좌'];
 for(const label of planned){
  assert.ok(payment.includes(label),'missing planned method: '+label);
 }
 for(const id of ['payment-methods','delivery-email','delivery-email-again',
   'consent-delivery','consent-service','payment-price']){
  assert.ok(payment.includes('id="'+id+'"'),id);
 }
 assert.match(payment,/결제 가능 여부는 토스페이먼츠 상점 계약/);
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.doesNotMatch(payment,/name="paymentMethod"|id="pay-(?:toss|kakao|naver|card|transfer|virtual)"/);
 assert.doesNotMatch(payment,/name="(?:cardNumber|cardCvv|cardPassword|accountPassword)"|autocomplete="cc-number"/i);
 assert.doesNotMatch(paymentJs,/requestPayment\\s*\\(|api\\/payments\\/confirm|fetch\\s*\\(\\s*['"]https?:\\/\\//);
 assert.doesNotMatch(paymentJs,/\\.addEventListener\\('click'[^\\n]*confirm-checkout/);
 assert.ok(styles.includes('.payment-methods'));
 const live=read('docs/payment-live.js');
 assert.match(live,/widgets\\.renderPaymentMethods/);
 assert.match(live,/widgets\\.requestPayment/);
 assert.match(live,/WITHU_PAYMENT_PUBLIC_CONFIG/);
 assert.doesNotMatch(live,/requestPayment\\(\\s*['"](?:toss_pay|kakao_pay|naver_pay)/);
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
 assert.match(paymentJs,/chosen\.quoteRequired/);
 assert.equal(publicCommerceReadiness().canCharge,false);
});
