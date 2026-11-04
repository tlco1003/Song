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