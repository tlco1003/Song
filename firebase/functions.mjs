/**
 * WITHU Firebase callable backend.
 * Deploy from the repository root (firebase.json functions.source=".").
 * This is deliberately FAIL-CLOSED pending PG, licensing and fulfillment review.
 *
 * Operator code-release checkpoint: REVIEWED_FOR_LIVE_CHARGES is not an env flag.
 * A real launch must include passing sandbox tests, legal/merchant approval,
 * authenticated refunds, deposit webhook and outbox worker review.
 */
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {defineSecret,defineString} from 'firebase-functions/params';
import {initializeApp,getApps} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createPendingOrder,requireVerifiedBuyer,assertOwnedOrder,
  validateConfirmation,safeOrderStatus} from '../src/checkout-security.mjs';
import {makeFirestoreOrderStore} from '../src/firestore-order-store.mjs';
import {makeTossPaymentAdapter} from '../src/toss-payment-adapter.mjs';
import {confirmCheckoutAndQueue} from '../src/paid-order-pipeline.mjs';
import {makeWithuFulfillmentHandlers} from './outbox-worker.mjs';

if(!getApps().length)initializeApp();
const db=getFirestore();
const orders=makeFirestoreOrderStore({db,FieldValue});
const tossSecret=defineSecret('TOSS_SECRET_KEY');
const tossClientKey=defineString('TOSS_CLIENT_KEY',{default:''});
const paymentActivated=defineString('WITHU_PAYMENT_ACTIVATED',{default:'no'});
const outboxVerified=defineString('WITHU_OUTBOX_WORKER_VERIFIED',{default:'no'});
const REVIEWED_FOR_LIVE_CHARGES=false; // TODO: explicit audited code change at launch
const options={region:'asia-northeast3',enforceAppCheck:true,maxInstances:10};

function releaseCheck(){
  if(!REVIEWED_FOR_LIVE_CHARGES
    ||paymentActivated.value()!=='yes'
    ||outboxVerified.value()!=='yes'
    ||!tossClientKey.value())
    throw new HttpsError('failed-precondition','WITHU_PAYMENT_NOT_RELEASED');
}
function safeFailure(error){
  if(error instanceof HttpsError)return error;
  const code=String(error?.message||'');
  if(code==='VERIFIED_CUSTOMER_REQUIRED')
    return new HttpsError('unauthenticated','VERIFIED_CUSTOMER_REQUIRED');
  if(code==='ORDER_NOT_FOUND_OR_FORBIDDEN'||code==='DELIVERY_EMAIL_MUST_BE_VERIFIED')
    return new HttpsError('permission-denied','ORDER_NOT_FOUND_OR_FORBIDDEN');
  if(code==='CHECKOUT_RATE_LIMITED')
    return new HttpsError('resource-exhausted','CHECKOUT_RATE_LIMITED');
  if(code==='ORDER_ALREADY_BOUND_TO_ANOTHER_PAYMENT'||code==='DIFFERENT_PAYMENT_KEY'
    ||code==='ORDER_NOT_PENDING')
    return new HttpsError('failed-precondition',code);
  if(code==='PAYMENT_AMOUNT_MISMATCH')
    return new HttpsError('invalid-argument','PAYMENT_AMOUNT_MISMATCH');
  // Avoid leaking internal PG response, Firestore document contents or secret.
  return new HttpsError('failed-precondition','WITHU_REQUEST_REJECTED');
}
function dataObject(request){
  if(!request.data||typeof request.data!=='object'||Array.isArray(request.data))
    throw new Error('INVALID_REQUEST');
  return request.data;
}
export const withuCheckoutReadiness=onCall(options,async()=>{
  const enabled=REVIEWED_FOR_LIVE_CHARGES&&paymentActivated.value()==='yes'
    &&outboxVerified.value()==='yes'&&!!tossClientKey.value();
  return {canCharge:enabled,requiresVerifiedEmail:true,clientKey:enabled?tossClientKey.value():null};
});

export const createWithuOrder=onCall(options,async request=>{
  try{
    releaseCheck();
    const {order,requestId}=createPendingOrder(dataObject(request),request.auth);
    const result=await orders.createOnce({order,requestId});
    assertOwnedOrder(result.order,request.auth);
    return {orderId:result.order.id,amountKrw:result.order.amountKrw,
      currency:'KRW',productId:result.order.productId,
      orderName:result.order.productId==='audio_duo'?'WITHU 맞춤 노래 2곡':'WITHU 맞춤 노래 1곡',
      duplicate:result.duplicate};
  }catch(error){throw safeFailure(error);}
});

export const confirmWithuPayment=onCall({...options,secrets:[tossSecret],
  timeoutSeconds:90},async request=>{
  try{
    releaseCheck();
    requireVerifiedBuyer(request.auth);
    const input=dataObject(request);
    if(Object.keys(input).some(k=>!['orderId','paymentKey','amount'].includes(k)))
      throw new Error('INVALID_REQUEST');
    const {orderId,paymentKey,amount}=input;
    const order=await orders.getById(orderId);
    const state=validateConfirmation({
      order,auth:request.auth,orderId,paymentKey,claimedAmountKrw:amount
    });
    if(state==='already_paid')return {orderId,status:'already_processed',paid:true};
    const reservation=await orders.reserveConfirmationAtomic({orderId,paymentKey});
    if(reservation==='already_paid')return {orderId,status:'already_processed',paid:true};
    if(reservation==='busy')
      throw new HttpsError('aborted','PAYMENT_CONFIRMATION_IN_PROGRESS_TRY_LATER');
    const adapter=makeTossPaymentAdapter({secretKey:tossSecret.value()});
    const payments={
      async confirm(args){
        try{return await adapter.confirm(args);}
        catch(error){
          // PG might have charged before a network timeout. Resolve by API lookup.
          // A failure/unknown never marks the order paid or triggers fulfillment.
          try{
            const verified=await adapter.retrieve({paymentKey:args.paymentKey});
            if(['DONE','WAITING_FOR_DEPOSIT'].includes(verified.status))return verified;
          }catch(_){}
          throw error;
        }
      },
      retrieve:args=>adapter.retrieve(args)
    };
    const result=await confirmCheckoutAndQueue({
      orderId,paymentKey,claimedAmountKrw:amount,orders,payments,
      settings:{preference:'manual_operator'}
    });
    return {orderId,status:result.status,paid:result.status==='paid_verified',
      queued:result.queued};
  }catch(error){throw safeFailure(error);}
});

export const getWithuOrderStatus=onCall(options,async request=>{
  try{
    const {orderId}=dataObject(request);
    if(typeof orderId!=='string'||!/^WITHU_[A-Za-z0-9_-]{16,58}$/.test(orderId))
      throw new Error('INVALID_ORDER_ID');
    const order=await orders.getById(orderId);
    return safeOrderStatus(order,request.auth);
  }catch(error){throw safeFailure(error);}
});

// Firestore trigger and scheduled retry are server-only and gated independently.
export const {notifyPaidWithuOrder,retryWithuOutbox}=makeWithuFulfillmentHandlers({
  db,FieldValue,approved:()=>REVIEWED_FOR_LIVE_CHARGES
});
