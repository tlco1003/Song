(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY='withu-order-draft-v1',MAX_AGE=30*60*1000;
const won=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:0});
function readDraft(){
 try{
  const draft=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(!draft||draft.version!==1||!Number.isFinite(draft.savedAt)
    ||Date.now()-draft.savedAt<0||Date.now()-draft.savedAt>MAX_AGE
    ||!draft.lyrics?.trim()||!draft.title?.trim()
    ||!['audio','audio_duo','audio_video'].includes(draft.selectedProduct)
    ||!Array.isArray(draft.genreSelection?.genres))return null;
  return draft;
 }catch(_){return null;}
}
function genreLabels(selection){
 if(selection.mode==='single'&&selection.genres.length===1)return ['1곡 · '+selection.genres[0]];
 if(selection.mode==='same'&&selection.genres.length===1)return ['1곡 · '+selection.genres[0],'2곡 · '+selection.genres[0]];
 if(selection.mode==='different'&&selection.genres.length===2&&selection.genres[0]!==selection.genres[1])
  return ['1곡 · '+selection.genres[0],'2곡 · '+selection.genres[1]];
 return null;
}
function disableCheckout(reason){
 $('confirm-checkout').disabled=true;
 $('payment-unavailable').textContent=reason;
}
async function init(){
 const draft=readDraft();
 if(!draft){
  $('payment-product').textContent='노래 선택이 필요해요.';
  disableCheckout('먼저 가사를 완성하고 상품과 장르를 선택해 주세요.');
  window.WITHU_PAYMENT_PREVIEW_READY=true;
  window.dispatchEvent(new Event('withu:payment-preview-ready'));
  return;
 }
 try{
  const [catalogResult,genreResult]=await Promise.all([
   fetch('prices.json',{cache:'no-store'}),
   fetch('music-genres.json',{cache:'no-store'})
  ]);
  if(!catalogResult.ok||!genreResult.ok)throw Error('catalog not loaded');
  const catalog=await catalogResult.json();
  const genreCatalog=await genreResult.json();
  if(catalog.version!==1||catalog.currency!=='KRW'||genreCatalog.version!==1)throw Error('catalog invalid');
  const chosen=catalog.products.find(p=>p.id===draft.selectedProduct);
  const allowed=new Set(genreCatalog.genres.map(g=>g.id));
  const lines=genreLabels(draft.genreSelection);
  const expectedCount=draft.selectedProduct==='audio_duo'?2:1;
  if(!chosen||!Number.isSafeInteger(chosen.amountKrw)||!lines||lines.length!==expectedCount
    ||!draft.genreSelection.genres.every(g=>allowed.has(g)))throw Error('invalid selection');
  $('payment-product').textContent=chosen.name;
  $('payment-song-title').textContent=draft.title;
  $('payment-song-genres').textContent=lines.join('\n');
  $('payment-price').textContent=won.format(chosen.amountKrw)+(chosen.priceKind==='starting_at'?'부터':'');
  $('payment-quote-notice').hidden=!chosen.quoteRequired;
  if(chosen.quoteRequired){
   disableCheckout('뮤직비디오는 개별 견적을 확정한 후 결제할 수 있습니다.');
  }else{
   disableCheckout('현재 주문 접수 전입니다. 결제가 가능해지면 이곳에서 결제할 수 있어요.');
  }
 }catch(_){
  disableCheckout('주문 정보를 확인할 수 없어요. 이전 화면에서 상품을 다시 선택해 주세요.');
 }finally{
  window.WITHU_PAYMENT_PREVIEW_READY=true;
  window.dispatchEvent(new Event('withu:payment-preview-ready'));
 }
}
for(const id of ['delivery-email','delivery-email-again']){
 $(id).addEventListener('blur',()=>{
  const first=$('delivery-email').value.trim(),second=$('delivery-email-again').value.trim();
  if(first&&second&&first.toLowerCase()!==second.toLowerCase()){
   $('payment-method-hint').textContent='두 이메일 주소가 일치하지 않습니다.';
  }else{
   $('payment-method-hint').textContent='결제 가능 수단은 인증된 결제위젯에서 확인해 주세요.';
  }
 });
}
// Intentionally no form submit / redirect / PG SDK call. Real payments require
// server-side order creation, PG verification, contract and policies.
$('confirm-checkout').disabled=true;
void init();
})();