/**
 * WITHU verified order checkout.
 * Trusted cloud endpoint calculates the price and stores the order BEFORE
 * the Toss Payments SDK opens. No browser-only paid status is possible.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY='withu-order-draft-v1',MAX_AGE=30*60*1000;
const won=n=>new Intl.NumberFormat('ko-KR').format(n)+'원';
let widgets=null,prepared=null,busy=false,enabled=false,source=null;
const modeMessage=text=>{$('payment-widget-mode').textContent=text;};
function message(text){$('payment-unavailable').textContent=text;}
function draft(){
 try{
  const data=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(data?.version!==3||!Number.isFinite(data.savedAt)
   ||Date.now()-data.savedAt>MAX_AGE||Date.now()-data.savedAt<0
   ||typeof data.story?.recipient!=='string'
   ||!['audio','audio_duo'].includes(data.selectedProduct)
   ||!Array.isArray(data.genreSelection?.genres))return null;
  return data;
 }catch(_){return null;}
}
function checkContact(){
 const email=$('delivery-email').value.trim();
 const phone=$('delivery-phone').value.replace(/[\s-]/g,'');
 const channel=document.querySelector('input[name="deliveryChannel"]:checked')?.value;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)
  throw Error('이메일 주소를 정확히 입력해 주세요.');
 if(!/^01[016789]\d{7,8}$/.test(phone))
  throw Error('국내 휴대전화 번호를 정확히 입력해 주세요.');
 if(!['email','sms','kakao'].includes(channel))
  throw Error('완성곡 수령 방법을 선택하세요.');
 if(!$('consent-delivery').checked||!$('consent-service').checked)
  throw Error('배송 안내·개인정보 및 서비스 약관을 확인하고 동의해 주세요.');
 if(!$('consent-refund').checked)
  throw Error('맞춤 제작·취소 및 환불 정책의 별도 고지에 동의해 주세요.');
 return {customerEmail:email,customerPhone:phone,
  deliveryChannel:channel,deliveryConsent:true};
}
async function publicWidgetConfig(){
 // Public test client key is deliberately isolated from server secret keys.
 // Never authorize charges from this file or any browser-only status.
 try{
  const r=await fetch('payment-widget-public.json',{cache:'no-store'});
  if(!r.ok)return null;
  const cfg=await r.json();
  if(cfg?.schemaVersion!==1||cfg.mode!=='test'||cfg.previewOnly!==true
   ||typeof cfg.tossClientKey!=='string'
   ||!/^test_gck_[A-Za-z0-9_-]{8,}$/.test(cfg.tossClientKey))return null;
  return cfg;
 }catch(_){return null;}
}
async function configure(){
 const data=draft();
 source=data;
 let localPrice;
 try{
  const r=await fetch('prices.json',{cache:'no-store'});
  if(!r.ok)throw Error('가격표를 불러올 수 없습니다.');
  const catalog=await r.json();
  const product=catalog.products.find(p=>p.id===(data?.selectedProduct||'audio'));
  if(!product||product.quoteRequired)throw Error('상품 가격이 확정되지 않았습니다.');
  localPrice=product.amountKrw+(data?.genreSelection?.mode==='blend'?catalog.addOns.genreBlend.amountKrw:0)
   +(data?.thirdVerse===true?catalog.addOns.thirdVerse.amountKrw:0)
   +(data?.dedicationOutro===true?catalog.addOns.dedicationOutro.amountKrw:0);
  if(!Number.isSafeInteger(localPrice)||localPrice<1000)throw Error('가격표가 올바르지 않습니다.');
 }catch(error){
  message(error.message||'주문 가격을 확인할 수 없습니다.');
  modeMessage('가격표를 확인할 수 없어 결제수단을 표시하지 못했습니다.');
  return;
 }
 $('payment-price').textContent=data?won(localPrice):'1곡 예시 '+won(localPrice)+' · 주문 전';
 // Real production readiness exclusively comes from the authenticated server.
 const response=await fetch('/api/runtime',{cache:'no-store'}).catch(()=>null);
 let runtime=null;
 if(response?.ok){try{runtime=await response.json();}catch(_){runtime=null;}}
 for(const option of document.querySelectorAll('input[name="deliveryChannel"]')){
  if(!['email'].includes(option.value)
   &&!(runtime?.deliveryChannels||[]).includes(option.value)){
   option.disabled=true;
   const note=option.closest('label')?.querySelector('small');
   if(note)note.textContent='추후 연동 예정';
  }
 }
 const cfg=runtime||{};
 // Only the trusted /api/runtime response may authorize checkout.
 const serverBlocked=cfg.canCharge!==true;
 const liveReady=Boolean(data&&runtime?.canCharge===true
  &&!serverBlocked
  &&typeof runtime?.tossClientKey==='string'
  &&/^(test|live)_gck_/.test(runtime.tossClientKey));
 const preview=liveReady?null:await publicWidgetConfig();
 const clientKey=liveReady?runtime.tossClientKey:preview?.tossClientKey;
 if(!clientKey){
  modeMessage('서버 연결과 결제 UI 준비가 필요합니다. 토스 테스트 클라이언트 키 및 위젯 등록을 확인하세요.');
  message(data?'결제 서버가 아직 준비되지 않았습니다. 고객센터를 이용해 주세요.':
   '먼저 나만의 노래와 상품을 선택해 주세요.');
  return;
 }
 if(typeof window.TossPayments!=='function'){
  modeMessage('토스페이먼츠 SDK를 불러오지 못했습니다. 인터넷 연결 또는 브라우저 확장 프로그램을 확인하세요.');
  message('결제수단 화면을 불러오지 못했습니다.');return;
 }
 try{
  const sdk=window.TossPayments(clientKey);
  widgets=sdk.widgets({customerKey:window.TossPayments.ANONYMOUS});
  await widgets.setAmount({currency:'KRW',value:localPrice});
  await widgets.renderPaymentMethods({selector:'#toss-payment-methods',variantKey:'DEFAULT'});
  await widgets.renderAgreement({selector:'#toss-payment-agreement',variantKey:'AGREEMENT'});
 }catch(error){
  // UNAUTHORIZED_KEY or NOT_REGISTERED_PAYMENT_WIDGET must NOT be hidden.
  const code=String(error?.code||error?.message||'UNKNOWN').slice(0,80);
  modeMessage('결제수단 위젯을 표시하지 못했습니다 ('+code+'). 토스 관리자에서 주문서형 결제 UI와 테스트 키를 확인하세요.');
  message('실제 결제는 연결 전까지 비활성화되어 있습니다.');return;
 }
 if(!liveReady){
  modeMessage('토스 공식 결제수단 테스트 화면 · 수단 선택만 가능하며 실제 결제는 비활성화되어 있습니다. 사용 가능한 수단은 토스 상점 설정에 따릅니다.');
  message(data?'결제 서버가 연결되기 전이므로 결제하기는 잠겨 있습니다.':
   '주문 내용이 없는 예시 화면입니다. 실제 결제를 위해서는 나만의 노래에서 주문을 시작하세요.');
  return;
 }
 prepared={data,localPrice};
 enabled=true;
 $('confirm-checkout').disabled=false;
 $('confirm-checkout').textContent='안전하게 '+won(localPrice)+' 결제하기';
 modeMessage('토스페이먼츠에서 승인된 결제수단을 선택하세요.');
 message('결제수단을 선택한 뒤 결제하기를 누르세요. 결제 승인 후 제작이 시작됩니다.');
}
async function placeOrder(){
 if(!enabled||!prepared||busy)return;
 busy=true;
 const button=$('confirm-checkout');
 button.disabled=true;
 try{
  const contact=checkContact();
  message('서버에서 주문금액을 검증하는 중이에요.');
  const r=await fetch('/api/orders',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
    draft:{
     selectedProduct:prepared.data.selectedProduct,
     genreSelection:prepared.data.genreSelection,
     thirdVerse:prepared.data.thirdVerse===true,
     dedicationOutro:prepared.data.dedicationOutro===true,
     dedicationText:prepared.data.dedicationOutro===true?
      prepared.data.dedicationText||'':'',
     trackPreferences:prepared.data.trackPreferences,
     story:prepared.data.story
    },
    contact,clientAmount:prepared.localPrice,
    termsAccepted:true,privacyAccepted:true,
    refundPolicyAcknowledged:true,refundPolicyVersion:'2026-11-15'
   })
  });
  const record=await r.json();
  if(!r.ok||!record.orderId||record.amountKrw!==prepared.localPrice)
   throw Error(record.error||'주문서 가격 검증에 실패했습니다.');
  message('안전한 결제창을 여는 중이에요.');
  await widgets.requestPayment({
   orderId:record.orderId,
   orderName:record.orderName,
   successUrl:location.origin+'/payment-success.html',
   failUrl:location.origin+'/payment-fail.html',
   customerEmail:contact.customerEmail,
   customerMobilePhone:contact.customerPhone
  });
 }catch(error){
  message(error.message||'결제창을 열지 못했습니다. 다시 시도해 주세요.');
  button.disabled=false;busy=false;
 }
}
$('confirm-checkout').addEventListener('click',()=>{void placeOrder();});
for(const id of ['delivery-email','delivery-phone','consent-delivery','consent-service','consent-refund']){
 $(id).addEventListener('change',()=>{if(!busy&&enabled)message('연락처와 약관을 확인한 뒤 결제할 수 있습니다.');});
}
void configure();
})();