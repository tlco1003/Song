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

test('all payment methods remain clickable choice chips and use the direct/standard Toss gateway',()=>{
 const choices=[
  ['toss_pay','토스페이'],['naver_pay','네이버페이'],
  ['kakao_pay','카카오페이'],['payco','페이코'],
  ['samsung_pay','삼성페이'],['apple_pay','애플페이'],
  ['card','신용·체크카드'],['transfer','실시간 계좌이체'],
  ['virtual_account','가상계좌'],['mobile_phone','휴대폰 결제'],
  ['culture_gift','문화상품권'],['book_gift','도서문화상품권'],
  ['game_gift','게임문화상품권']
 ];
 for(const [id,label] of choices){
  assert.match(payment,new RegExp('id="pay-'+id+'"[^>]*name="paymentMethod"[^>]*value="'+id+'"'));
  assert.ok(payment.includes(label),'missing payment label: '+label);
  assert.match(paymentJs,new RegExp('(?:'+id+')'));
 }
 assert.match(payment,/class="payment-option payment-choice-chip"/);
 assert.match(payment,/id="withu-direct-pay-consent"/);
 assert.match(payment,/id="withu-direct-financial-terms"/);
 assert.match(payment,/id="withu-direct-privacy-terms"/);
 assert.match(payment,/id="withu-direct-third-party-terms"/);
 for(const id of ['payment-methods','delivery-email','delivery-email-again',
   'consent-delivery','consent-service','payment-price']){
  assert.ok(payment.includes('id="'+id+'"'),id);
 }
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.doesNotMatch(payment,/name="(?:cardNumber|cardCvv|cardPassword|accountPassword)"|autocomplete="cc-number"/i);
 assert.doesNotMatch(paymentJs,/requestPayment\s*\(|api\/payments\/confirm|fetch\s*\(\s*['"]https?:\/\//);
 const live=read('docs/payment-live.js');
 const mapping=read('docs/payment-methods.js');
 assert.match(live,/\.payment\(\{customerKey\}\)/);
 assert.match(live,/payment\.requestPayment\(pgRequest\)/);
 assert.match(live,/buildTossPaymentWindowRequest/);
 assert.match(mapping,/flowMode:'DIRECT'/);
 assert.match(mapping,/flowMode:'DEFAULT'/);
 assert.match(mapping,/VIRTUAL_ACCOUNT/);
 assert.match(live,/directPayConsentGranted/);
 assert.match(live,/withuCheckoutReadiness/);
 assert.match(live,/createWithuOrder/);
 assert.match(styles,/payment-choice-chip/);
 assert.match(server,/['"]\/payment-methods\.js['"]:/);
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
