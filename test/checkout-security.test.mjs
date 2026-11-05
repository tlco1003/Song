import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPendingOrder,requireVerifiedBuyer,assertOwnedOrder,
  validateConfirmation,safeOrderStatus} from '../src/checkout-security.mjs';
import {ORDER_STATES} from '../src/commerce.mjs';

const auth={uid:'uid-owner',token:{email:'Buyer@example.test',email_verified:true}};
const stranger={uid:'uid-stranger',token:{email:'stranger@example.test',email_verified:true}};
const valid={
  requestId:'0a1b2c3d-aaaa-4bbb-8ccc-123456789012',
  productId:'audio',songTitle:'엄마에게',confirmedLyrics:'엄마 고마워',
  genreSelection:{mode:'single',genres:['발라드']},mood:'따뜻한',
  sharedStyleNotes:'피아노',deliveryEmail:'buyer@example.test',
  consentDelivery:true,consentTerms:true
};
const pending=(overrides={})=>({...createPendingOrder(valid,auth).order,...overrides});

test('verified Firebase email is the authoritative buyer identity',()=>{
  assert.deepEqual(requireVerifiedBuyer(auth),{uid:'uid-owner',email:'buyer@example.test'});
  for(const bad of [null,{uid:'anonymous',token:{}},
    {uid:'uid',token:{email:'buyer@example.test',email_verified:false}}]){
    assert.throws(()=>createPendingOrder(valid,bad),/VERIFIED_CUSTOMER_REQUIRED/);
  }
  assert.throws(()=>createPendingOrder({...valid,deliveryEmail:'victim@example.test'},auth),
    /DELIVERY_EMAIL_MUST_BE_VERIFIED/);
  assert.throws(()=>assertOwnedOrder(pending(),stranger),/ORDER_NOT_FOUND_OR_FORBIDDEN/);
});

test('server catalog sets fixed price; browser paid/amount fields are rejected',()=>{
  const {order}=createPendingOrder(valid,auth);
  assert.equal(order.amountKrw,29000);
  assert.equal(order.currency,'KRW');
  assert.equal(order.ownerUid,'uid-owner');
  assert.equal(order.state,ORDER_STATES.PAYMENT_PENDING);
  assert.ok(/^WITHU_[a-f0-9]{32}$/.test(order.id));
  assert.throws(()=>createPendingOrder({...valid,amountKrw:1},auth),
    /UNEXPECTED_CHECKOUT_FIELD/);
  assert.throws(()=>createPendingOrder({...valid,paid:true},auth),
    /UNEXPECTED_CHECKOUT_FIELD/);
  assert.throws(()=>createPendingOrder({...valid,ownerUid:'uid-stranger'},auth),
    /UNEXPECTED_CHECKOUT_FIELD/);
  assert.throws(()=>createPendingOrder({...valid,productId:'audio_video'},auth),
    /ADMIN_QUOTE_REQUIRED/);
  assert.throws(()=>createPendingOrder({...valid,consentTerms:false},auth),
    /CHECKOUT_CONSENT_REQUIRED/);
  assert.throws(()=>createPendingOrder({...valid,genreSelection:{mode:'same',genres:['발라드']}},auth),
    /Single-song product/);
});
test('two-song order retains selected genre and server-owned 39,000 KRW',()=>{
  const {order}=createPendingOrder({...valid,productId:'audio_duo',
    genreSelection:{mode:'different',genres:['발라드','재즈']}},auth);
  assert.equal(order.amountKrw,39000);
  assert.deepEqual(order.genreSelection.genres,['발라드','재즈']);
});
test('amount tampering, non-owner confirmation and mismatched key fail closed',()=>{
  const order=pending();
  const props={order,auth,orderId:order.id,paymentKey:'TEST_PAYMENT_KEY_VALID',
    claimedAmountKrw:29000};
  assert.equal(validateConfirmation(props),'pending');
  assert.throws(()=>validateConfirmation({...props,claimedAmountKrw:1}),
    /PAYMENT_AMOUNT_MISMATCH/);
  assert.throws(()=>validateConfirmation({...props,auth:stranger}),
    /ORDER_NOT_FOUND_OR_FORBIDDEN/);
  assert.throws(()=>validateConfirmation({...props,orderId:'OTHERORDER123'}),
    /ORDER_NOT_FOUND_OR_FORBIDDEN/);
  assert.equal(validateConfirmation({...props,order:{...order,state:ORDER_STATES.PAID,
    paymentKey:props.paymentKey}}),'already_paid');
  assert.throws(()=>validateConfirmation({...props,order:{...order,state:ORDER_STATES.PAID,
    paymentKey:'ANOTHER_KEY_000000'}}),/DIFFERENT_PAYMENT_KEY/);
});
test('order status exposes no customer story, email, provider key or secret',()=>{
  const order=pending({customerEmail:'buyer@example.test',
    confirmedLyrics:'PRIVATE LYRICS',paymentKey:'private_payment_key'});
  const status=safeOrderStatus(order,auth);
  assert.deepEqual(Object.keys(status).sort(),
    ['amountKrw','currency','orderId','paid','productId','state'].sort());
  assert.ok(!JSON.stringify(status).includes('PRIVATE LYRICS'));
  assert.ok(!JSON.stringify(status).includes('buyer@example.test'));
  assert.ok(!JSON.stringify(status).includes('private_payment_key'));
  assert.throws(()=>safeOrderStatus(order,stranger),/ORDER_NOT_FOUND_OR_FORBIDDEN/);
});
