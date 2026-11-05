/**
 * WITHU licensed music delivery outbox worker CONTRACT (not a public route).
 *
 * Billing does not make all provider output candidates deliverable:
 * only the selected quality-checked song from each purchased slot is used.
 * The adapter must send short-lived private links, NOT raw provider outputs.
 */
import {ORDER_STATES} from './commerce.mjs';
import {prepareCustomerDeliverables} from './song-delivery-selection.mjs';

export async function sendSelectedCustomerSongs({
 order,deliveryJob,candidateBatches,selections,deliveryAdapter
}){
 if(order?.state!==ORDER_STATES.READY_TO_DELIVER||!order.paymentVerifiedAt
  ||typeof order.paymentKey!=='string'||!order.paymentKey
  ||order.recipientVerified!==true
  ||typeof order.customerEmail!=='string'||!/^\S+@\S+\.\S+$/.test(order.customerEmail)
  ||/[\r\n]/.test(order.customerEmail)
  ||deliveryJob?.orderId!==order.id||deliveryJob.key!=='deliver:'+order.id
  ||deliveryJob.status!=='claimed')
  throw new Error('Customer delivery is not authorized or recipient is not verified');
 if(typeof deliveryAdapter?.sendSelectedPrivateLinks!=='function')
  throw new Error('Private delivery email adapter is missing');
 const manifest=prepareCustomerDeliverables({order,candidateBatches,selections});
 const provider=await deliveryAdapter.sendSelectedPrivateLinks({
  orderId:order.id,customerEmail:order.customerEmail,
  // Only the finalized selections are forwarded, never all generated options.
  selectedSongs:manifest.songs,
  idempotencyKey:'withu-delivery-'+order.id
 });
 if(!provider||typeof provider.messageId!=='string'||!provider.messageId)
  throw new Error('Delivery provider did not acknowledge message');
 return Object.freeze({
  orderId:order.id,deliveredSongCount:manifest.deliveryCount,
  messageId:provider.messageId
 });
}
