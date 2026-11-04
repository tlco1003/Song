(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY='withu-order-draft-v1';
const draftMaxAge=30*60*1000;
let draft=null;
function getDraft(){
 try{
  const parsed=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(!parsed||typeof parsed!=='object'||!Number.isFinite(parsed.savedAt)||Date.now()-parsed.savedAt>draftMaxAge)return null;
  if(typeof parsed.lyrics!=='string'||typeof parsed.style!=='string'||!parsed.lyrics.trim()||!parsed.style.trim())return null;
  return parsed;
 }catch(_){return null}
}
// Display-only choices: the real PG widget will be rendered only after
// server-owned prices, approved payment credentials and a durable order store exist.
// No card number, bank credential or customer email is sent by this preview.
const paymentInfo=Object.freeze({
 toss_pay:{title:'토스페이',help:'실제 연동 시 토스페이 앱 또는 인증창에서 결제를 승인합니다.'},
 kakao_pay:{title:'카카오페이',help:'실제 연동 시 카카오페이 앱/결제창으로 이동해 인증합니다. 가맹점 계약 후 제공 여부가 결정됩니다.'},
 naver_pay:{title:'네이버페이',help:'실제 연동 시 네이버페이 인증창에서 결제합니다. 가맹점 설정에 따라 제공됩니다.'},
 card:{title:'신용·체크카드',help:'카드번호를 WITHU가 직접 수집하지 않습니다. 결제사 보안 결제창에서 카드 정보를 입력합니다.'},
 transfer:{title:'실시간 계좌이체',help:'결제사의 은행 이체 인증 후 서버에서 승인 상태를 확인합니다.'},
 virtual_account:{title:'가상계좌 입금',help:'계약 후 주문별 가상계좌가 발급됩니다. 입금 확인 웹훅과 서버 검증 이후에만 결제 완료로 처리합니다.'}
});
function chosenPayment(){
 const value=document.querySelector('input[name="paymentMethod"]:checked')?.value;
 return paymentInfo[value]||paymentInfo.toss_pay;
}
function showPaymentSelection(){
 const method=chosenPayment();
 $('payment-method-title').textContent=method.title;
 $('payment-method-help').textContent=method.help;
 $('selected-payment-method').textContent=method.title+' (연동 준비 중)';
}
function closePaymentPreview(){
 const dialog=$('payment-preview-dialog');
 if(typeof dialog.close==='function')dialog.close();
 else dialog.removeAttribute('open');
}
function showPaymentPreview(){
 const dialog=$('payment-preview-dialog'),method=chosenPayment();
 const product=document.querySelector('input[name="product"]:checked')?.value;
 const order=getDraft();
 $('demo-product').textContent=product==='audio_video'?'노래 + 뮤직비디오 (제작 연결 전)':'노래 선물 (MP3 + 가사)';
 $('demo-order').textContent=order?.title||'가사 작성 후 확정';
 $('demo-payment-method').textContent=method.title;
 $('demo-amount').textContent='가격 미확정 · 청구 불가';
 $('demo-method-detail').textContent=method.help;
 if(typeof dialog.showModal==='function')dialog.showModal();
 else dialog.setAttribute('open','');
}
function show(){
 draft=getDraft();
 $('order-title').textContent=draft?.title||'노래가 준비되지 않았어요.';
 $('order-style').textContent=draft?.style||'가사를 작성한 뒤 주문 화면으로 이동해 주세요.';
 $('order-lyrics').textContent=draft?.lyrics||'가사 작성 화면에서 먼저 노랫말을 준비해 주세요.';
}
function checkOrder(){
 const email=$('delivery-email').value.trim();
 const again=$('delivery-email-again').value.trim();
 if(!draft){$('checkout-message').textContent='먼저 가사를 작성하고 확정해 주세요.';return}
 if(!email||!$('delivery-email').checkValidity()){
  $('checkout-message').textContent='완성곡을 받을 올바른 이메일 주소를 입력해 주세요.';return;
 }
 if(email.toLowerCase()!==again.toLowerCase()){
  $('checkout-message').textContent='두 이메일 주소가 일치하지 않습니다.';return;
 }
 if(!$('consent-delivery').checked||!$('consent-service').checked){
  $('checkout-message').textContent='이메일 처리 동의와 서비스 안내 확인이 필요합니다.';return;
 }
 const option=document.querySelector('input[name="product"]:checked')?.value;
 $('checkout-message').textContent=(option==='audio_video'?'노래와 뮤직비디오':'노래')+' 주문 내용을 확인했어요. 결제·자동 제작 연결이 완료되면 여기에서 실제 주문할 수 있어요.';
}
async function readiness(){
 try{
  const r=await fetch('api/commerce/readiness',{cache:'no-store'});
  if(!r.ok)throw Error('not-ready');
  const config=await r.json();
  // Never enable payment unless backend is explicit about verified music,
  // payment, delivery, license and persistent order-queue readiness.
  const ready=config?.canCharge===true&&config?.licenseVerified===true
   &&config?.paymentVerified===true&&config?.musicVerified===true
   &&config?.emailVerified===true&&config?.orderStoreVerified===true;
  if(ready){
   // Intentionally keep closed: payment execution will be activated only when
   // server-side order-create + confirmation + idempotent webhook paths are implemented and tested.
   $('commerce-status').querySelector('strong').textContent='결제 기능 연결 확인 중';
   $('commerce-status').querySelector('p').textContent='결제 서버의 최종 주문 확인 절차를 준비하고 있습니다.';
  }
 }catch(_){
  $('commerce-status').querySelector('strong').textContent='주문·결제 기능 준비 중';
 }
 $('confirm-checkout').disabled=true;
}
for(const radio of document.querySelectorAll('input[name="paymentMethod"]')){
 radio.addEventListener('change',showPaymentSelection);
}
$('preview-payment').addEventListener('click',showPaymentPreview);
$('close-payment-preview').addEventListener('click',closePaymentPreview);
$('finish-payment-preview').addEventListener('click',closePaymentPreview);
$('payment-preview-dialog').addEventListener('click',event=>{
 if(event.target===$('payment-preview-dialog'))closePaymentPreview();
});
showPaymentSelection();
for(const radio of document.querySelectorAll('input[name="product"]')){
 radio.addEventListener('change',()=>{
  for(const label of document.querySelectorAll('.gift-choice'))label.classList.toggle('active',label.querySelector('input')?.checked===true);
  $('checkout-message').textContent='상품을 선택했어요. 실제 결제는 아직 시작되지 않습니다.';
 });
}
$('inspect-order').addEventListener('click',checkOrder);
show();
void readiness();
})();