import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const create=read('docs/create.html'),createJs=read('docs/create.js');
const checkout=read('docs/checkout.html'),checkoutJs=read('docs/checkout.js');
const payment=read('docs/payment.html'),paymentJs=read('docs/payment.js');
const mediaJs=read('docs/checkout-media.js'),server=read('src/server.mjs');

test('seven questions act as separate progressive screens instead of one long visible form',()=>{
 const panels=[...create.matchAll(/data-create-step="(\d)"[^>]*>/g)];
 assert.deepEqual(panels.map(x=>Number(x[1])),[1,2,3,4,5,6,7]);
 assert.ok(!panels[0][0].includes('hidden'));
 for(const panel of panels.slice(1))assert.ok(panel[0].includes('hidden'));
 assert.ok(create.includes('id="create-next"'));
 assert.ok(create.includes('id="create-prev"'));
 assert.match(createJs,/history\.pushState/);
 assert.match(createJs,/window\.addEventListener\('popstate'/);
 assert.match(createJs,/const STEP_COUNT=7/);
 assert.match(createJs,/sessionStorage\.setItem\(STORY_KEY/);
 assert.match(createJs,/url\.searchParams\.set\('step'/);
 assert.doesNotMatch(createJs,/url\.searchParams\.set\('(recipient|memory|message|gratitudeApology|lyrics|email)'/);
 assert.match(createJs,/sessionStorage\.setItem\(ORDER_KEY/);
});
test('product, genres, optional video and review are independently navigable',()=>{
 for(const stage of ['product','genre','video','review']){
  assert.match(checkout,new RegExp('data-checkout-step="'+stage+'"'));
 }
 assert.match(checkoutJs,/function stages\(/);
 assert.match(checkoutJs,/currentStage/);
 assert.match(checkoutJs,/history\.pushState/);
 assert.match(checkoutJs,/window\.addEventListener\('popstate'/);
 assert.match(checkoutJs,/url\.searchParams\.set\('stage'/);
 assert.match(checkout,/id="go-payment" href="payment.html"/);
 assert.ok(server.includes("'/payment.html':'docs/payment.html'"));
 assert.ok(server.includes("'/payment.js':'docs/payment.js'"));
});
test('payment alone contains email and method fields and is strictly non-payable',()=>{
 assert.ok(!checkout.includes('id="delivery-email"'));
 assert.ok(payment.includes('id="delivery-email"'));
 assert.ok(payment.includes('id="delivery-email-again"'));
 assert.ok(payment.includes('id="payment-methods"'));
 assert.ok(payment.includes('id="confirm-checkout"'));
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.match(paymentJs,/\$\('confirm-checkout'\)\.disabled=true/);
 assert.doesNotMatch(paymentJs,/sessionStorage\.setItem|localStorage|requestPayment\(/);
 assert.ok(!checkout.includes('checkout-status'));
 assert.ok(!checkout.includes('fulfillment-preview'));
 assert.doesNotMatch(checkout,/운영자가 직접 제작|FUTURE|API 승인|토스페이먼츠 통합/);
 assert.doesNotMatch(payment,/운영자가 직접 제작|FUTURE|API 승인|토스페이먼츠 통합/);
});
test('nothing can preview or generate paid audio before a verified purchase',()=>{
 for(const id of ['prepay-demo','audio-preview-element','audio-preview-play','audio-example','audio-file-choice']){
  assert.ok(!checkout.includes('id="'+id+'"'));
 }
 assert.doesNotMatch(mediaJs,/audio\.play|loadExamples|fetch\('media\/tracks.json'/);
 assert.ok(!payment.includes('<audio'));
 assert.match(server,/pathname==='\/api\/commerce\/orders'/);
 assert.match(server,/new AppError\(503/);
});
