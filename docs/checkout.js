(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY='withu-order-draft-v1';
const draftMaxAge=30*60*1000;
let draft=null;
let priceCatalog=null;
let genreCatalog=null;
const genreChoiceState={duoMode:'same',first:'',second:'',sharedNotes:''};
const won=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:0});
function chosenProduct(){return document.querySelector('input[name="product"]:checked')?.value||'audio';}
function selectedPrice(){return priceCatalog?.products.find(p=>p.id===chosenProduct())||null;}
function priceText(product){return product?(won.format(product.amountKrw)+(product.priceKind==='starting_at'?'부터':'')):'가격 확인 중';}
function showProductPrice(){
 for(const node of document.querySelectorAll('[data-price-for]')){
  const p=priceCatalog?.products.find(product=>product.id===node.dataset.priceFor);
  node.textContent=priceText(p);
 }
 const current=selectedPrice();
 $('order-price').textContent=priceText(current);
 $('order-pricing-notice').textContent=current?.quoteRequired===true?
  '뮤직비디오는 시작 가격입니다. 영상 길이·구성·수정 범위를 협의한 최종 견적이 별도로 필요하며 지금은 결제되지 않습니다.':
  '결제창 시안의 판매 예정 가격입니다. PG 연동·정식 계약 전에는 결제가 진행되지 않습니다.';
}
async function loadPrices(){
 try{
  const result=await fetch('prices.json',{cache:'no-store'});
  if(!result.ok)throw Error('price catalog unavailable');
  const catalog=await result.json();
  if(catalog.currency!=='KRW'||catalog.version!==1||!Array.isArray(catalog.products))throw Error('Invalid catalog');
  const ids=['audio','audio_duo','audio_video'];
  if(catalog.products.length!==ids.length||!ids.every(id=>catalog.products.some(p=>p.id===id&&Number.isSafeInteger(p.amountKrw)&&p.amountKrw>0)))throw Error('Incomplete catalog');
  if(!catalog.products.some(p=>p.id==='audio_video'&&p.quoteRequired===true&&p.priceKind==='starting_at'))throw Error('Video quote required');
  priceCatalog=catalog;
 }catch(_){
  priceCatalog=null;
  $('checkout-message').textContent='가격표를 불러오지 못했어요. 새로고침해 주세요. 실제 결제는 진행되지 않습니다.';
 }
 showProductPrice();
}


function isAllowedGenre(value){
 return !!genreCatalog?.genres.some(entry=>entry.id===value);
}
function chooseAlternateGenre(first){
 return genreCatalog?.genres.find(entry=>entry.id!==first)?.id||'';
}
function getGenreSelection(){
 if(!genreCatalog)throw new Error('장르 목록을 불러오지 못했어요.');
 const first=$('song-genre-first').value;
 if(!isAllowedGenre(first))throw new Error('첫 번째 장르를 선택해 주세요.');
 if(chosenProduct()!=='audio_duo')return {mode:'single',genres:[first]};
 const mode=document.querySelector('input[name="duoGenreMode"]:checked')?.value;
 if(mode==='same')return {mode:'same',genres:[first]};
 if(mode!=='different')throw new Error('2곡 제작 방식을 선택해 주세요.');
 const second=$('song-genre-second').value;
 if(!isAllowedGenre(second))throw new Error('두 번째 장르를 선택해 주세요.');
 if(first===second)throw new Error('다른 장르로 각각 1곡을 받으려면 두 장르가 달라야 해요. 같은 장르 두 곡은 「한 장르로 2곡」을 선택해 주세요.');
 return {mode:'different',genres:[first,second]};
}
function genreLabels(selection){
 if(selection.mode==='single')return ['1곡 · '+selection.genres[0]];
 if(selection.mode==='same')return ['1곡 · '+selection.genres[0],'2곡 · '+selection.genres[0]+' (다른 멜로디·편곡)'];
 return ['1곡 · '+selection.genres[0],'2곡 · '+selection.genres[1]];
}
function saveGenreChoice(){
 const original=getDraft();
 if(!original)return;
 try{
  const genreSelection=getGenreSelection();
  const updated={...original,genreSelection,sharedStyleNotes:$('song-shared-notes').value.trim().slice(0,500),
   duoGenreChoice:{mode:document.querySelector('input[name="duoGenreMode"]:checked')?.value||'same',
     first:$('song-genre-first').value,second:$('song-genre-second').value}};
  // This session-only draft is NOT an order or a payment request.
  sessionStorage.setItem(KEY,JSON.stringify(updated));
  draft=updated;
 }catch(_){
  // A stale selection must never be treated as a validated, purchasable order.
  try{
   const invalid={...original,genreSelection:null};
   sessionStorage.setItem(KEY,JSON.stringify(invalid));
   draft=invalid;
  }catch(_storage){}
 }
}
function renderGenrePlan(){
 const isDuo=chosenProduct()==='audio_duo';
 const mode=document.querySelector('input[name="duoGenreMode"]:checked')?.value||'same';
 $('duo-genre-modes').hidden=!isDuo;
 const distinct=isDuo&&mode==='different';
 $('song-genre-second-wrap').hidden=!distinct;
 $('song-genre-second').disabled=!distinct||!genreCatalog;
 if(!genreCatalog){
  $('genre-plan-preview').textContent='장르 목록을 불러오는 중이에요.';
  $('order-song-genres').textContent='장르 선택을 준비 중이에요.';
  return;
 }
 try{
  const selection=getGenreSelection(),lines=genreLabels(selection);
  $('genre-plan-preview').classList.remove('invalid');
  $('genre-plan-preview').textContent=lines.join('\\n')+'\\n같은 최종 가사를 바탕으로 각각 독립적으로 제작합니다.';
  $('order-song-genres').textContent=lines.join('\\n');
 }catch(error){
  $('genre-plan-preview').classList.add('invalid');
  $('genre-plan-preview').textContent=error.message;
  $('order-song-genres').textContent='장르 선택을 확인해 주세요.';
 }
 saveGenreChoice();
}
async function loadGenreChoices(){
 try{
  const r=await fetch('music-genres.json',{cache:'no-store'});
  if(!r.ok)throw Error('Unable to load music genres');
  const catalog=await r.json();
  if(catalog.version!==1||!Array.isArray(catalog.genres)||catalog.genres.length<2
    ||new Set(catalog.genres.map(g=>g.id)).size!==catalog.genres.length
    ||catalog.genres.some(g=>typeof g.id!=='string'||!g.id||typeof g.style!=='string'))
    throw Error('Invalid music genres');
  genreCatalog=catalog;
  const saved=getDraft();
  const previous=saved?.duoGenreChoice;
  for(const id of ['song-genre-first','song-genre-second']){
   const select=$(id);
   select.replaceChildren();
   for(const genre of catalog.genres){
    const option=document.createElement('option');
    option.value=genre.id;option.textContent=genre.id;select.append(option);
   }
   select.disabled=false;
  }
  const initial=previous&&isAllowedGenre(previous.first)?previous.first:
    isAllowedGenre(saved?.genre)?saved.genre:catalog.genres[0].id;
  $('song-genre-first').value=initial;
  const second=previous&&isAllowedGenre(previous.second)?previous.second:chooseAlternateGenre(initial);
  $('song-genre-second').value=second;
  $('song-shared-notes').value=typeof saved?.sharedStyleNotes==='string'?
    saved.sharedStyleNotes.slice(0,500):'';
  const mode=previous?.mode==='different'?'different':'same';
  document.querySelector('input[name="duoGenreMode"][value="'+mode+'"]').checked=true;
  renderGenrePlan();
 }catch(_){
  genreCatalog=null;
  $('genre-plan-preview').textContent='장르 목록을 불러오지 못했어요. 새로고침해 주세요.';
  $('order-song-genres').textContent='장르 선택을 불러올 수 없습니다.';
 }
}

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
 $('demo-product').textContent=product==='audio_video'?'노래 + 뮤직비디오 (사전 견적 필요)':product==='audio_duo'?'맞춤 노래 2곡 (같은 가사, 서로 다른 스타일)':'맞춤 노래 1곡 (MP3 + 가사)';
 $('demo-order').textContent=order?.title||'가사 작성 후 확정';
 $('demo-payment-method').textContent=method.title;
 $('demo-amount').textContent=priceCatalog?priceText(selectedPrice())+' · 청구 불가':'가격 확인 중 · 청구 불가';
 $('demo-method-detail').textContent=method.help;
 try{$('demo-genre-plan').textContent=genreLabels(getGenreSelection()).join(' · ');}
 catch(error){$('demo-genre-plan').textContent=error.message;}
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
 let selection;
 try{selection=getGenreSelection();}
 catch(error){$('checkout-message').textContent=error.message;return;}
 saveGenreChoice();
 const option=chosenProduct();
 const label=option==='audio_video'?'노래와 뮤직비디오':option==='audio_duo'?'노래 2곡':'노래 1곡';
 $('checkout-message').textContent=label+' 주문 내용을 확인했어요. 결제·자동 제작 연결이 완료되면 여기에서 실제 주문할 수 있어요.';
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
  showProductPrice();
  renderGenrePlan();
  $('checkout-message').textContent='상품을 선택했어요. 실제 결제는 아직 시작되지 않습니다.';
 });
}
for(const input of document.querySelectorAll('input[name="duoGenreMode"]')){
 input.addEventListener('change',renderGenrePlan);
}
for(const id of ['song-genre-first','song-genre-second']){
 $(id).addEventListener('change',renderGenrePlan);
}
$('song-shared-notes').addEventListener('input',saveGenreChoice);
$('inspect-order').addEventListener('click',checkOrder);
show();
showProductPrice();
void loadPrices();
void loadGenreChoices();
void readiness();
})();