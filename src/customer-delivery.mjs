/**
 * WITHU final customer handoff: exactly one approved, paid, private asset per
 * purchased slot is persisted before a notification email is queued.
 * No raw assets, public links or delivery bearer tokens are emailed.
 * The durable state transition to DELIVERED must follow mail acknowledgment.
 */
import {ORDER_STATES} from './commerce.mjs';
import {prepareCustomerDeliverables} from './song-delivery-selection.mjs';

export async function sendSelectedCustomerSongs({
 order,deliveryJob,candidateBatches,selections,deliveryAdapter,deliveryStore
}){
 if(order?.state!==ORDER_STATES.READY_TO_DELIVER||!order.paymentVerifiedAt
  ||typeof order.paymentKey!=='string'||!order.paymentKey
  ||order.recipientVerified!==true
  ||typeof order.customerEmail!=='string'||!/^\S+@\S+\.\S+$/.test(order.customerEmail)
  ||/[\r\n]/.test(order.customerEmail)
  ||deliveryJob?.orderId!==order.id||deliveryJob.key!=='deliver:'+order.id
  ||deliveryJob.status!=='claimed')
  throw Error('Customer delivery is not authorized or recipient is not verified');
 if(typeof deliveryStore?.publishSelectionAtomic!=='function'
  ||typeof deliveryStore?.markDeliveredAtomic!=='function')
  throw Error('Durable private delivery publication is missing');
 if(typeof deliveryAdapter?.sendReadyNotice!=='function')
  throw Error('Customer email notice adapter is missing');
 const manifest=prepareCustomerDeliverables({order,candidateBatches,selections});
 // Must be idempotent: unique (orderId, selection version); store exactly the
 // chosen asset keys in a PRIVATE order record and never make them public.
 const publication=await deliveryStore.publishSelectionAtomic({
  orderId:order.id,paymentKey:order.paymentKey,selectedSongs:manifest.songs,
  jobKey:deliveryJob.key
 });
 if(!publication||!['published','already_published'].includes(publication.outcome))
  throw Error('Durable selected-song publication failed');
 const publicTitles=manifest.songs.map(song=>({
  index:song.index,title:song.title,genre:song.genre
 }));
 const provider=await deliveryAdapter.sendReadyNotice({
  orderId:order.id,customerEmail:order.customerEmail,
  selectedSongs:publicTitles,idempotencyKey:'withu-delivery-'+order.id
 });
 if(!provider||typeof provider.messageId!=='string'||!provider.messageId)
  throw Error('Delivery provider did not acknowledge message');
 // Mark delivery complete only AFTER a verified email-provider acknowledgment.
 // The DB adapter must use (orderId, jobKey) uniqueness and recheck the paid
 // order and persisted selected assets transactionally before changing state.
 const marked=await deliveryStore.markDeliveredAtomic({
  orderId:order.id,jobKey:deliveryJob.key,messageId:provider.messageId,
  expectedState:ORDER_STATES.READY_TO_DELIVER,nextState:ORDER_STATES.DELIVERED
 });
 if(!marked||!['completed','already_completed'].includes(marked.outcome))
  throw Error('Delivery state finalization failed');
 return Object.freeze({
  orderId:order.id,deliveredSongCount:manifest.deliveryCount,
  messageId:provider.messageId,publicationOutcome:publication.outcome
 });
}
