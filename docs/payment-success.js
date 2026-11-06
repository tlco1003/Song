(()=>{
'use strict';
const title=document.getElementById('pay-result-title');
const detail=document.getElementById('pay-result-detail');
const link=document.getElementById('pay-result-link');
const back=document.getElementById('pay-result-back');
async function confirm(){
 const qs=new URLSearchParams(location.search);
 const orderId=qs.get('orderId'),paymentKey=qs.get('paymentKey');
 const amount=Number(qs.get('amount')),upgrade=qs.get('kind')==='upgrade';
 // Do not retain the PG payment key in browser history or localStorage.
 history.replaceState(null,'',location.pathname);
 if(typeof orderId!=='string'||typeof paymentKey!=='string'||
  !Number.isSafeInteger(amount)||amount<=0){
  throw Error('결제 결과 정보를 확인할 수 없습니다.');
 }
 const response=await fetch(upgrade?'/api/upgrades/confirm':'/api/payments/confirm',{
  method:'POST',cache:'no-store',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({orderId,paymentKey,amount})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok||result.status!=='paid_verified')
  throw Error(result.error||'결제기관 승인 확인에 실패했습니다.');
 if(upgrade){
  title.textContent='원본 음원 옵션 결제가 확인됐어요.';
  detail.textContent='추가 10,000원 결제를 확인했습니다. 나의 노래함에서 원본 음원을 받을 수 있어요.';
  link.textContent='내 노래함에서 다운로드';link.hidden=false;
 }else{
  title.textContent='결제가 완료됐어요!';
  detail.textContent='실제 결제 승인 금액을 서버에서 확인했어요. 고객이 선택한 내용에 따라 곡 제작이 시작되며, 완성 후 이메일로 개인 감상 링크를 보내드려요.';
  back.hidden=false;
 }
}
void confirm().catch(error=>{
 title.textContent='결제 상태를 확인해야 해요.';
 detail.textContent=(error?.message||'승인 확인이 완료되지 않았어요.')+
  ' 결제금액이 실제 청구됐는지 토스페이먼츠 결제내역을 먼저 확인하세요. 중복 결제하지 마세요.';
 back.hidden=false;
});
})();