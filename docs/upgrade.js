(()=>{
'use strict';
const button=document.getElementById('upgrade-pay');
const status=document.getElementById('upgrade-status');
let widgets=null,record=null;
async function initialize(){
 const id=new URLSearchParams(location.search).get('intent');
 if(!/^upg_[a-f0-9]{32}$/.test(id||''))throw Error('추가 결제 주문이 유효하지 않습니다.');
 const response=await fetch('/api/upgrade-intents/'+id,{
  credentials:'same-origin',cache:'no-store'
 });
 const data=await response.json();
 if(!response.ok||data.amountKrw!==10000)
  throw Error(data.error||'구매한 음원의 권리 및 결제 요청이 확인되지 않았습니다.');
 if(typeof window.TossPayments!=='function')throw Error('결제 위젯을 열 수 없습니다.');
 const sdk=window.TossPayments(data.clientKey);
 widgets=sdk.widgets({customerKey:window.TossPayments.ANONYMOUS});
 await widgets.setAmount({currency:'KRW',value:10000});
 await widgets.renderPaymentMethods({selector:'#upgrade-methods',variantKey:'DEFAULT'});
 await widgets.renderAgreement({selector:'#upgrade-agreement',variantKey:'AGREEMENT'});
 record=data;button.disabled=false;
 button.textContent='10,000원 안전하게 결제하기';
 status.textContent='원본 음원 및 상업적 이용 옵션 10,000원. 별도 결제 승인 후 다운로드가 열립니다.';
}
button.addEventListener('click',async()=>{
 if(!record||!widgets)return;
 button.disabled=true;
 try{
  await widgets.requestPayment({
   orderId:record.orderId,orderName:record.orderName,
   successUrl:location.origin+'/payment-success.html?kind=upgrade',
   customerEmail:record.customerEmail,
   failUrl:location.origin+'/payment-fail.html'
  });
 }catch(e){
  button.disabled=false;status.textContent=e?.message||'결제창이 취소됐습니다.';
 }
});
void initialize().catch(error=>{status.textContent=error.message||'연결 실패';});
})();