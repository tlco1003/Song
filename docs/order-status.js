(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const token=new URLSearchParams(location.hash.slice(1)).get('status');let busy=false;
 async function load(){
  if(busy)return;
  if(!/^[A-Za-z0-9_-]{43}$/.test(token||'')){
   $('order-phase').textContent='이메일의 주문 확인 링크가 필요해요.';return;
  }
  busy=true;$('order-refresh').disabled=true;$('order-error').textContent='';
  try{
   const r=await fetch('/api/order-status/resolve',{method:'POST',
    credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token})});
   const v=await r.json().catch(()=>({}));
   if(!r.ok||!['delivered','in_production'].includes(v.status))
    throw Error(v.error||'주문 상태 확인에 실패했어요.');
   $('order-product').textContent=v.productLabel||'WITHU 맞춤 노래';
   $('order-phase').textContent=v.phase||'제작 중';
   for(const step of ['payment','lyrics','music','delivery']){
    const state=v.steps?.[step];
    $('order-stage-'+step).dataset.state=['completed','pending','in_progress'].includes(state)?state:'pending';
   }
   $('order-listen').hidden=true;
   if(v.status==='delivered'&&typeof v.listeningUrl==='string'){
    const url=new URL(v.listeningUrl,location.origin);
    if(url.origin!==location.origin||url.pathname!=='/my-music.html'
      ||!/^#delivery=[A-Za-z0-9_-]{43}$/.test(url.hash))throw Error('감상 링크를 검증하지 못했어요.');
    $('order-listen').href=url.href;$('order-listen').hidden=false;
   }
  }catch(e){$('order-error').textContent=e.message||'주문을 확인할 수 없어요.';}
  finally{busy=false;$('order-refresh').disabled=false;}
 }
 $('order-refresh').addEventListener('click',()=>{void load()});
 void load();
})();