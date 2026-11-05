import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  WITHU_PAYMENT_METHODS,
  getWithuPaymentMethod,requiresDirectPayConsent,
  buildTossPaymentWindowRequest
} from '../docs/payment-methods.js';

const order={
  orderId:'WITHU_1234567890abcdef1234567890abcdef',
  orderName:'WITHU 맞춤 노래 1곡',
  amountKrw:29000,
  currency:'KRW'
};
const payload=id=>buildTossPaymentWindowRequest({
  choiceId:id,order,customerEmail:'buyer@example.test',
  successUrl:'https://withu.example/payment-success.html',
  failUrl:'https://withu.example/payment-fail.html'
});

test('all 13 distinct customer choice chips map to an official SDK payment method',()=>{
 assert.equal(Object.keys(WITHU_PAYMENT_METHODS).length,13);
 const seen=new Set();
 for(const id of Object.keys(WITHU_PAYMENT_METHODS)){
  const result=payload(id);
  assert.equal(result.orderId,order.orderId);
  assert.deepEqual(result.amount,{currency:'KRW',value:29000});
  assert.equal(result.customerEmail,'buyer@example.test');
  assert.ok(result.method);
  assert.equal(getWithuPaymentMethod(id).id,id);
  assert.ok(!seen.has(id));
  seen.add(id);
 }
});
test('Naver, Kakao, Toss, Payco, Samsung and Apple chips open THEIR selected direct-pay providers',()=>{
 for(const [chip,provider] of [
  ['toss_pay','TOSSPAY'],['naver_pay','NAVERPAY'],
  ['kakao_pay','KAKAOPAY'],['payco','PAYCO'],
  ['samsung_pay','SAMSUNGPAY'],['apple_pay','APPLEPAY']
 ]){
  const req=payload(chip);
  assert.equal(req.method,'CARD');
  assert.deepEqual(req.card,{flowMode:'DIRECT',easyPay:provider});
  assert.equal(requiresDirectPayConsent(chip),true);
 }
});
test('credit/debit cards, account transfer, virtual account, mobile and vouchers have distinct supported methods',()=>{
 assert.deepEqual(payload('card').card,{flowMode:'DEFAULT'});
 for(const [id,method] of [
  ['transfer','TRANSFER'],['virtual_account','VIRTUAL_ACCOUNT'],
  ['mobile_phone','MOBILE_PHONE'],
  ['culture_gift','CULTURE_GIFT_CERTIFICATE'],
  ['book_gift','BOOK_GIFT_CERTIFICATE'],
  ['game_gift','GAME_GIFT_CERTIFICATE']
 ]){
  assert.equal(payload(id).method,method);
  assert.equal(payload(id).card,undefined);
  assert.equal(requiresDirectPayConsent(id),false);
 }
 assert.deepEqual(payload('virtual_account').virtualAccount,{validHours:24});
});
test('browser-supplied amount, unknown method and invalid order cannot produce payment request',()=>{
 assert.throws(()=>payload('made_up'),/지원하지 않는 결제수단/);
 assert.throws(()=>buildTossPaymentWindowRequest({
  choiceId:'card',order:{...order,amountKrw:0},
  customerEmail:'buyer@example.test',
  successUrl:'https://withu.example/yes',failUrl:'https://withu.example/no'
 }),/서버 주문/);
 assert.throws(()=>buildTossPaymentWindowRequest({
  choiceId:'card',order:{...order,amountKrw:29000,currency:'USD'},
  customerEmail:'buyer@example.test',
  successUrl:'https://withu.example/yes',failUrl:'https://withu.example/no'
 }),/서버 주문/);
 assert.throws(()=>buildTossPaymentWindowRequest({
  choiceId:'card',order,customerEmail:'buyer@example.test',
  successUrl:'javascript:alert(1)',failUrl:'https://withu.example/no'
 }),/서버 주문/);
});
