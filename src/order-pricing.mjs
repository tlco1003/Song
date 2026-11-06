/**
 * Trusted amount calculator for an order. Always derive prices from the
 * server-owned catalog and validated genre selection, never browser prices.
 */
import {publicPriceCatalog} from './commerce.mjs';
import {normalizeGenreSelection} from './song-production-plan.mjs';

export function validateDedicationChoice({dedicationOutro=false,dedicationText=''}={}){
 if(typeof dedicationOutro!=='boolean'||typeof dedicationText!=='string')
  throw new Error('Dedication choice must have a boolean flag and text');
 if(!dedicationOutro){
  if(dedicationText.trim())throw new Error('Dedication text requires a selected paid add-on');
  return Object.freeze({enabled:false,text:''});
 }
 const text=dedicationText.trim().replace(/\s+/g,' ');
 if(text.length<4||text.length>70||/[<>\r\n\u0000-\u001f]/u.test(text))
  throw new Error('Dedication text must be 4 to 70 printable characters');
 return Object.freeze({enabled:true,text});
}
export function quoteOrderAmount({productId,genreSelection,thirdVerse=false,
 dedicationOutro=false,dedicationText=''}={}){
 if(typeof thirdVerse!=='boolean')throw new Error('Third verse must be boolean');
 const dedication=validateDedicationChoice({dedicationOutro,dedicationText});
 const catalog=publicPriceCatalog();
 const product=catalog.products.find(p=>p.id===productId);
 if(!product)throw new Error('Unknown server product');
 const selected=normalizeGenreSelection(productId,genreSelection);
 const mixFee=catalog.addOns?.genreBlend?.amountKrw;
 if(!Number.isSafeInteger(mixFee)||mixFee!==5000)
  throw new Error('Server genre blend surcharge missing or invalid');
 const thirdVerseFee=catalog.addOns?.thirdVerse?.amountKrw;
 if(!Number.isSafeInteger(thirdVerseFee)||thirdVerseFee!==10000)
  throw new Error('Server third verse surcharge missing or invalid');
 const dedicationFee=catalog.addOns?.dedicationOutro?.amountKrw;
 if(!Number.isSafeInteger(dedicationFee)||dedicationFee!==5000)
  throw new Error('Server dedication surcharge missing or invalid');
 const addOnKrw=selected.mode==='blend'?mixFee:0;
 const verseAddOnKrw=thirdVerse?thirdVerseFee:0;
 const dedicationAddOnKrw=dedication.enabled?dedicationFee:0;
 const amountKrw=product.amountKrw+addOnKrw+verseAddOnKrw+dedicationAddOnKrw;
 if(!Number.isSafeInteger(amountKrw)||amountKrw<=0)
  throw new Error('Invalid calculated server order amount');
 return Object.freeze({
  productId,baseAmountKrw:product.amountKrw,
  blendAddOnKrw:addOnKrw,thirdVerseAddOnKrw:verseAddOnKrw,
  dedicationAddOnKrw,amountKrw,
  priceKind:product.priceKind,quoteRequired:product.quoteRequired===true,
  currency:'KRW'
 });
}
