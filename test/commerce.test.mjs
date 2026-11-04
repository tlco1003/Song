import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORDER_STATES,assertOrderTransition,publicCommerceReadiness,publicPriceCatalog} from '../src/commerce.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('docs/checkout.html');
const script=read('docs/checkout.js');
const styles=read('docs/checkout.css');
const createHtml=read('docs/create.html');

test('checkout is an in-site page with song and video gift options and email validation',()=>{
 assert.match(createHtml,/href="checkout\.html"/);
 for(const name of ['product-audio','product-video','delivery-email','delivery-email-again','consent-delivery','consent-service','inspect-order','confirm-checkout','order-title','order-lyrics']){
   assert.ok(html.includes('id="'+name+'"'),name);
 }
 assert.match(html,/id="confirm-checkout"[^>]*disabled/);
 assert.match(script,/withu-order-draft-v1/);
 assert.match(script,/sessionStorage\.getItem/);
 assert.match(script,/email\.toLowerCase\(\)!==again\.toLowerCase\(\)/);
 assert.match(script,/\$\('confirm-checkout'\)\.disabled=true/);
 assert.match(styles,/checkout-layout/);
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
});

test('a payment is never considered paid without provider proof and server-side amount',()=>{
 assert.throws(()=>assertOrderTransition(ORDER_STATES.PAYMENT_PENDING,ORDER_STATES.PAID,{}));
 assert.throws(()=>assertOrderTransition(ORDER_STATES.PAYMENT_PENDING,ORDER_STATES.PAID,{verifiedProviderPayment:true}));
 assert.ok(assertOrderTransition(ORDER_STATES.PAYMENT_PENDING,ORDER_STATES.PAID,{verifiedProviderPayment:true,matchesServerOrderAmount:true}));
});

test('music must be contractually licensed and delivery must have verified asset and recipient',()=>{
 assert.throws(()=>assertOrderTransition(ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,{}));
 assert.ok(assertOrderTransition(ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,{commercialMusicLicenseVerified:true}));
 assert.throws(()=>assertOrderTransition(ORDER_STATES.READY_TO_DELIVER,ORDER_STATES.DELIVERING,{storedOutputVerified:true}));
 assert.ok(assertOrderTransition(ORDER_STATES.READY_TO_DELIVER,ORDER_STATES.DELIVERING,{storedOutputVerified:true,recipientVerified:true}));
 assert.throws(()=>assertOrderTransition(ORDER_STATES.DELIVERED,ORDER_STATES.PAID,{verifiedProviderPayment:true,matchesServerOrderAmount:true}));
});


test('six planned payment methods can be previewed but none can charge or gather card details',()=>{
 const methods=[
  ['pay-toss','toss_pay','토스페이'],
  ['pay-kakao','kakao_pay','카카오페이'],
  ['pay-naver','naver_pay','네이버페이'],
  ['pay-card','card','신용·체크카드'],
  ['pay-transfer','transfer','실시간 계좌이체'],
  ['pay-virtual','virtual_account','가상계좌 입금']
 ];
 for(const [id,value,label] of methods){
  assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('value="'+value+'"'),value);
  assert.ok(html.includes(label),label);
  assert.ok(script.includes(value),value+' missing from client preview logic');
 }
 for(const id of ['payment-methods','preview-payment','payment-preview-dialog','demo-payment-method','finish-payment-preview','selected-payment-method']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(script,/showPaymentPreview/);
 assert.match(script,/\.showModal\(\)/);
 assert.match(script,/가격 확인 중 · 청구 불가/);
 assert.match(script,/\$\('confirm-checkout'\)\.disabled=true/);
 assert.match(html,/id="confirm-checkout"[^>]*disabled/);
 assert.doesNotMatch(html,/name="(?:cardNumber|cardCvv|cardPassword|accountPassword)"|autocomplete="cc-number"/i);
 assert.doesNotMatch(script,/requestPayment\s*\(|api\/payments\/confirm|window\.location\.href\s*=|fetch\s*\(\s*['"]https?:\/\//);
 assert.ok(styles.includes('.payment-methods'));
 assert.ok(styles.includes('.payment-preview-dialog'));
});


test('catalog is the only planned price source and video is starting-at with a required quote',()=>{
 const catalog=publicPriceCatalog();
 assert.equal(catalog.version,1);
 assert.equal(catalog.currency,'KRW');
 assert.deepEqual(catalog.products.map(p=>[p.id,p.amountKrw,p.priceKind,p.quoteRequired]),[
  ['audio',29000,'fixed',false],
  ['audio_duo',39000,'fixed',false],
  ['audio_video',300000,'starting_at',true]
 ]);
 assert.equal(catalog.products[1].amountKrw-catalog.products[0].amountKrw,10000);
 assert.equal(catalog.products[0].amountKrw*2-catalog.products[1].amountKrw,19000);
 const readCatalog=JSON.parse(read('docs/prices.json'));
 assert.deepEqual(catalog,readCatalog);
 assert.match(html,/id="product-audio-duo"/);
 assert.match(html,/data-price-for="audio"/);
 assert.match(html,/data-price-for="audio_duo"/);
 assert.match(html,/data-price-for="audio_video"/);
 assert.match(script,/fetch\('prices.json'/);
 assert.match(script,/showProductPrice/);
 assert.match(script,/quoteRequired===true/);
 assert.match(html,/id="confirm-checkout"[^>]*disabled/);
 assert.equal(publicCommerceReadiness().canCharge,false);
});
