/**
 * Trusted post-payment job contract.
 * Private, verified paid order -> saved private prompt -> AI lyrics -> atomic store.
 * This function is not exposed as a public HTTP route.
 */
import {ORDER_STATES} from './commerce.mjs';
import {makeLyricsFromPrivatePrompt} from './providers.mjs';

export async function generatePaidOrderLyrics({
 order,privateDraft,lyricProvider=makeLyricsFromPrivatePrompt,orders
}){
 if(order?.state!==ORDER_STATES.PAID||!order.paymentVerifiedAt
  ||typeof order.paymentKey!=='string'||!order.paymentKey
  ||typeof order.privateDraftId!=='string'||order.privateDraftId.length<20)
  throw new Error('Verified paid order with bound server draft is required');
 if(privateDraft?.status!=='awaiting_verified_payment'
  ||privateDraft.productId!==order.productId
  ||privateDraft.verifiedPaid!==false
  ||!Array.isArray(privateDraft.songStyles)||privateDraft.songStyles.length<1
  ||typeof privateDraft.lyricPrompt!=='string')
  throw new Error('Private draft does not match verified order');
 if(JSON.stringify(privateDraft.genreSelection)!==JSON.stringify(order.genreSelection))
  throw new Error('Customer genre choice changed after draft was saved');
 if((privateDraft.thirdVerse===true)!==(order.thirdVerse===true))
  throw new Error('Customer third verse option differs from paid order');
 if((privateDraft.dedicationOutro===true)!==(order.dedicationOutro===true)
   ||String(privateDraft.dedicationText||'')!==String(order.dedicationText||''))
  throw new Error('Customer dedication differs from paid order');
 if(typeof lyricProvider!=='function'||typeof orders?.storeGeneratedLyricsAtomic!=='function')
  throw new Error('Trusted lyric provider and transactional order adapter required');
 const lyrics=await lyricProvider({
  prompt:privateDraft.lyricPrompt,lyricLength:privateDraft.lyricLength
 });
 if(typeof lyrics!=='string'||lyrics.length<12||lyrics.length>4200
  ||!/\[Verse(?:\s+\d+)?\]/i.test(lyrics)||!/\[Chorus\]/i.test(lyrics))
  throw new Error('Generated lyrics fail the paid-order structure contract');
 if(privateDraft.thirdVerse===true&&
   !(['1','2','3'].every(n=>new RegExp('\\[Verse\\s*'+n+'\\]','i').test(lyrics))))
  throw new Error('Paid third verse requires three distinct Verse sections');
 if(privateDraft.dedicationOutro===true&&
  (!/\[Outro\]/i.test(lyrics)
   ||!lyrics.includes(privateDraft.dedicationText)
   ||lyrics.lastIndexOf(privateDraft.dedicationText)<lyrics.indexOf('[Chorus]')))
  throw new Error('Paid dedication requires a verified ending containing the customer phrase');
 const result=await orders.storeGeneratedLyricsAtomic({
  orderId:order.id,expectedState:ORDER_STATES.PAID,
  boundDraftId:order.privateDraftId,
  jobKey:'paid-lyrics:'+order.id,
  title:privateDraft.title,confirmedLyrics:lyrics,
  selectedStyles:privateDraft.songStyles
 });
 if(!result||!['created','duplicate'].includes(result.outcome))
  throw new Error('Atomic private lyrics persistence failed');
 // Never send lyrics, style or text instructions to a public browser pre-delivery.
 return Object.freeze({status:'server_lyrics_saved',orderId:order.id,outcome:result.outcome});
}
