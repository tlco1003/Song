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
 return {customerEmail:email,customerPhone:phone,
  deliveryChannel:channel,deliveryConsent:true};
}
async function configure(){
 const data=draft();
 if(!data){
  message('먼저 노래 제작 조건과 상품을 선택해 주세요.');
  $('payment-price').textContent='주문 정보 확인 필요';
  return;
 }
 source=data;
 let localPrice;
 try{
  const r=await fetch('prices.json',{cache:'no-store'});
  if(!r.ok)throw Error();
  const catalog=await r.json();
  const product=catalog.products.find(p=>p.id===data.selectedProduct);
  if(!product||product.quoteRequired)throw Error();
  localPrice=product.amountKrw+
   (data.genreSelection.mode==='blend'?catalog.addOns.genreBlend.amountKrw:0)+
   (data.thirdVerse===true?catalog.addOns.thirdVerse.amountKrw:0)+
   (data.dedicationOutro===true?catalog.addOns.dedicationOutro.amountKrw:0);
  if(!Number.isSafeInteger(localPrice)||localPrice<1000)throw Error();
 }catch(_){message('주문 가격을 확인할 수 없습니다.');return;}
 $('payment-price').textContent=won(localPrice);
 const response=await fetch('/api/runtime',{cache:'no-store'}).catch(()=>null);
 if(!response?.ok){
  message('결제 서버가 연결되어 있지 않습니다. 운영 Firebase Hosting 주소에서 이용해 주세요.');
  return;
 }
 const cfg=await response.json();
 for(const option of document.querySelectorAll('input[name="deliveryChannel"]')){
  if(!['email'].includes(option.value)
    &&!(cfg.deliveryChannels||[]).includes(option.value)){
   option.disabled=true;
   const note=option.closest('label')?.querySelector('small');
   if(note)note.textContent='추후 연동 예정';
  }
 }
 if(cfg.canCharge!==true||typeof cfg.tossClientKey!=='string'
  ||typeof window.TossPayments!=='function'){
  message('결제기관과 운영 서버의 설정이 아직 완료되지 않았습니다.');
  return;
 }
 try{
  const sdk=window.TossPayments(cfg.tossClientKey);
  widgets=sdk.widgets({customerKey:window.TossPayments.ANONYMOUS});
  await widgets.setAmount({currency:'KRW',value:localPrice});
  await widgets.renderPaymentMethods({
   selector:'#toss-payment-methods',variantKey:'DEFAULT'
  });
  await widgets.renderAgreement({
   selector:'#toss-payment-agreement',variantKey:'AGREEMENT'
  });
 }catch(_){
  message('토스페이먼츠 결제창을 불러오지 못했습니다. 상점 계약과 키를 확인하세요.');
  return;
 }
 prepared={data,localPrice};
 enabled=true;
 $('confirm-checkout').disabled=false;
 $('confirm-checkout').textContent='안전하게 '+won(localPrice)+' 결제하기';
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
     story:prepared.data.story
    },
    contact,clientAmount:prepared.localPrice,
    termsAccepted:true,privacyAccepted:true
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
for(const id of ['delivery-email','delivery-phone','consent-delivery','consent-service']){
 $(id).addEventListener('change',()=>{if(!busy&&enabled)message('연락처와 약관을 확인한 뒤 결제할 수 있습니다.');});
}
void configure();
})();