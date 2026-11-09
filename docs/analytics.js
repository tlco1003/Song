/* Anonymous aggregated funnel: no cookies, IDs, emails, lyrics or stories. */
(()=>{
 'use strict';
 const page=location.pathname.split('/').pop()||'index.html';
 const values=Object.freeze({'index.html':'home_view','create.html':'story_started',
  'checkout.html':'packages_view','payment.html':'checkout_opened'});
 const observed=new Set();
 function send(event){
  if(observed.has(event))return;
  observed.add(event);
  const body=JSON.stringify({event});
  void fetch('/api/analytics/event',{method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
 }
 if(page==='index.html'||page==='checkout.html'||page==='payment.html')send(values[page]);
 if(page==='create.html'){
  const form=document.getElementById('story-form');
  if(form)form.addEventListener('input',()=>send('story_started'),{once:true});
  window.addEventListener('withu:story-submitted',()=>send('story_submitted'));
 }
 if(page==='checkout.html'){
  document.addEventListener('change',event=>{
   if(event.target?.matches?.('input[name="product"]'))send('package_selected');
  });
 }
 if(page==='payment.html'){
  const button=document.getElementById('confirm-checkout');
  if(button)button.addEventListener('click',()=>{if(!button.disabled)send('payment_attempted')});
 }
})();