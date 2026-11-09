/* Public landing prices. This is display-only; server alone verifies payments. */
(()=>{
'use strict';
const nodes=document.querySelectorAll('[data-home-price]');
const status=document.getElementById('home-commerce-status');
const comparison=document.getElementById('home-duo-comparison');
const won=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:0});
function display(p){
 if(!p||!Number.isSafeInteger(p.amountKrw)||p.amountKrw<=0)return '상품 선택에서 가격 확인';
 return won.format(p.amountKrw)+(p.priceKind==='starting_at'?'부터':'');
}
async function load(){
 try{
  const res=await fetch('prices.json',{cache:'no-store'});
  if(!res.ok)throw Error('catalog');
  const data=await res.json();
  const byId=new Map((Array.isArray(data.products)?data.products:[]).map(p=>[p.id,p]));
  for(const node of nodes)node.textContent=display(byId.get(node.dataset.homePrice));
  const single=byId.get('audio')?.amountKrw,duo=byId.get('audio_duo')?.amountKrw;
  if(Number.isSafeInteger(single)&&Number.isSafeInteger(duo)&&single>0&&duo>0){
   const separate=single*2;
   comparison.textContent=separate>duo?
    '현재 1곡 상품을 두 번 구매하는 '+won.format(separate)+
    '과 비교해 '+won.format(separate-duo)+' 차이가 있어요.':
    '곡 수와 추가 옵션에 맞는 구성을 선택하세요.';
  }else comparison.textContent='실제 상품 구성과 가격은 선택 화면에서 확인하세요.';
  status.textContent=data.pricingStatus==='commercial_ready'
   ?'실제 결제 가능 여부와 최종 금액은 결제 화면에서 서버가 확인합니다.'
   :'현재 제작·주문 시스템 준비 단계입니다. 실제 결제·이메일 전달은 정식 운영 환경에서 제공됩니다.';
 }catch(_){
  for(const node of nodes)node.textContent='상품 화면에서 확인';
  comparison.textContent='상품 가격을 확인할 수 없어요.';
  status.textContent='가격 정보를 불러오지 못했어요. 상품 구성 화면에서 다시 확인해 주세요.';
 }
}
void load();
})();