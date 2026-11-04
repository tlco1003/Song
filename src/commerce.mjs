/**
 * WITHU commercial order contract.
 *
 * This module intentionally DOES NOT charge, store customer addresses,
 * create music, or email files. Every external capability requires a real,
 * contractually licensed provider and an idempotent verified integration.
 */
export const ORDER_STATES=Object.freeze({
  DRAFT:'draft',
  PAYMENT_PENDING:'payment_pending',
  PAID:'paid',
  GENERATING_MUSIC:'generating_music',
  MUSIC_READY:'music_ready',
  GENERATING_VIDEO:'generating_video',
  READY_TO_DELIVER:'ready_to_deliver',
  DELIVERING:'delivering',
  DELIVERED:'delivered',
  FAILED:'failed',
  REFUND_PENDING:'refund_pending',
  REFUNDED:'refunded'
});

const transitions=Object.freeze({
 draft:['payment_pending'],
 payment_pending:['paid','failed'],
 paid:['generating_music','refund_pending'],
 generating_music:['music_ready','failed'],
 music_ready:['generating_video','ready_to_deliver'],
 generating_video:['ready_to_deliver','failed'],
 ready_to_deliver:['delivering'],
 delivering:['delivered','failed'],
 failed:['refund_pending'],
 refund_pending:['refunded']
});

export function assertOrderTransition(from,to,proof={}){
 if(!Object.values(ORDER_STATES).includes(from)||!Object.values(ORDER_STATES).includes(to))
   throw new TypeError('Invalid order state');
 if(!transitions[from]?.includes(to))throw new Error('Invalid order state transition');
 if(to===ORDER_STATES.PAID&&!(proof.verifiedProviderPayment===true&&proof.matchesServerOrderAmount===true))
   throw new Error('Payment confirmation and server-owned amount are required');
 if(to===ORDER_STATES.GENERATING_MUSIC&&proof.commercialMusicLicenseVerified!==true)
   throw new Error('Commercial music license is required before generating');
 if(to===ORDER_STATES.DELIVERING&&!(proof.storedOutputVerified===true&&proof.recipientVerified===true))
   throw new Error('Verified deliverable and recipient are required');
 return true;
}

export function publicCommerceReadiness(){
 // Fail-closed until an approved Suno B2B provider, payment gateway,
 // durable order database, email service and refund handling are built.
 // No environment variable, client value or "ready" flag can bypass this.
 return Object.freeze({
   canCharge:false,
   licenseVerified:false,
   paymentVerified:false,
   musicVerified:false,
   emailVerified:false,
   orderStoreVerified:false,
   videoGenerationVerified:false,
   products:['audio','audio_video'],
   status:'integration_pending'
 });
}
