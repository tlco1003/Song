(()=>{
'use strict';
const $=id=>document.getElementById(id);
const KEY='withu-order-draft-v1';
const MAX_AGE=30*60*1000;
const won=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:0});
let prices=null,genres=null,draft=null,currentStage='product';
const titleOf={product:'상품·장르 선택',review:'주문 확인'};
const allowedProducts=['audio','audio_duo','audio_video'];
function getDraft(){
 try{
  const value=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(!value||value.version!==3||!Number.isFinite(value.savedAt)
    ||Date.now()-value.savedAt<0||Date.now()-value.savedAt>MAX_AGE
    ||typeof value.story?.recipient!=='string'||!value.story.recipient.trim()
    ||(String(value.story.memory||'')+String(value.story.message||'')+String(value.story.gratitudeApology||'')).trim().length<10
    ||typeof value.genre!=='string'||typeof value.mood!=='string')return null;
  return value;
 }catch(_){return null;}
}
function chosenProduct(){return document.querySelector('input[name="product"]:checked')?.value||'audio';}
function selectedPrice(){return prices?.products.find(p=>p.id===chosenProduct())||null;}
function priceText(product){return product?(won.format(product.amountKrw)+(product.priceKind==='starting_at'?'부터':'')):'가격 확인 중';}
function mixFee(){
 const fee=prices?.addOns?.genreBlend?.amountKrw;
 if(fee!==5000)return null;
 try{return genreSelection().mode==='blend'?fee:0;}
 catch(_){return 0;}
}
function totalText(){
 const product=selectedPrice(),fee=mixFee();
 if(!product||fee===null)return '가격 확인 중';
 return won.format(product.amountKrw+fee)+(product.priceKind==='starting_at'?'부터':'');
}
function showPrices(){
 for(const node of document.querySelectorAll('[data-price-for]')){
  node.textContent=priceText(prices?.products.find(p=>p.id===node.dataset.priceFor));
 }
 $('order-price').textContent=totalText();
 $('selection-total').textContent=totalText();
 $('selection-addon').textContent=mixFee()===5000?'장르 믹스 추가금 +5,000원 포함':'장르 믹스는 선택 시 +5,000원';
 $('order-pricing-notice').textContent=selectedPrice()?.quoteRequired?
  '뮤직비디오는 시작가입니다. 길이와 편집·수정 범위에 따라 개별 견적을 먼저 확정합니다.':
  (mixFee()===5000?'장르 믹스 +5,000원 포함 · ':'')+'맞춤 가사와 MP3 음원을 함께 제공해요.';
}
function error(message){
 $('checkout-message').textContent=message;
 $('checkout-message').hidden=!message;
}
function validGenre(g){return !!genres?.genres.some(x=>x.id===g);}
function genreSelection(){
 if(!genres)throw Error('음악 장르를 아직 불러오지 못했어요.');
 const first=$('song-genre-first').value;
 if(!validGenre(first))throw Error('첫 번째 장르를 선택해 주세요.');
 if(chosenProduct()!=='audio_duo'){
  if(!$('single-genre-blend').checked)return {mode:'single',genres:[first]};
  const second=$('song-genre-second').value;
  if(!validGenre(second)||first===second)throw Error('기본 장르와 다른 추가 장르를 선택해 주세요.');
  return {mode:'blend',genres:[first,second]};
 }
 const mode=document.querySelector('input[name="duoGenreMode"]:checked')?.value;
 if(mode==='same')return {mode:'same',genres:[first]};
 if(mode==='blend'){
  const second=$('song-genre-second').value;
  if(!validGenre(second)||first===second)throw Error('섞을 추가 장르를 선택해 주세요.');
  return {mode:'blend',genres:[first,second]};
 }
 const second=$('song-genre-second').value;
 if(mode!=='different'||!validGenre(second)||first===second)
  throw Error('두 장르로 각각 제작하려면 서로 다른 장르 2개를 선택해 주세요.');
 return {mode:'different',genres:[first,second]};
}
function genreLabels(s){
 if(s.mode==='single')return ['1곡 · '+s.genres[0]];
 if(s.mode==='blend'){
  const text=s.genres[0]+' + '+s.genres[1]+' (믹스)';
  return chosenProduct()==='audio_duo'?
   ['1곡 · '+text,'2곡 · '+text+' (다른 편곡)']:['1곡 · '+text];
 }
 if(s.mode==='same')return ['1곡 · '+s.genres[0],'2곡 · '+s.genres[0]+' (다른 멜로디·편곡)'];
 return ['1곡 · '+s.genres[0],'2곡 · '+s.genres[1]];
}
function saveChoices(){
 if(!draft)return false;
 let selected=null;
 try{selected=genreSelection();}
 catch(_){/* Invalid selection is not persisted as a valid production request. */}
 const next={...draft,selectedProduct:chosenProduct(),genreSelection:selected,
   sharedStyleNotes:'',
   singleGenreBlend:$('single-genre-blend').checked,
   duoGenreChoice:{
     mode:document.querySelector('input[name="duoGenreMode"]:checked')?.value||'same',
     first:$('song-genre-first').value,second:$('song-genre-second').value
   },
   savedAt:Date.now()
 };
 try{
  sessionStorage.setItem(KEY,JSON.stringify(next));
  draft=next;return true;
 }catch(_){error('현재 브라우저에서 주문 내용 임시 저장을 할 수 없어요.');return false;}
}
function renderGenres(){
 const duo=chosenProduct()==='audio_duo';
 $('video-inline-options').hidden=chosenProduct()!=='audio_video';
 const mode=document.querySelector('input[name="duoGenreMode"]:checked')?.value;
 const secondary=duo?['different','blend'].includes(mode):$('single-genre-blend').checked;
 $('duo-genre-modes').hidden=!duo;
 $('single-genre-blend-wrap').hidden=duo;
 $('song-genre-second-wrap').hidden=!secondary;
 $('song-genre-second').disabled=!secondary||!genres;
 $('song-genre-second-legend').textContent=duo&&mode==='different'?'두 번째 완성곡 장르':'함께 섞을 추가 장르';
 $('selected-primary-genre').textContent=validGenre(draft?.genre)?draft.genre:'기본 장르 확인 중';
 for(const [id,tilesId] of [['song-genre-first','song-genre-first-tiles'],['song-genre-second','song-genre-second-tiles']]){
  for(const radio of $(tilesId).querySelectorAll('input[type="radio"]'))
   radio.checked=radio.value===$(id).value;
 }
 try{
  const selection=genreSelection();
  $('genre-plan-preview').classList.remove('invalid');
  $('genre-plan-preview').textContent=genreLabels(selection).join('\n')+
   (selection.mode==='blend'?'\n두 장르를 한 곡 안에 섞어요. 추가금은 주문당 5,000원':'\n각 완성곡마다 별도로 제작됩니다.');
 }catch(e){
  $('genre-plan-preview').classList.add('invalid');
  $('genre-plan-preview').textContent=e.message;
 }
 saveChoices();showPrices();
}
function stages(){
 return ['product','review'];
}
const choiceLabels=Object.freeze({
 recipientAgeGroup:{unknown:'선택 안 함',under20:'10대 이하','20s':'20대','30s':'30대','40s':'40대','50s':'50대','60s':'60대','70plus':'70대 이상'},
 relativePosition:{unknown:'자연스럽게',older:'윗사람',peer:'친구·동등한 사이',younger:'아랫사람'},
 speechStyle:{auto:'사연에 맞게 자연스럽게',casual:'친근한 반말',polite:'따뜻한 존댓말',mixed:'반말과 존댓말을 함께'},
 eraPreference:{auto:'나이대에 맞게',none:'시대 상관없음',
  '1960s':'1960년대','1970s':'1970년대','1980s':'1980년대',
  '1990s':'1990년대','2000s':'2000년대','2010s':'2010년대','2020s':'2020년대'}
});
function summaryValue(field,value){
 return choiceLabels[field]?.[value]||String(value||'').trim()||'선택 안 함';
}
function updateReview(){
 draft=getDraft();
 const data=draft?.story||{};
 for(const field of ['recipient','occasion','memory','message','gratitudeApology',
  'recipientAgeGroup','relativePosition','speechStyle']){
  const id=field==='recipient'?'order-title':'order-'+field;
  $(id).textContent=summaryValue(field,data[field]);
 }
 $('order-mood-era').textContent=summaryValue('mood',draft?.mood)+' · '+
  summaryValue('eraPreference',draft?.eraPreference);
 $('order-product').textContent=selectedPrice()?.name||'상품 선택';
 $('order-style').textContent='';
 try{$('order-song-genres').textContent=genreLabels(genreSelection()).join('\n');}
 catch(e){$('order-song-genres').textContent=e.message;}
 showPrices();
}
function show(stage,{push=false,focus=false}={}){
 const active=stages();
 currentStage=active.includes(stage)?stage:active[0];
 const idx=active.indexOf(currentStage);
 for(const section of document.querySelectorAll('[data-checkout-step]')){
  section.hidden=section.dataset.checkoutStep!==currentStage;
 }
 $('checkout-prev').hidden=idx===0;
 $('checkout-next').hidden=idx===active.length-1;
 $('go-payment').hidden=idx!==active.length-1;
 $('checkout-progress-label').textContent=(idx+1)+' / '+active.length+' · '+titleOf[currentStage];
 $('checkout-progress').setAttribute('aria-valuemax',String(active.length));
 $('checkout-progress').setAttribute('aria-valuenow',String(idx+1));
 $('checkout-progress-fill').style.width=((idx+1)/active.length*100)+'%';
 if(currentStage==='review')updateReview();
 error('');
 if(push){
  const url=new URL(location.href);
  url.searchParams.set('stage',currentStage);
  // Stage names only in the URL; customer stories and genres stay private.
  history.pushState({stage:currentStage},'',url.pathname+url.search);
 }
 window.scrollTo({top:0,behavior:'auto'});
 if(focus||push){
  const heading=document.querySelector('[data-checkout-step="'+currentStage+'"] h2');
  if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
 }
 window.dispatchEvent(new CustomEvent('withu:checkout-stage',{detail:{stage:currentStage}}));
}
function canAdvance(){
 if(!draft){error('먼저 사연과 음악 취향을 입력해 주세요. 나만의 노래 6단계로 돌아가세요.');return false;}
 if(!prices){error('현재 가격을 불러올 수 없어요. 새로고침해 주세요.');return false;}
 // A direct ?stage=review link must never bypass genre validation.
 // Re-validate at every final handoff, including browser history navigation.
 if(currentStage==='product'||currentStage==='review'){
  try{genreSelection();}
  catch(e){error(e.message);return false;}
 }
 if(!saveChoices())return false;
 return true;
}
$('checkout-next').addEventListener('click',()=>{
 if(!canAdvance())return;
 const steps=stages();
 show(steps[steps.indexOf(currentStage)+1],{push:true});
});
$('checkout-prev').addEventListener('click',()=>{
 const steps=stages();
 const previous=steps[steps.indexOf(currentStage)-1];
 if(previous)show(previous,{push:true});
});
$('go-payment').addEventListener('click',async event=>{
 event.preventDefault();
 if(!canAdvance())return;
 const target=$('go-payment').href;
 // Static hosting does not expose an API. Proceed without a fake API call.
 if(location.hostname.endsWith('.github.io')){
  location.assign(target);
  return;
 }
 const payload={selectedProduct:chosenProduct(),genreSelection:genreSelection(),story:draft.story};
 $('go-payment').setAttribute('aria-busy','true');
 try{
  // A properly deployed private server prepares encrypted instructions.
  // Only an opaque draft ID is retained by the client, never prompts/lyrics.
  const response=await fetch('api/commerce/drafts',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload),credentials:'same-origin',signal:AbortSignal.timeout(1500)
  });
  if(response.ok){
   const result=await response.json();
   if(typeof result.draftId==='string'&&/^[a-f0-9-]{36}$/.test(result.draftId)){
    draft={...draft,serverDraftId:result.draftId,savedAt:Date.now()};
    sessionStorage.setItem(KEY,JSON.stringify(draft));
   }
  }
 }catch(_){
  // The payment page is informational; actual PG payment remains disabled.
 }finally{
  $('go-payment').removeAttribute('aria-busy');
  location.assign(target);
 }
});
for(const radio of document.querySelectorAll('input[name="product"]')){
 radio.addEventListener('change',()=>{
  for(const label of document.querySelectorAll('.gift-choice')){
   label.classList.toggle('active',label.querySelector('input')?.checked===true);
  }
  showPrices();renderGenres();
 });
}
for(const control of document.querySelectorAll('input[name="duoGenreMode"]'))
 control.addEventListener('change',renderGenres);
$('single-genre-blend').addEventListener('change',renderGenres);
for(const id of ['song-genre-first','song-genre-second'])
 $(id).addEventListener('change',renderGenres);

window.addEventListener('popstate',()=>{
 const stage=new URLSearchParams(location.search).get('stage');
 show(stage||'product',{focus:true});
});
async function loadPrices(){
 try{
  const response=await fetch('prices.json',{cache:'no-store'});
  if(!response.ok)throw Error('Prices unavailable');
  const result=await response.json();
  if(result.version!==1||result.currency!=='KRW'||result.addOns?.genreBlend?.amountKrw!==5000
    ||!Array.isArray(result.products)
    ||!['audio','audio_duo','audio_video'].every(id=>result.products.some(x=>x.id===id&&Number.isSafeInteger(x.amountKrw)&&x.amountKrw>0)))
    throw Error('Incomplete price list');
  prices=result;
 }catch(_){error('현재 가격 정보를 불러올 수 없어요. 잠시 후 다시 접속해 주세요.');}
 showPrices();
}
async function loadGenres(){
 try{
  const response=await fetch('music-genres.json',{cache:'no-store'});
  if(!response.ok)throw Error('Genres unavailable');
  const result=await response.json();
  if(result.version!==2||!Array.isArray(result.genres)||result.genres.length<2
    ||new Set(result.genres.map(x=>x.id)).size!==result.genres.length
    ||result.genres.some(x=>typeof x.id!=='string'||x.label!==x.id||Object.hasOwn(x,'style')||Object.hasOwn(x,'prompt')))
    throw Error('Invalid genres');
  genres=result;
  for(const [id,tilesId] of [['song-genre-first','song-genre-first-tiles'],['song-genre-second','song-genre-second-tiles']]){
   const select=$(id),tiles=$(tilesId);
   select.replaceChildren();tiles.replaceChildren();
   for(const item of result.genres){
    const option=document.createElement('option');
    option.value=item.id;option.textContent=item.label;select.append(option);
    const label=document.createElement('label');label.className='music-choice';
    const radio=document.createElement('input');
    radio.type='radio';radio.name=id+'-choice';radio.value=item.id;
    const display=document.createElement('span');display.textContent=item.label;
    label.append(radio,display);tiles.append(label);
    radio.addEventListener('change',()=>{
     if(!radio.checked)return;
     select.value=radio.value;
     select.dispatchEvent(new Event('change',{bubbles:true}));
    });
   }
   select.disabled=false;
  }
  const old=draft?.duoGenreChoice;
  const first=[draft?.genre,old?.first,result.genres[0].id].find(validGenre);
  $('song-genre-first').value=first;
  $('selected-primary-genre').textContent=first;
  $('song-genre-second').value=validGenre(old?.second)?old.second:
   result.genres.find(g=>g.id!==first).id;
  if(old?.mode==='different')$('duo-mode-different').checked=true;
  if(old?.mode==='blend')$('duo-mode-blend').checked=true;
  $('single-genre-blend').checked=draft?.genreSelection?.mode==='blend'||draft?.singleGenreBlend===true;
  $('song-shared-notes').value='';
  renderGenres();
 }catch(_){
  genres=null;$('genre-plan-preview').textContent='장르 목록을 불러오지 못했어요. 다시 접속해 주세요.';
 }
}
async function init(){
 draft=getDraft();
 const productParam=new URLSearchParams(location.search).get('product');
 const selected=allowedProducts.includes(productParam)?productParam:
   allowedProducts.includes(draft?.selectedProduct)?draft.selectedProduct:'audio';
 const radio=document.querySelector('input[name="product"][value="'+selected+'"]');
 if(radio)radio.checked=true;
 for(const label of document.querySelectorAll('.gift-choice')){
  label.classList.toggle('active',label.querySelector('input')?.checked===true);
 }
 await Promise.all([loadPrices(),loadGenres()]);
 // The old draft must not be silently promoted into a paid order.
 show(new URLSearchParams(location.search).get('stage')||'product');
 if(!draft)error('아직 작성된 사연이 없어요. 나만의 노래 6단계를 완료해 주세요.');
}
void init();
})();