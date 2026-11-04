import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORDER_STATES,assertOrderTransition,publicCommerceReadiness} from '../src/commerce.mjs';

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
 assert.deepEqual(c.products,['audio','audio_video']);
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
