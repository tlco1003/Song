(()=>{
'use strict';
const qs=new URLSearchParams(location.hash.slice(1));
const token=qs.get('delivery');
const $=id=>document.getElementById(id);
const giftLink=location.origin+location.pathname+location.hash;
async function prepare(){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))throw Error('올바른 음악 선물 링크가 아니에요. 받은 이메일의 링크를 다시 열어 주세요.');
 const response=await fetch('/api/delivery/gift-preview',{
  method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok||result.status!=='ready')
  throw Error(result.error||'이 음악 선물은 아직 준비 중이거나 링크 유효기간이 지났어요.');
 const recipient=typeof result.recipient==='string'?result.recipient.trim().slice(0,55):'';
 $('gift-recipient').textContent=recipient?
  recipient+'에게 전하는 단 하나의 음악 편지':'당신을 위해 준비한 음악 편지';
 $('gift-open').disabled=false;$('gift-open').textContent='나에게 온 노래 열어보기';
 $('gift-share').disabled=false;
 $('gift-status').textContent='보내는 사람의 마음을 음악으로 담았어요. 무료로 공유할 수 있습니다.';
}
$('gift-open').addEventListener('click',()=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))return;
 location.href='my-music.html#delivery='+token;
});
$('gift-share').addEventListener('click',async()=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))return;
 try{
  if(navigator.share)await navigator.share({
   title:'WITHU · 당신에게 온 노래 선물',
   text:'마음을 담아 만든 특별한 노래를 함께 들어주세요.',
   url:giftLink
  });
  else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(giftLink);
  else throw Error('지원되지 않는 공유 기능');
  $('gift-status').textContent='무료 감상 링크를 공유했어요. 링크를 받은 사람도 이 주문의 노래를 들을 수 있어요.';
 }catch(error){
  if(error?.name!=='AbortError')$('gift-status').textContent='공유할 수 없어요. 브라우저에서 링크를 복사해 주세요.';
 }
});
void prepare().catch(error=>{
 $('gift-status').textContent=error.message||'준비 중인 선물이에요.';
 $('gift-open').textContent='감상 링크를 확인할 수 없어요.';
});
})();