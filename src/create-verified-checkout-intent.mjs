/**
 * Future real PG checkout's authenticated server-only order intent.
 *
 * The customer submits draftId and delivery contact ONCE. The actual price,
 * product and private instructions always come from the encrypted server
 * draft. No card data, payment status or generated prompts are read from
 * the browser. This is NOT wired to public checkout until a durable DB + PG.
 */
import {validateCheckoutDeliveryContact}
 from './customer-notification-contact.mjs';
import {quoteOrderAmount} from './order-pricing.mjs';
import {ORDER_STATES} from './commerce.mjs';

const DRAFT=/^[a-f0-9-]{36}$/i;
export async function createPendingCheckoutIntent({
 draftId,contact,clientAmountKrw,clientPaymentComplete,
 clientLyricPrompt,clientStylePrompt
}={},{
 privateDrafts,orders
}={}){
 if(typeof draftId!=='string'||!DRAFT.test(draftId))
  throw new Error('Known encrypted private draft ID is required');
 if(clientPaymentComplete===true||clientLyricPrompt!=null||clientStylePrompt!=null)
  throw new Error('Browser cannot assert payment or music prompt');
 if(typeof privateDrafts?.readById!=='function'
  ||typeof orders?.createPendingPaymentOrderAtomic!=='function')
  throw new Error('Protected private draft and transactional order database required');
 const delivery=validateCheckoutDeliveryContact(contact);
 const draft=await privateDrafts.readById(draftId);
 if(draft?.status!=='awaiting_verified_payment'||draft.verifiedPaid!==false
  ||typeof draft.lyricPrompt!=='string'||draft.lyricPrompt.length<30)
  throw new Error('Encrypted draft not eligible for checkout');
 const quote=quoteOrderAmount({
  productId:draft.productId,genreSelection:draft.genreSelection,
  thirdVerse:draft.thirdVerse??false,
  dedicationOutro:draft.dedicationOutro??false,
  dedicationText:draft.dedicationText??''
 });
 if(quote.quoteRequired===true)throw new Error('Video quotes must be operator-approved');
 if(quote.amountKrw!==draft.amountBreakdown?.amountKrw)
  throw new Error('Server private draft price was modified');
 if(clientAmountKrw!=null&&clientAmountKrw!==quote.amountKrw)
  throw new Error('Client price differs from server price');
 const saved=await orders.createPendingPaymentOrderAtomic({
  privateDraftId:draftId,
  productId:draft.productId,
  genreSelection:draft.genreSelection,
  // These creative attributes come exclusively from encrypted private draft.
  songTitle:draft.title,
  mood:draft.mood,
  eraPreference:draft.eraPreference,
  recipientAgeGroup:draft.delivery?.recipientAgeGroup||'unknown',
  speechStyle:draft.delivery?.speechStyle||'auto',
  story:{...draft.story,
   recipientAgeGroup:draft.delivery?.recipientAgeGroup||'unknown',
   speechStyle:draft.delivery?.speechStyle||'auto',
   eraPreference:draft.eraPreference},
  sharedStyleNotes:'',
  thirdVerse:draft.thirdVerse,
  dedicationOutro:draft.dedicationOutro,
  dedicationText:draft.dedicationText,
  amountKrw:quote.amountKrw,currency:'KRW',
  customerEmail:delivery.customerEmail,
  customerPhone:delivery.customerPhone,
  deliveryChannel:delivery.deliveryChannel,
  deliveryConsent:delivery.deliveryConsent,
  nextState:ORDER_STATES.PAYMENT_PENDING,
  idempotencyKey:'checkout-from-private-draft:'+draftId
 });
 if(!saved||!['created','duplicate'].includes(saved.outcome)
  ||typeof saved.orderId!=='string'||saved.orderId.length<6)
  throw new Error('Pending payment order was not persisted');
 return Object.freeze({
  status:'pending_provider_checkout',
  orderId:saved.orderId,amountKrw:quote.amountKrw,
  currency:'KRW',paymentVerified:false,
  customerDeliveryEnabled:false
 });
}
