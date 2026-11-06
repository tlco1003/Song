/**
 * Unified trusted manual/Suno-B2B -> customer-specific delivery finalizer.
 *
 * Even after successful music generation, never expose provider candidates:
 * exactly one verified, privately stored, licensed, quality-accepted output
 * per PURCHASED song must be committed before sending a personal link.
 *
 * Manual operator and future approved B2B provider use the same contract.
 */
import {ORDER_STATES} from './commerce.mjs';
import {prepareCustomerDeliverables} from './song-delivery-selection.mjs';
import {dispatchCompletedMusicToCustomer} from './dispatch-completed-music.mjs';

function verifiedDeliveryJob(job,order){
 if(order?.state!==ORDER_STATES.READY_TO_DELIVER
  ||!order.paymentVerifiedAt||typeof order.paymentKey!=='string'
  ||!order.paymentKey||order.recipientVerified!==true
  ||job?.status!=='claimed'||job?.orderId!==order.id
  ||job.key!=='deliver:'+order.id)
  throw new Error('Selected songs cannot be delivered before verified payment and final approval');
}
export async function finalizeSelectedPaidMusic({
 order,deliveryJob,candidateBatches,selections,
 qualityVerifier,orders,config=process.env,fetcher=globalThis.fetch
}={}){
 verifiedDeliveryJob(deliveryJob,order);
 if(typeof qualityVerifier?.verifyApprovedSong!=='function'
  ||typeof orders?.reserveDeliveryManifestAtomic!=='function'
  ||typeof orders?.saveDeliveryTokenHashAtomic!=='function'
  ||typeof orders?.recordNotificationAcceptedAtomic!=='function')
  throw new Error('Trusted final-song quality check, DB and delivery outbox are required');
 const manifest=prepareCustomerDeliverables({
  order,candidateBatches,selections
 });
 for(const song of manifest.songs){
  const result=await qualityVerifier.verifyApprovedSong({
   orderId:order.id,selectedSong:song
  });
  if(result?.candidateId!==song.candidateId
   ||result?.songIndex!==song.index
   ||result?.privateAssetStoredVerified!==true
   ||result?.lyricsAndVocalsReviewed!==true
   ||result?.commercialProductionRightsVerified!==true
   ||result?.customerSpecificAssetVerified!==true
   ||result?.finalApprovalVerified!==true)
   throw new Error('Final song failed audio, rights or private-owner delivery approval');
 }
 const committed=await orders.reserveDeliveryManifestAtomic({
  orderId:order.id,expectedState:ORDER_STATES.READY_TO_DELIVER,
  approvedManifest:manifest,
  jobKey:deliveryJob.key,
  idempotencyKey:'withu-delivery-selection:'+order.id
 });
 if(!committed||!['created','duplicate'].includes(committed.outcome))
  throw new Error('Final private delivery manifest was not saved');
 const gateway=await dispatchCompletedMusicToCustomer({
  order,selectedSongs:manifest.songs,orders,config,fetcher
 });
 if(gateway.acceptedForDelivery!==true||!gateway.gatewayMessageId)
  throw new Error('Delivery provider did not accept personal customer link');
 const saved=await orders.recordNotificationAcceptedAtomic({
  orderId:order.id,jobKey:deliveryJob.key,
  providerMessageId:gateway.gatewayMessageId,
  channel:gateway.channel,
  status:'provider_accepted_not_recipient_delivered',
  idempotencyKey:'withu-delivery-notification:'+order.id
 });
 if(!saved||!['created','duplicate'].includes(saved.outcome))
  throw new Error('Notification acceptance was not persisted');
 return Object.freeze({
  status:'notification_accepted_not_inbox_verified',
  orderId:order.id,deliveryCount:manifest.deliveryCount,
  notificationChannel:gateway.channel,
  customerMusicAccessGrantedOnlyViaPrivateLink:true
 });
}
