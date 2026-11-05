/**
 * WITHU checkout trust boundary. Browser prices, paid flags and customer IDs
 * are never an authority. Keep this module independent of Firebase for tests.
 */
import {randomUUID} from 'node:crypto';
import {publicPriceCatalog,ORDER_STATES} from './commerce.mjs';
import {buildSongProductionPlan} from './song-production-plan.mjs';

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const orderIdPattern=/^[A-Za-z0-9_-]{6,64}$/;
const paymentKeyPattern=/^[^\s]{6,200}$/;
const requestIdPattern=/^[0-9a-f]{8}-[0-9a-f-]{27,44}$/i;
const inputFields=new Set([
  'requestId','productId','songTitle','confirmedLyrics','genreSelection',
  'mood','sharedStyleNotes','deliveryEmail','consentDelivery','consentTerms'
]);

export function requireVerifiedBuyer(auth){
  if(typeof auth?.uid!=='string'||!auth.uid||auth.token?.email_verified!==true
    ||typeof auth.token.email!=='string'||!emailPattern.test(auth.token.email))
    throw new Error('VERIFIED_CUSTOMER_REQUIRED');
  return {uid:auth.uid,email:auth.token.email.trim().toLowerCase()};
}

export function createPendingOrder(input,auth){
  const buyer=requireVerifiedBuyer(auth);
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||Object.keys(input).some(k=>!inputFields.has(k)))
    throw new Error('UNEXPECTED_CHECKOUT_FIELD');
  const requestId=input.requestId;
  if(typeof requestId!=='string'||!requestIdPattern.test(requestId))
    throw new Error('INVALID_CHECKOUT_REQUEST_ID');
  if(input.consentDelivery!==true||input.consentTerms!==true)
    throw new Error('CHECKOUT_CONSENT_REQUIRED');
  if(typeof input.deliveryEmail!=='string'
    ||input.deliveryEmail.trim().toLowerCase()!==buyer.email)
    throw new Error('DELIVERY_EMAIL_MUST_BE_VERIFIED');
  const item=publicPriceCatalog().products.find(p=>p.id===input.productId);
  if(!item)throw new Error('UNKNOWN_PRODUCT');
  // A price "starting at" is not a quote, so never collect that amount.
  if(item.quoteRequired||item.priceKind!=='fixed')
    throw new Error('ADMIN_QUOTE_REQUIRED');
  const order={
    id:'WITHU_'+randomUUID().replaceAll('-',''),
    ownerUid:buyer.uid,
    customerEmail:buyer.email,
    deliveryEmail:buyer.email,
    productId:item.id,
    amountKrw:item.amountKrw,
    currency:'KRW',
    state:ORDER_STATES.PAYMENT_PENDING,
    songTitle:input.songTitle,
    confirmedLyrics:input.confirmedLyrics,
    genreSelection:input.genreSelection,
    mood:input.mood??'따뜻한',
    sharedStyleNotes:input.sharedStyleNotes??'',
    consentDelivery:true,
    consentTerms:true,
    fulfillmentRoute:'manual_operator'
  };
  buildSongProductionPlan(order); // fail closed before persisting customer PII
  return Object.freeze({order,requestId});
}

export function assertOwnedOrder(order,auth){
  const {uid}=requireVerifiedBuyer(auth);
  if(!order||order.ownerUid!==uid)
    throw new Error('ORDER_NOT_FOUND_OR_FORBIDDEN');
  return order;
}

export function validateConfirmation({order,auth,orderId,paymentKey,claimedAmountKrw}){
  assertOwnedOrder(order,auth);
  if(typeof orderId!=='string'||!orderIdPattern.test(orderId)||order.id!==orderId)
    throw new Error('ORDER_NOT_FOUND_OR_FORBIDDEN');
  if(typeof paymentKey!=='string'||!paymentKeyPattern.test(paymentKey))
    throw new Error('INVALID_PAYMENT_KEY');
  if(!Number.isSafeInteger(claimedAmountKrw)||claimedAmountKrw!==order.amountKrw
    ||order.currency!=='KRW')
    throw new Error('PAYMENT_AMOUNT_MISMATCH');
  if(order.state===ORDER_STATES.PAID){
    if(order.paymentKey!==paymentKey)throw new Error('DIFFERENT_PAYMENT_KEY');
    return 'already_paid';
  }
  if(order.state!==ORDER_STATES.PAYMENT_PENDING)
    throw new Error('ORDER_NOT_PENDING');
  buildSongProductionPlan(order);
  return 'pending';
}

export function safeOrderStatus(order,auth){
  assertOwnedOrder(order,auth);
  return Object.freeze({
    orderId:order.id,productId:order.productId,state:order.state,
    amountKrw:order.amountKrw,currency:'KRW',
    // No lyrics, email, PG keys, provider secrets, logs or other customer data.
    paid:order.state===ORDER_STATES.PAID
  });
}
