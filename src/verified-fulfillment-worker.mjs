/**
 * WITHU verified-paid orchestration worker.  Public checkout MUST NOT call this.
 *
 * The important production order is:
 * PG-verified payment -> load encrypted private selection -> generate lyric
 * -> persist audited lyrics -> derive approved genre-specific style -> persist
 * song plan -> claim and execute manual/B2B music job.
 *
 * No singing provider is invoked until a separate B2B commercial agreement is
 * verified by the server. The personal Suno MCP token is not a business grant.
 */
import {ORDER_STATES} from './commerce.mjs';
import {generatePaidOrderLyrics} from './paid-lyric-production.mjs';
import {buildSongProductionPlan,verifyPaidSongPlan} from './song-production-plan.mjs';
import {executePaidJob,FULFILLMENT_ROUTE} from './paid-order-pipeline.mjs';

function assertPaidJob(job,order){
 if(order?.state!==ORDER_STATES.PAID||!order.paymentVerifiedAt
  ||typeof order.paymentKey!=='string'||order.paymentKey.length<6
  ||typeof order.privateDraftId!=='string'||order.privateDraftId.length<20
  ||job?.status!=='claimed'||job.orderId!==order.id
  ||job.key!=='fulfill:'+order.id||job.route!==order.fulfillmentRoute)
  throw new Error('A claimed, authenticated, verified-paid order is required');
}
function validateDraftBinding(order,draft){
 if(draft?.status!=='awaiting_verified_payment'||draft.verifiedPaid!==false
  ||draft.productId!==order.productId
  ||JSON.stringify(draft.genreSelection)!==JSON.stringify(order.genreSelection)
  ||(draft.thirdVerse===true)!==(order.thirdVerse===true)
  ||(draft.dedicationOutro===true)!==(order.dedicationOutro===true)
  ||String(draft.dedicationText||'')!==String(order.dedicationText||'')
  ||typeof draft.lyricPrompt!=='string'||draft.lyricPrompt.length<30
  ||!Array.isArray(draft.songStyles)||draft.songStyles.length<1)
  throw new Error('Encrypted private order selection differs from verified payment');
}
export async function runClaimedVerifiedOrder({
 job,orders,privateDrafts,lyricProvider,operatorEmail,musicProvider,
 commercialApiAgreementVerified=false,musicProviderReady=false
}={}){
 if(typeof orders?.getById!=='function'
  ||typeof orders?.storeGeneratedLyricsAtomic!=='function'
  ||typeof orders?.persistPaidSongPlanAtomic!=='function'
  ||typeof privateDrafts?.readById!=='function')
  throw new Error('Durable audited order and encrypted draft adapters required');
 let order=await orders.getById(job?.orderId);
 assertPaidJob(job,order);
 let draft=await privateDrafts.readById(order.privateDraftId);
 validateDraftBinding(order,draft);
 // Lyrics are server-generated only AFTER the trusted order state is PAID.
 if(!order.confirmedLyrics){
  await generatePaidOrderLyrics({
   order,privateDraft:draft,lyricProvider,orders
  });
  order=await orders.getById(job.orderId);
  assertPaidJob(job,order);
 }
 if(typeof order.confirmedLyrics!=='string'||!order.confirmedLyrics.trim())
  throw new Error('Paid lyrics not persisted after generation');
 const computed=buildSongProductionPlan(order);
 const stored=await orders.persistPaidSongPlanAtomic({
  orderId:order.id,expectedState:ORDER_STATES.PAID,
  privateDraftId:order.privateDraftId,
  jobKey:'paid-song-plan:'+order.id,songPlan:computed
 });
 if(!stored||!['created','duplicate'].includes(stored.outcome))
  throw new Error('Atomic song plan persistence failed');
 order=await orders.getById(job.orderId);
 assertPaidJob(job,order);
 verifyPaidSongPlan(order);
 let actualJob=job;
 if(job.route===FULFILLMENT_ROUTE.APPROVED_API
   &&!(commercialApiAgreementVerified===true&&musicProviderReady===true
      &&order.commercialApiAgreementVerified===true)){
  // Provider unavailable: fallback is an AUDITED DATABASE transition.
  // Never silently call a consumer Suno MCP using account credits.
  if(typeof orders?.routeUnstartedJobToManualAtomic!=='function')
   throw new Error('B2B rights absent and safe manual fallback unavailable');
  const changed=await orders.routeUnstartedJobToManualAtomic({
   orderId:order.id,jobKey:job.key,
   expectedRoute:FULFILLMENT_ROUTE.APPROVED_API,
   nextRoute:FULFILLMENT_ROUTE.HUMAN,
   reason:'no_verified_commercial_music_api',
   idempotencyKey:'withu-manual-fallback:'+order.id
  });
  if(changed?.status!=='claimed'||changed.route!==FULFILLMENT_ROUTE.HUMAN)
   throw new Error('Manual fallback transition was not persisted');
  actualJob=changed;
  order=await orders.getById(job.orderId);
  assertPaidJob(actualJob,order);
  verifyPaidSongPlan(order);
 }
 const outcome=await executePaidJob({
  job:actualJob,order,operatorEmail,
  musicProvider:commercialApiAgreementVerified===true&&musicProviderReady===true
   ?musicProvider:null
 });
 // Provider music must remain private and pass manual/quality selection
 // before a delivery link can be issued. Persist outbox before returning.
 if(actualJob.route===FULFILLMENT_ROUTE.APPROVED_API){
  if(typeof orders?.recordPrivateMusicCandidatesAtomic!=='function')
   throw new Error('Durable private music-candidate outbox required');
  const committed=await orders.recordPrivateMusicCandidatesAtomic({
   orderId:order.id,
   jobKey:actualJob.key,
   candidates:outcome.providerResult,
   expectedPurchasedSongCount:outcome.purchasedSongCount,
   idempotencyKey:'withu-private-candidates:'+order.id
  });
  if(!committed||!['created','duplicate'].includes(committed.outcome))
   throw new Error('Music candidates could not be stored privately');
 }
 return Object.freeze({
  orderId:order.id,route:actualJob.route,
  lyricVerified:true,promptPrivate:true,
  awaitingHumanReview:true,
  customerDeliveryStarted:false
 });
}
