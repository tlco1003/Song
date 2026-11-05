(()=>{
'use strict';
const $=id=>document.getElementById(id);
const STORY_KEY='withu-story-steps-v1';
const ORDER_KEY='withu-order-draft-v1';
const MAX_AGE=30*60*1000;
const STEP_COUNT=7;
const INPUTS=['recipient','memory','message','gratitudeApology','occasion','recipientAgeGroup','relativePosition','speechStyle','genre','mood','lyricLength','song-title','song-lyrics','song-style'];
const genres={
 '발라드':'Gentle piano ballad, warm strings, expressive Korean solo vocal.',
 '어쿠스틱':'Soft acoustic guitar, warm piano, intimate expressive storytelling.',
 '재즈':'Warm vocal jazz, mellow piano, upright bass and brushed drums.',
 '트로트':'Modern Korean trot with heartfelt melodic vocals, gentle rhythmic accompaniment.',
 'R&B':'Soulful Korean R&B, warm electric piano, soft bass and laid-back groove.',
 'K-POP':'Contemporary melodic Korean pop with an intimate verse and expansive chorus.',
 '인디팝':'Emotional indie pop with acoustic guitar, delicate keys and subtle drums.'
};
const moods={
 '따뜻한':'Tender and comforting.',
 '감동적인':'An emotional journey with a heartfelt final chorus.',
 '설레는':'Hopeful and gently uplifting.',
 '애절한':'Wistful and expressive.',
 '희망찬':'Hopeful with a luminous ending.',
 '신나는':'Bright rhythmic energy with a memorable hook.'
};
const names=['누구에게 전할까요?','소중한 추억','꼭 전할 말','고마움과 미안함','말투와 관계','장르와 분위기','가사 완성'];
let step=1;
let currentAutoStyle='';
function story(){
 return Object.fromEntries(['recipient','memory','message','gratitudeApology','occasion','recipientAgeGroup','relativePosition','speechStyle','genre','mood','lyricLength'].map(k=>[k,$(k).value]));
}
function style(){
 const v=story();
 return [genres[v.genre],moods[v.mood]||'Warm, heartfelt mood.',
  'Natural Korean pronunciation, nuanced dynamics, clear words, gently growing arrangement.',
  'Let the approved lyrics and natural sentence pauses guide musical phrasing.',
  'An intimate beginning, moving chorus and elegant ending.'].join(' ');
}
function updateStyle(force=false){
 const next=style();
 if(force||!$('song-style').value||$('song-style').value===currentAutoStyle)
   $('song-style').value=next;
 currentAutoStyle=next;
}
function validSnapshot(){
 try{
  const saved=JSON.parse(sessionStorage.getItem(STORY_KEY)||'null');
  return saved&&saved.version===1&&Number.isFinite(saved.savedAt)
    &&Date.now()-saved.savedAt>=0&&Date.now()-saved.savedAt<MAX_AGE?saved:null;
 }catch(_){return null}
}
function saveAnswers(){
 try{
  const answers=Object.fromEntries(INPUTS.map(id=>[id,$(id).value]));
  sessionStorage.setItem(STORY_KEY,JSON.stringify({version:1,savedAt:Date.now(),answers}));
 }catch(_){/* User can continue without session persistence until the final handoff. */}
}
function restoreAnswers(){
 const saved=validSnapshot();
 if(saved?.answers){
  for(const id of INPUTS){
   if(typeof saved.answers[id]==='string'&&$(id))
    $(id).value=saved.answers[id].slice(0,$(id).maxLength>0?$(id).maxLength:6000);
  }
 }
 currentAutoStyle=style();
 updateStyle(false);
}
function showError(message){
 $('step-error').textContent=message;
 $('step-error').hidden=!message;
}
function validStep(n){
 if(n===1&&!$('recipient').value.trim()){
  showError('받는 사람을 부르는 이름을 입력해 주세요.');
  $('recipient').focus();return false;
 }
 if(n===7&&!$('song-lyrics').value.trim()){
  showError('가사를 입력하거나 작성한 뒤 상품 선택으로 이동해 주세요.');
  $('song-lyrics').focus();return false;
 }
 return true;
}
function setStep(next,{push=false,focus=true}={}){
 step=Math.max(1,Math.min(STEP_COUNT,Number(next)||1));
 for(const panel of document.querySelectorAll('[data-create-step]')){
  panel.hidden=Number(panel.dataset.createStep)!==step;
 }
 $('create-prev').hidden=step===1;
 $('create-next').hidden=step===STEP_COUNT;
 $('go-create').hidden=step!==STEP_COUNT;
 $('create-progress-label').textContent=step+' / '+STEP_COUNT+' · '+names[step-1];
 $('create-progress').setAttribute('aria-valuenow',String(step));
 $('create-progress-fill').style.width=(step/STEP_COUNT*100)+'%';
 showError('');
 if(push){
  const url=new URL(window.location.href);
  // Sensitive stories must NEVER be put in query strings or history state.
  url.searchParams.set('step',String(step));
  history.pushState({step},'',url.pathname+url.search);
 }
 window.scrollTo({top:0,behavior:'instant'});
 if(focus)document.querySelector('[data-create-step="'+step+'"] h1, [data-create-step="'+step+'"] h2')?.focus?.({preventScroll:true});
}
$('create-next').addEventListener('click',()=>{
 if(!validStep(step))return;
 saveAnswers();setStep(step+1,{push:true});
});
$('create-prev').addEventListener('click',()=>{
 saveAnswers();setStep(step-1,{push:true});
});
window.addEventListener('popstate',()=>{
 const params=new URLSearchParams(location.search);
 const index=Number(params.get('step'))||1;
 setStep(index);
});
for(const id of INPUTS){
 $(id).addEventListener('input',()=>{
  if(id==='genre'||id==='mood')updateStyle();
  saveAnswers();
 });
 $(id).addEventListener('change',()=>{
  if(id==='genre'||id==='mood')updateStyle();
  saveAnswers();
 });
}
$('style-from-choices').addEventListener('click',()=>{
 updateStyle(true);saveAnswers();
 $('handoff-status').textContent='현재 장르와 분위기에 맞게 스타일을 업데이트했어요.';
});
restoreAnswers();
const initialStep=Number(new URLSearchParams(location.search).get('step'))||1;
setStep(initialStep,{focus:false});
$('story-form').addEventListener('submit',async event=>{
 event.preventDefault();
 if(step!==7){
  // Pressing Enter in a question must never jump straight to the final page.
  if(!validStep(step))return;
  saveAnswers();
  setStep(step+1,{push:true});
  return;
 }
 const v=story(),status=$('generation-status'),button=$('generate-lyrics');
 if(!v.recipient.trim()||(v.memory+v.message+v.gratitudeApology).trim().length<10){
  status.textContent='이름과 10자 이상의 추억 또는 전할 말을 작성해 주세요.';return;
 }
 button.disabled=true;status.textContent='가사를 준비하고 있어요…';
 try{
  const response=await fetch('api/lyrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});
  if(!response.ok){
   let detail={};try{detail=await response.json();}catch(_){}
   if(response.status===404||response.status===405)throw Error('lyrics-service-pending');
   throw Error(detail.error||'가사 작성 요청이 완료되지 않았어요.');
  }
  const result=await response.json();
  if(typeof result.lyrics!=='string'||result.lyrics.length<12)throw Error('유효한 가사를 받지 못했어요.');
  if($('song-lyrics').value.trim()&&!confirm('기존에 작성한 가사를 새 가사로 바꿀까요?'))return;
  $('song-lyrics').value=result.lyrics;
  if(!$('song-title').value.trim())$('song-title').value=v.recipient+'에게';
  updateStyle(false);saveAnswers();
  status.textContent='가사가 준비됐어요. 수정한 다음 상품을 선택해 주세요.';
 }catch(error){
  status.textContent=error.message==='lyrics-service-pending'?
   '현재 자동 가사 작성은 이용할 수 없어요. 가사를 직접 입력한 뒤 상품을 선택할 수 있습니다.':
   '가사 작성에 실패했어요: '+error.message;
 }finally{button.disabled=false;}
});
async function copyField(id,success){
 const value=$(id).value.trim();
 if(!value){$('handoff-status').textContent='먼저 내용을 작성해 주세요.';return;}
 try{
  if(!navigator.clipboard?.writeText)throw Error('not available');
  await navigator.clipboard.writeText(value);
  $('handoff-status').textContent=success;
 }catch(_){
  $(id).focus();$(id).select();
  $('handoff-status').textContent='텍스트가 선택됐어요. 복사 메뉴를 눌러 주세요.';
 }
}
$('copy-lyrics').addEventListener('click',()=>copyField('song-lyrics','가사를 복사했어요.'));
$('copy-style').addEventListener('click',()=>copyField('song-style','스타일을 복사했어요.'));
$('go-create').addEventListener('click',event=>{
 if(step!==7||!validStep(7)){event.preventDefault();return;}
 if(!$('song-style').value.trim())updateStyle(true);
 const lyrics=$('song-lyrics').value.trim();
 const title=$('song-title').value.trim()||'WITHU 노래 선물';
 // Returning from order review to edit lyrics must not erase a customer's
 // selected product or 1-/2-genre configuration.
 let previous=null;
 try{
  const stored=JSON.parse(sessionStorage.getItem(ORDER_KEY)||'null');
  if(stored?.version===1&&Number.isFinite(stored.savedAt)
    &&Date.now()-stored.savedAt>=0&&Date.now()-stored.savedAt<MAX_AGE
    &&stored.title&&stored.lyrics)
    previous=stored;
 }catch(_){/* No prior checkout selection. */}
 const selectedProduct=['audio','audio_duo','audio_video'].includes(previous?.selectedProduct)
  ?previous.selectedProduct:undefined;
 const savedGenreChoice=previous?.duoGenreChoice&&
  ['same','different'].includes(previous.duoGenreChoice.mode)&&
  typeof previous.duoGenreChoice.first==='string'&&
  typeof previous.duoGenreChoice.second==='string'
  ?previous.duoGenreChoice:undefined;
 const draft={
  version:1,title:title.slice(0,100),lyrics:lyrics.slice(0,5500),
  style:$('song-style').value.trim().slice(0,1200),
  styleOverrides:$('song-style').value.trim()===currentAutoStyle?'':$('song-style').value.trim().slice(0,500),
  genre:$('genre').value,mood:$('mood').value,
  ...(selectedProduct?{selectedProduct}:{}),
  ...(savedGenreChoice?{duoGenreChoice:savedGenreChoice}:{}),
  ...(previous?.genreSelection?{genreSelection:previous.genreSelection}:{}),
  ...(typeof previous?.sharedStyleNotes==='string'?{sharedStyleNotes:previous.sharedStyleNotes.slice(0,500)}:{}),
  // Privately retained in this tab for the order workflow, not a payment.
  story:story(),savedAt:Date.now()
 };
 try{
  sessionStorage.setItem(ORDER_KEY,JSON.stringify(draft));
  saveAnswers();
  $('handoff-status').textContent='상품 선택 화면으로 이동합니다.';
 }catch(_){
  event.preventDefault();
  $('handoff-status').textContent='임시 저장이 제한되어 이동할 수 없어요. Safari 일반 탭에서 다시 시도해 주세요.';
 }
});
})();