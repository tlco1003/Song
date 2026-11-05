/**
 * Sends a purchase receipt ONLY from a worker whose order was persisted
 * as paid after PG verification. It never trusts browser payment redirects.
 * The durable outbox must claim one receipt job per verified order.
 */
import {ORDER_STATES} from './commerce.mjs';
const paidStates=new Set([
 ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,ORDER_STATES.MUSIC_READY,
 ORDER_STATES.GENERATING_VIDEO,ORDER_STATES.READY_TO_DELIVER,
 ORDER_STATES.DELIVERING,ORDER_STATES.DELIVERED
]);
export async function sendVerifiedCustomerReceipt({order,receiptJob,mailer}){
 if(!paidStates.has(order?.state)
  ||typeof order.id!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(order.id)
  ||typeof order.paymentKey!=='string'||order.paymentKey.length<6
  ||typeof order.paymentVerifiedAt!=='string'||!Date.parse(order.paymentVerifiedAt)
  ||order.refundedAt!=null
  ||typeof order.customerEmail!=='string'||!/^\S+@\S+\.\S+$/.test(order.customerEmail)
  ||/[\r\n]/.test(order.customerEmail)
  ||!Number.isSafeInteger(order.amountKrw)||order.amountKrw<=0
  ||receiptJob?.orderId!==order.id||receiptJob.key!=='receipt:'+order.id
  ||receiptJob.status!=='claimed')
  throw Error('Customer payment receipt prohibited without verified PG order');
 if(typeof mailer?.sendPaidReceipt!=='function')
  throw Error('Verified customer receipt mail adapter required');
 const sent=await mailer.sendPaidReceipt({
  orderId:order.id,customerEmail:order.customerEmail,
  productName:order.productId,amountKrw:order.amountKrw,
  idempotencyKey:'withu-receipt-'+order.id
 });
 if(typeof sent?.messageId!=='string'||!sent.messageId)
  throw Error('Receipt email delivery unacknowledged');
 return Object.freeze({orderId:order.id,messageId:sent.messageId});
}
