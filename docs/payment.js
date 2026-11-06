(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY='withu-order-draft-v1',MAX_AGE=30*60*1000;
const won=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:0});
const methods=Object.freeze({
 toss_pay:'토스페이',kakao_pay:'카카오페이',naver_pay:'네이버페이',
 card:'신용·체크카드',transfer:'실시간 계좌이체',virtual_account:'가상계좌'
});
function readDraft(){
 try{
  const draft=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(!draft||draft.version!==3||!Number.isFinite(draft.savedAt)
    ||Date.now()-draft.savedAt<0||Date.now()-draft.savedAt>MAX_AGE
    ||typeof draft.story?.recipient!=='string'||!draft.story.recipient.trim()
    ||!['audio','audio_duo','audio_video'].includes(draft.selectedProduct)
    ||!Array.isArray(draft.genreSelection?.genres))return null;
  return draft;
 }catch(_){return null;}
}
function genreLabels(selection,productId){
 if(selection.mode==='single'&&selection.genres.length===1)return ['1곡 · '+selection.genres[0]];
 if(selection.mode==='blend'&&selection.genres.length===2&&selection.genres[0]!==selection.genres[1]){
  const mix=selection.genres.join(' + ')+' (믹스)';
  return productId==='audio_duo'?['1곡 · '+mix,'2곡 · '+mix]:['1곡 · '+mix];
 }
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
  $('payment-price').textContent='주문 확인 필요';
  disableCheckout('먼저 사연과 음악 취향, 상품 및 장르를 선택해 주세요.');
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
  if(catalog.version!==1||catalog.currency!=='KRW'||genreCatalog.version!==2)throw Error('catalog invalid');
  const chosen=catalog.products.find(p=>p.id===draft.selectedProduct);
  const allowed=new Set(genreCatalog.genres.filter(g=>g.label===g.id&&!Object.hasOwn(g,'style')).map(g=>g.id));
  const lines=genreLabels(draft.genreSelection,draft.selectedProduct);
  const expectedCount=draft.selectedProduct==='audio_duo'?2:1;
  if(!chosen||!Number.isSafeInteger(chosen.amountKrw)||!lines||lines.length!==expectedCount
    ||!draft.genreSelection.genres.every(g=>allowed.has(g))
    ||catalog.addOns?.genreBlend?.amountKrw!==5000
    ||catalog.addOns?.thirdVerse?.amountKrw!==10000
    ||catalog.addOns?.dedicationOutro?.amountKrw!==5000
    ||(draft.thirdVerse!==undefined&&typeof draft.thirdVerse!=='boolean')
    ||(draft.dedicationOutro!==undefined&&typeof draft.dedicationOutro!=='boolean'))throw Error('invalid selection');
  if(draft.dedicationOutro===true){
   const text=String(draft.dedicationText||'').trim().replace(/\s+/g,' ');
   if(text.length<4||text.length>70||/[<>\r\n\u0000-\u001f]/u.test(text))throw Error('invalid dedication');
  }else if(String(draft.dedicationText||'').trim())throw Error('orphan dedication');
  const mode=draft.genreSelection.mode,g=draft.genreSelection.genres;
  if(!(expectedCount===1?['single','blend'].includes(mode):['same','different','blend'].includes(mode))
    ||(mode==='blend'&&!(g.length===2&&g[0]!==g[1])))throw Error('invalid genre mode');
  const total=chosen.amountKrw+(mode==='blend'?catalog.addOns.genreBlend.amountKrw:0)
   +(draft.thirdVerse===true?catalog.addOns.thirdVerse.amountKrw:0)
   +(draft.dedicationOutro===true?catalog.addOns.dedicationOutro.amountKrw:0);
  $('payment-price').textContent=won.format(total)+(chosen.priceKind==='starting_at'?'부터':'');
  $('payment-quote-notice').hidden=!chosen.quoteRequired;
  if(chosen.quoteRequired){
   disableCheckout('뮤직비디오는 개별 견적을 확정한 후 결제할 수 있습니다.');
  }else{
   disableCheckout('현재 주문 접수 전입니다. 결제가 가능해지면 이곳에서 결제할 수 있어요.');
  }
 }catch(_){
  disableCheckout('주문 정보를 확인할 수 없어요. 이전 화면에서 상품을 다시 선택해 주세요.');
 }
}
for(const item of document.querySelectorAll('input[name="paymentMethod"]')){
 item.addEventListener('change',()=>{
  const selected=document.querySelector('input[name="paymentMethod"]:checked')?.value;
  $('payment-method-hint').textContent=(methods[selected]||'결제수단')+'를 선택했어요.';
 });
}

const channels=Object.freeze({
 email:'완성된 노래를 이메일의 전용 링크로 알려드려요.',
 sms:'제작 완료 후 휴대전화 문자로 나의 노래함 링크를 보내드려요.',
 kakao:'제작 완료 후 승인된 카카오 알림톡으로 나의 노래함 링크를 보내드려요.'
});
function normalizedPhone(value){
 const digits=String(value||'').replace(/[\s-]/g,'');
 return /^01[016789]\d{7,8}$/.test(digits)?digits:null;
}
function selectedDeliveryChannel(){
 const channel=document.querySelector('input[name="deliveryChannel"]:checked')?.value;
 return Object.hasOwn(channels,channel)?channel:null;
}
function validateContactFields({showError=false}={}){
 const email=$('delivery-email').value.trim();
 const phone=$('delivery-phone').value.trim();
 const channel=selectedDeliveryChannel();
 const emailValid=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/u.test(email)
  &&email.length<=254;
 const phoneValid=normalizedPhone(phone)!==null;
 const valid=emailValid&&phoneValid&&channel;
 if(showError){
  $('delivery-email').setAttribute('aria-invalid',String(!emailValid));
  $('delivery-phone').setAttribute('aria-invalid',String(!phoneValid));
  $('delivery-phone-hint').textContent=phoneValid?
   '선택한 연락 방법으로 안내를 받을 수 있어요.':
   '010으로 시작하는 국내 휴대전화 번호를 정확히 입력해 주세요.';
  $('delivery-channel-hint').textContent=
   !emailValid?'이메일 주소를 확인해 주세요.':
   !phoneValid?'휴대전화 번호를 확인해 주세요.':
   channels[channel]||'알림 수신 방법을 선택해 주세요.';
 }else{
  $('delivery-channel-hint').textContent=channels[channel]||'알림 수신 방법을 선택해 주세요.';
 }
 return Boolean(valid);
}
for(const id of ['delivery-email','delivery-phone']){
 $(id).addEventListener('blur',()=>{validateContactFields({showError:true});});
 $(id).addEventListener('input',()=>{validateContactFields();});
}
for(const item of document.querySelectorAll('input[name="deliveryChannel"]')){
 item.addEventListener('change',()=>{validateContactFields({showError:true});});
}
// At the future PG checkout boundary, the server MUST independently validate
// customerEmail, customerPhone, deliveryChannel and consent; these browser
// values are NEVER trusted as payment or identity verification.
// Intentionally no form submit / redirect / PG SDK call. Real payments require
// server-side order creation, PG verification, contract and policies.
$('confirm-checkout').disabled=true;
void init();
})();