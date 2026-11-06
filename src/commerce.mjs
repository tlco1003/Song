/**
 * WITHU commercial order contract.
 *
 * This module intentionally DOES NOT charge, store customer addresses,
 * create music, or email files. Every external capability requires a real,
 * contractually licensed provider and an idempotent verified integration.
 */
import {readFileSync} from 'node:fs';

const catalog=JSON.parse(readFileSync(new URL('../docs/prices.json',import.meta.url),'utf8'));
const validIds=['audio','audio_duo','audio_video'];
if(catalog.version!==1||catalog.currency!=='KRW'||!Array.isArray(catalog.products)
  ||catalog.products.length!==3||!validIds.every(id=>catalog.products.some(item=>item.id===id&&Number.isSafeInteger(item.amountKrw)&&item.amountKrw>0))
  ||catalog.addOns?.genreBlend?.amountKrw!==5000||catalog.addOns?.thirdVerse?.amountKrw!==10000
  ||(catalog.promotion?.comparisonPriceVerified===true&&(!catalog.promotion?.comparisonEvidenceId||catalog.promotion.plannedRegularPriceKrw!==100000))
  ||!catalog.products.some(item=>item.id==='audio_video'&&item.priceKind==='starting_at'&&item.quoteRequired===true))
  throw new Error('Invalid WITHU price catalog');
export function publicPriceCatalog(){
  // DISPLAY ONLY: catalog prices cannot authorize a payment.
  return structuredClone(catalog);
}

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
   products:validIds,
   status:'integration_pending'
 });
}
