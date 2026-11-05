/**
 * WITHU verified-paid order pipeline.
 *
 * This module is a future B2B integration contract, NOT a public payment endpoint.
 * There is no live PG credential, live order store or external Suno adapter here.
 *
 * Implement the storage port with a durable transactional outbox before going live.
 * Never accept "paid", amount, operator route, or customer e-mail from a browser as proof.
 */

import {ORDER_STATES,publicPriceCatalog} from './commerce.mjs';
import {buildSongProductionPlan,verifyPaidSongPlan} from './song-production-plan.mjs';

export const FULFILLMENT_ROUTE=Object.freeze({
  HUMAN:'manual_operator',
  APPROVED_API:'approved_music_api'
});

function ensureOrderId(id){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(id))
    throw new TypeError('Invalid order ID');
}
function ensurePaymentKey(key){
  if(typeof key!=='string'||key.length<6||key.length>200)
    throw new TypeError('Invalid payment key');
}
function serverAmount(order){
  const amount=order?.amountKrw;
  if(!Number.isSafeInteger(amount)||amount<=0||order.currency!=='KRW')
    throw new Error('Missing server-owned KRW amount');
  const product=publicPriceCatalog().products.find(item=>item.id===order.productId);
  if(!product)throw new Error('Unknown server product');
  if(product.priceKind==='fixed'&&amount!==product.amountKrw)
    throw new Error('Stored price differs from server catalog');
  if(product.priceKind==='starting_at'){
    if(product.quoteRequired!==true||amount<product.amountKrw
      ||order.adminApprovedQuote!==true||typeof order.quoteId!=='string'
      ||!order.quoteId.trim())
      throw new Error('Video requires approved server-side quote before charge');
  }
  return amount;
}
function ensurePorts(orders,payments){
  if(typeof orders?.getById!=='function'||typeof orders.confirmPaidAndEnqueueAtomic!=='function'
    ||typeof payments?.confirm!=='function'||typeof payments?.retrieve!=='function')
    throw new Error('Durable order/PG adapters are required');
}
function paymentMatches(order,providerPayment,paymentKey){
  return providerPayment?.status==='DONE'
    &&providerPayment.orderId===order.id
    &&providerPayment.paymentKey===paymentKey
    &&providerPayment.currency==='KRW'
    &&providerPayment.totalAmount===serverAmount(order)
    &&providerPayment.balanceAmount===serverAmount(order);
}
/**
 * Decide route using ONLY trusted server policy.
 * Suno API readiness must be verified by a contractual approval outside this module.
 */
export function chooseFulfillmentRoute(settings={}){
  if(settings.preference==='approved_music_api'
     &&settings.commercialApiAgreementVerified===true
     &&settings.musicProviderReady===true)
    return FULFILLMENT_ROUTE.APPROVED_API;
  return FULFILLMENT_ROUTE.HUMAN;
}
async function finalizeVerifiedPayment({orders,order,payment,paymentKey,settings}){
  if(payment?.status==='WAITING_FOR_DEPOSIT'){
    // Issuing a virtual account is NOT getting paid. Persist the original
    // paymentKey and the initial provider secret without ever queuing a job.
    if(payment.orderId!==order.id||payment.paymentKey!==paymentKey
      ||payment.currency!=='KRW'||payment.totalAmount!==serverAmount(order))
      throw new Error('Virtual account issuance details did not match');
    if(typeof orders.recordPendingDepositAtomic!=='function')
      throw new Error('Durable deposit record adapter is missing');
    await orders.recordPendingDepositAtomic({
      orderId:order.id,paymentKey,
      providerSecret:typeof payment.secret==='string'&&payment.secret?payment.secret:undefined
    });
    return Object.freeze({status:'awaiting_deposit',queued:false});
  }
  if(!paymentMatches(order,payment,paymentKey))
    throw new Error('PG status, order ID, key, currency or amount did not match');
  const route=chooseFulfillmentRoute(settings);
  // Validate and freeze the customer's approved per-track genres BEFORE recording payment.
  // The order store must persist this songPlan in the SAME transaction as PAID + outbox.
  const songPlan=buildSongProductionPlan(order);
  // REQUIRED ADAPTER CONTRACT: the payment transition and job-outbox insertion
  // must happen in ONE DATABASE TRANSACTION with unique (orderId, 'fulfillment')
  // to survive retries, webhook duplication, concurrent requests and crashes.
  const result=await orders.confirmPaidAndEnqueueAtomic({
    orderId:order.id, paymentKey, amountKrw:order.amountKrw,
    expectedState:ORDER_STATES.PAYMENT_PENDING,
    nextState:ORDER_STATES.PAID, route, jobKey:'fulfill:'+order.id,
    songPlan
  });
  if(!result||!['created','duplicate'].includes(result.outcome))
    throw new Error('Durable paid/outbox transaction did not complete');
  return Object.freeze({
    status:'paid_verified',queued:true,
    route:result.route||route,
    newlyQueued:result.outcome==='created'
  });
}
/**
 * Call ONLY from a protected server callback after the PG authentication flow.
 * This call may charge real money when a real PG adapter is installed.
 * The PUBLIC server does not expose this method until all integrations pass review.
 */
export async function confirmCheckoutAndQueue({
  orderId,paymentKey,claimedAmountKrw,orders,payments,settings={}
}){
  ensureOrderId(orderId);ensurePaymentKey(paymentKey);ensurePorts(orders,payments);
  const order=await orders.getById(orderId);
  if(!order)throw new Error('Unknown order');
  if(order.id!==orderId)throw new Error('Order ID mismatch');
  if(order.state===ORDER_STATES.PAID){
    if(order.paymentKey!==paymentKey)throw new Error('Payment key does not match verified order');
    // Retried callback: do not call confirm API again or send another email.
    return Object.freeze({status:'already_processed',queued:true});
  }
  if(order.state!==ORDER_STATES.PAYMENT_PENDING)
    throw new Error('Order not awaiting payment');
  const amount=serverAmount(order);
  buildSongProductionPlan(order);
  if(claimedAmountKrw!==amount)throw new Error('Client and server amount mismatch');
  // A payment gateway adapter must call the official confirm endpoint with
  // the server-owned amount and keep its secret key server-side.
  const payment=await payments.confirm({paymentKey,orderId,amountKrw:amount});
  return finalizeVerifiedPayment({orders,order,payment,paymentKey,settings});
}
/**
 * For verified PG deposit callbacks and reconciliation workers.
 * Do not trust webhook JSON status: the provider must be re-queried.
 * A real HTTP webhook handler must additionally verify the documented
 * webhook authenticity and preserve the order's original payment key.
 */
export async function reconcileDepositAndQueue({
  orderId,paymentKey,orders,payments,settings={}
}){
  ensureOrderId(orderId);ensurePaymentKey(paymentKey);ensurePorts(orders,payments);
  const order=await orders.getById(orderId);
  if(!order||order.id!==orderId)throw new Error('Unknown order');
  if(order.state===ORDER_STATES.PAID){
    if(order.paymentKey!==paymentKey)throw new Error('Payment key does not match verified order');
    return Object.freeze({status:'already_processed',queued:true});
  }
  if(order.state!==ORDER_STATES.PAYMENT_PENDING)
    throw new Error('Order not awaiting deposit');
  if(order.issuedPaymentKey!==paymentKey)
    throw new Error('Unknown payment key for deposit');
  buildSongProductionPlan(order);
  const payment=await payments.retrieve({paymentKey,orderId});
  return finalizeVerifiedPayment({orders,order,payment,paymentKey,settings});
}
function verifiedJob(job,order){
  if(!job||job.orderId!==order?.id||job.key!=='fulfill:'+order.id
    ||job.route!==order?.fulfillmentRoute
    ||job.status!=='claimed'
    ||order?.state!==ORDER_STATES.PAID
    ||order?.paymentVerifiedAt==null
    ||typeof order?.paymentKey!=='string')
    throw new Error('No claimable verified-paid fulfillment job');
}
/**
 * Worker only. A backend outbox worker (not the customer) supplies an already
 * claimed job and a persisted verified-paid order. Never email for unpaid orders.
 */
export async function executePaidJob({job,order,operatorEmail,musicProvider}){
  verifiedJob(job,order);
  const songPlan=verifyPaidSongPlan(order);
  if(job.route===FULFILLMENT_ROUTE.HUMAN){
    if(typeof operatorEmail?.sendPaidOrder!=='function')
      throw new Error('Operator email provider missing');
    return Object.freeze({
      route:job.route,
      providerResult:await operatorEmail.sendPaidOrder({
        order,songPlan, idempotencyKey:'withu-operator-'+order.id
      })
    });
  }
  if(job.route===FULFILLMENT_ROUTE.APPROVED_API){
    if(order.commercialApiAgreementVerified!==true
      ||typeof musicProvider?.createLicensedSong!=='function')
      throw new Error('Unapproved automatic music generation');
    // Each intended song is an independent production request even when
    // the customer chose the SAME genre twice. Stable per-track idempotency
    // keys prevent a retry of track #2 from duplicating track #1.
    const results=[];
    for(const song of songPlan.songs){
      const output=await musicProvider.createLicensedSong({
        order,song, idempotencyKey:'withu-music-'+order.id+'-'+song.index
      });
      results.push({index:song.index,genre:song.genre,output});
    }
    // Provider results (possibly two candidates per request) remain INTERNAL.
    // Customer delivery requires prepareCustomerDeliverables() to choose exactly
    // one stored, quality-approved candidate per purchased song slot.
    return Object.freeze({
      route:job.route,
      purchasedSongCount:songPlan.songs.length,
      deliverySelectionRequired:true,
      providerResult:Object.freeze(results)
    });
  }
  throw new Error('Unknown fulfillment route');
}
