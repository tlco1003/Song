/**
 * WITHU separate commercial-use licence + private original-file upgrade.
 *
 * This module NEVER treats the customer's initial music order as a commercial
 * licence, and NEVER grants a download based on a browser-side "paid" flag.
 *
 * Requires a rights-cleared original recording, provider-permitted download
 * receipt (Suno 2026-09+), approved grant scope, trusted verified recipient,
 * independent PG confirmation and atomic entitlement persistence.
 */
import {publicPriceCatalog,ORDER_STATES} from './commerce.mjs';

export const COMMERCIAL_UPGRADE_ID='commercial_use_download';
export const upgradePriceKrw=()=>{
 const option=publicPriceCatalog().postDeliveryUpgrades?.commercialUseDownload;
 if(option?.id!==COMMERCIAL_UPGRADE_ID||option.amountKrw!==10000||option.currency!=='KRW')
  throw new Error('Server commercial-use price is not configured');
 return 10000;
};
function validId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{6,90}$/.test(value);}
function ensureVerifiedOriginalOrder(order){
 if(!order||!validId(order.id)||order.state!==ORDER_STATES.DELIVERED
  ||!order.paymentVerifiedAt||!order.paymentKey||order.recipientVerified!==true
  ||!['audio','audio_duo','audio_video'].includes(order.productId))
  throw new Error('Original order and customer delivery must be verified');
}
export function assertCommercialRightsForCustomer({order,selectedSongs,rightsRecords}={}){
 ensureVerifiedOriginalOrder(order);
 const count=order.productId==='audio_duo'?2:1;
 if(!Array.isArray(selectedSongs)||selectedSongs.length!==count
  ||!Array.isArray(rightsRecords)||rightsRecords.length!==count)
  throw new Error('Rights proof must match every final purchased song');
 const used=new Set();
 for(const song of selectedSongs){
  if(!Number.isSafeInteger(song?.index)||song.index<1||song.index>count
    ||!validId(song.candidateId)||used.has(song.candidateId)
    ||typeof song.privateAssetKey!=='string'||!/^private\/[a-zA-Z0-9_./-]+\.(?:mp3|m4a|wav)$/.test(song.privateAssetKey)
    ||song.privateAssetKey.includes('..'))
   throw new Error('Final private song selection is invalid');
  used.add(song.candidateId);
  const matches=rightsRecords.filter(proof=>proof?.candidateId===song.candidateId);
  if(matches.length!==1)throw new Error('Rights proof is missing or duplicated for a final song');
  const proof=matches[0];
  // A paid Suno plan is not enough after September 3, 2026:
  // commercial use also requires an official permitted output download.
  // Never sell derivative/non-cleared song rights or assume copyrights exist.
  if(proof.originalOutputVerified!==true||proof.isRemix!==false
    ||proof.providerCommercialUsePermitted!==true
    ||proof.providerPermittedDownloadVerified!==true
    ||typeof proof.providerDownloadReceipt!=='string'||proof.providerDownloadReceipt.length<8
    ||proof.thirdPartyMaterialsCleared!==true
    ||proof.authorizedToGrantCustomerCommercialUse!==true
    ||proof.customerLicenseTermsReviewed!==true
    ||typeof proof.reviewedAt!=='string'||!Number.isFinite(Date.parse(proof.reviewedAt)))
   throw new Error('Commercial rights proof is incomplete for final song');
 }
 return Object.freeze({verified:true,orderId:order.id,songCount:count,
  candidateIds:Object.freeze(selectedSongs.map(s=>s.candidateId))});
}
export function commercialUpgradeQuote({order,selectedSongs,rightsRecords,viewer}={}){
 const rights=assertCommercialRightsForCustomer({order,selectedSongs,rightsRecords});
 if(viewer?.orderId!==order.id||viewer?.recipientVerified!==true
  ||viewer?.sessionVerified!==true)
  throw new Error('Only the authenticated customer may request the commercial upgrade');
 return Object.freeze({
  id:COMMERCIAL_UPGRADE_ID,orderId:order.id,amountKrw:upgradePriceKrw(),
  currency:'KRW',rightsVerified:rights.verified,tracks:rights.songCount,
  status:'awaiting_separate_verified_payment'
 });
}
export async function confirmCommercialUpgradeAndGrant({
 originalOrder,upgradeIntent,paymentKey,claimedAmountKrw,
 selectedSongs,rightsRecords,viewer,orders,payments
}={}){
 const quote=commercialUpgradeQuote({
  order:originalOrder,selectedSongs,rightsRecords,viewer
 });
 if(!upgradeIntent||upgradeIntent.originalOrderId!==originalOrder.id
  ||!validId(upgradeIntent.providerOrderId)
  ||upgradeIntent.status!=='payment_pending'
  ||upgradeIntent.amountKrw!==quote.amountKrw
  ||upgradeIntent.currency!=='KRW'
  ||typeof paymentKey!=='string'||paymentKey.length<6
  ||claimedAmountKrw!==quote.amountKrw)
  throw new Error('Commercial upgrade payment intent does not match server quote');
 if(typeof payments?.confirm!=='function'
   ||typeof orders?.grantCommercialEntitlementAtomic!=='function')
  throw new Error('Verified payment and atomic order storage adapters are required');
 const paid=await payments.confirm({
  paymentKey,orderId:upgradeIntent.providerOrderId,amountKrw:quote.amountKrw
 });
 if(paid?.status!=='DONE'||paid.orderId!==upgradeIntent.providerOrderId
  ||paid.paymentKey!==paymentKey||paid.currency!=='KRW'
  ||paid.totalAmount!==quote.amountKrw||paid.balanceAmount!==quote.amountKrw)
  throw new Error('Provider has not verified the separate 10000 KRW payment');
 const stored=await orders.grantCommercialEntitlementAtomic({
  originalOrderId:originalOrder.id,upgradeIntentId:upgradeIntent.id,
  providerOrderId:upgradeIntent.providerOrderId,paymentKey,
  amountKrw:quote.amountKrw,currency:'KRW',
  licensedCandidates:quote.tracks,licensedCandidateIds:selectedSongs.map(s=>s.candidateId),
  permission:'nonexclusive-commercial-use',
  expectedUpgradeStatus:'payment_pending',
  idempotencyKey:'withu-commercial-upgrade-'+originalOrder.id
 });
 if(!stored||!['created','duplicate'].includes(stored.outcome))
  throw new Error('Commercial entitlement grant was not stored atomically');
 return Object.freeze({
  status:'commercial_entitlement_verified',orderId:originalOrder.id,
  amountKrw:quote.amountKrw,outcome:stored.outcome
 });
}
export function assertDownloadEntitlement({
 order,viewer,entitlement,selectedSong,rightsRecords
}={}){
 ensureVerifiedOriginalOrder(order);
 if(viewer?.sessionVerified!==true||viewer.orderId!==order.id
  ||viewer.recipientVerified!==true)
  throw new Error('Private authenticated delivery session required');
 if(entitlement?.status!=='active'||entitlement.originalOrderId!==order.id
  ||entitlement.paymentVerified!==true||entitlement.amountKrw!==upgradePriceKrw()
  ||typeof entitlement.paymentKey!=='string'||entitlement.paymentKey.length<6
  ||entitlement.permission!=='nonexclusive-commercial-use'
  ||!Array.isArray(entitlement.licensedCandidateIds)
  ||!entitlement.licensedCandidateIds.includes(selectedSong?.candidateId))
  throw new Error('Commercial download requires a separately verified paid entitlement');
 const verified=rightsRecords?.find(x=>x.candidateId===selectedSong.candidateId);
 if(!verified||verified.providerCommercialUsePermitted!==true
  ||verified.providerPermittedDownloadVerified!==true
  ||verified.authorizedToGrantCustomerCommercialUse!==true
  ||verified.customerLicenseTermsReviewed!==true)
  throw new Error('Final recording commercial rights evidence is not valid');
 return true;
}
