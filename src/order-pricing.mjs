/**
 * Trusted amount calculator for an order. Always derive prices from the
 * server-owned catalog and validated genre selection, never browser prices.
 */
import {publicPriceCatalog} from './commerce.mjs';
import {normalizeGenreSelection} from './song-production-plan.mjs';

export function quoteOrderAmount({productId,genreSelection,thirdVerse=false}={}){
 if(typeof thirdVerse!=='boolean')throw new Error('Third verse must be boolean');
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
 const addOnKrw=selected.mode==='blend'?mixFee:0;
 const verseAddOnKrw=thirdVerse?thirdVerseFee:0;
 const amountKrw=product.amountKrw+addOnKrw+verseAddOnKrw;
 if(!Number.isSafeInteger(amountKrw)||amountKrw<=0)
  throw new Error('Invalid calculated server order amount');
 return Object.freeze({
  productId,baseAmountKrw:product.amountKrw,
  blendAddOnKrw:addOnKrw,thirdVerseAddOnKrw:verseAddOnKrw,amountKrw,
  priceKind:product.priceKind,quoteRequired:product.quoteRequired===true,
  currency:'KRW'
 });
}
