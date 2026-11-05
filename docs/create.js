(()=>{
'use strict';
const $=id=>document.getElementById(id);
const STORY_KEY='withu-story-steps-v1',ORDER_KEY='withu-order-draft-v1';
const MAX_AGE=30*60*1000,STEP_COUNT=7;
const INPUTS=['recipient','memory','message','gratitudeApology','occasion',
 'recipientAgeGroup','relativePosition','speechStyle','genre','mood','eraPreference','lyricLength'];
const STEPS=['누구에게 전할까요?','소중한 추억','꼭 전할 말','고마움과 미안함','말투와 관계','장르와 분위기','AI 가사 확인'];
let step=1,generatedLyrics='',generatedTitle='',generationRunning=false,generatedFor='';
function story(){
 return Object.fromEntries(INPUTS.map(id=>[id,$(id).value]));
}
function fingerprint(){
 // A session-only comparison detects input edits; no story data enters URLs.
 return JSON.stringify(story());
}
function restore(){
 try{
  const parsed=JSON.parse(sessionStorage.getItem(STORY_KEY)||'null');
  if(!parsed||parsed.version!==2||!Number.isFinite(parsed.savedAt)
    ||Date.now()-parsed.savedAt<0||Date.now()-parsed.savedAt>MAX_AGE)return;
  for(const id of INPUTS){
   if(typeof parsed.answers?.[id]==='string'){
    const el=$(id);
    if(el&&(el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.tagName==='INPUT')){
     const max=Number(el.maxLength)||6000;
     el.value=parsed.answers[id].slice(0,max>0?max:6000);
    }
   }
  }
  for(const [name,id] of [['genreChoice','genre'],['moodChoice','mood'],['eraChoice','eraPreference']]){
   const radio=[...document.querySelectorAll('input[name="'+name+'"]')].find(e=>e.value===$(id).value);
   if(radio)radio.checked=true;
  }
  // Never restore previously paid or unverified lyrics from browser storage.
 }catch(_){}
}
function save(){
 try{
  sessionStorage.setItem(STORY_KEY,JSON.stringify({
   version:2,savedAt:Date.now(),answers:story()
  }));
 }catch(_){}
}
function error(message){
 $('step-error').textContent=message;
 $('step-error').hidden=!message;
}
function validStep(n){
 if(n===1&&!$('recipient').value.trim()){
  error('받는 사람의 이름이나 호칭을 입력해 주세요.');
  $('recipient').focus();return false;
 }
 if(n===6&&(!$('genre').value||!$('mood').value)){
  error('음악 장르와 분위기를 선택해 주세요.');return false;
 }
 if(n===7&&!generatedLyrics){
  error('AI 가사가 완성된 뒤에 상품을 선택할 수 있어요.');return false;
 }
 return true;
}
function markUnavailable(message){
 $('generation-status').textContent=message;
 $('generate-lyrics').hidden=false;
 $('generate-lyrics').disabled=false;
 $('generate-lyrics').textContent='가사 생성 다시 시도';
 $('song-lyrics-preview').textContent='가사를 불러올 수 없어요.';
 $('go-create').hidden=true;
 $('go-create').setAttribute('aria-disabled','true');
}
async function generateLyrics(){
 if(generationRunning||generatedFor===fingerprint()&&generatedLyrics)return;
 const v=story();
 if(!v.recipient.trim()||(v.memory+v.message+v.gratitudeApology).trim().length<10){
  markUnavailable('AI가 가사를 만들 수 있도록 추억이나 전할 말을 10자 이상 입력해 주세요.');
  return;
 }
 generationRunning=true;error('');
 const requestFingerprint=fingerprint();
 $('generate-lyrics').hidden=true;
 $('generation-status').textContent='AI가 당신의 이야기를 가사로 만드는 중이에요…';
 $('song-lyrics-preview').textContent='특별한 이야기를 담고 있어요.';
 $('go-create').hidden=true;
 try{
  // Only story and choice IDs travel to the server; music prompts are
  // NEVER sent from, stored in, or displayed by the browser.
  const response=await fetch('api/lyrics',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(v),credentials:'same-origin'
  });
  if(!response.ok){
   let data={};try{data=await response.json();}catch(_){}
   if([401,403,404,405,503].includes(response.status))
    throw Error('AI 작사 서버 연결이 필요합니다. 현재는 가사를 만들 수 없어요.');
   throw Error(typeof data.error==='string'?data.error:'AI 가사를 불러오지 못했어요.');
  }
  const payload=await response.json();
  if(typeof payload.lyrics!=='string'||payload.lyrics.trim().length<12
    ||payload.lyrics.length>5500)throw Error('AI가 유효한 가사를 반환하지 않았어요.');
  if(requestFingerprint!==fingerprint()){
   throw Error('입력한 내용이 바뀌었어요. 현재 선택사항으로 다시 작성해 주세요.');
  }
  generatedLyrics=payload.lyrics.trim();
  generatedTitle=typeof payload.title==='string'&&payload.title.trim()
   ?payload.title.trim().slice(0,100):v.recipient+'에게';
  generatedFor=requestFingerprint;
  $('generated-song-title').textContent=generatedTitle;
  $('song-lyrics-preview').textContent=generatedLyrics;
  $('generation-status').textContent='가사가 완성됐어요. 상품을 선택할 수 있어요.';
  $('generate-lyrics').hidden=true;
  $('go-create').hidden=false;
  $('go-create').setAttribute('aria-disabled','false');
 }catch(e){
  generatedLyrics='';generatedFor='';
  markUnavailable(e.message);
 }finally{generationRunning=false;}
}
function showStep(n,{push=false}={}){
 step=Math.max(1,Math.min(STEP_COUNT,Number(n)||1));
 for(const panel of document.querySelectorAll('[data-create-step]')){
  panel.hidden=Number(panel.dataset.createStep)!==step;
 }
 $('create-prev').hidden=step===1;
 $('create-next').hidden=step===STEP_COUNT;
 $('go-create').hidden=step!==STEP_COUNT||!generatedLyrics;
 $('create-progress-label').textContent=step+' / '+STEP_COUNT+' · '+STEPS[step-1];
 $('create-progress').setAttribute('aria-valuenow',String(step));
 $('create-progress-fill').style.width=(step/STEP_COUNT*100)+'%';
 error('');
 if(push){
  const url=new URL(window.location.href);
  url.searchParams.set('step',String(step));
  history.pushState({step},'',url.pathname+url.search);
 }
 window.scrollTo({top:0,behavior:'instant'});
 if(step===STEP_COUNT&&!generatedLyrics)void generateLyrics();
}
$('create-next').addEventListener('click',()=>{
 if(!validStep(step))return;
 save();showStep(step+1,{push:true});
});
$('create-prev').addEventListener('click',()=>{
 save();showStep(step-1,{push:true});
});
window.addEventListener('popstate',()=>{
 showStep(Number(new URLSearchParams(location.search).get('step'))||1);
});
for(const id of INPUTS){
 const el=$(id);
 if(el.type==='hidden')continue;
 el.addEventListener('input',()=>{
  // Changing story details invalidates the previous AI result.
  generatedLyrics='';generatedFor='';save();
 });
 el.addEventListener('change',()=>{
  generatedLyrics='';generatedFor='';save();
 });
}
for(const [radioName,id] of [['genreChoice','genre'],['moodChoice','mood'],['eraChoice','eraPreference']]){
 for(const radio of document.querySelectorAll('input[name="'+radioName+'"]')){
  radio.addEventListener('change',()=>{
   if(!radio.checked)return;
   $(id).value=radio.value;
   generatedLyrics='';generatedFor='';save();
  });
 }
}
$('story-form').addEventListener('submit',event=>{
 event.preventDefault();
 if(step===7)void generateLyrics();
});
$('go-create').addEventListener('click',event=>{
 if(step!==7||!validStep(7)||generationRunning||generatedFor!==fingerprint()){
  event.preventDefault();error('AI 가사를 다시 확인해 주세요.');return;
 }
 // The draft is a PRESENTATION SNAPSHOT, never a trusted payment or server
 // style instruction. Production backend must bind the generated lyrics to an
 // authenticated, durable server-owned draft before charging anyone.
 const v=story();
 const draft={
  version:2,title:generatedTitle,lyrics:generatedLyrics,
  genre:v.genre,mood:v.mood,eraPreference:v.eraPreference,
  recipientAgeGroup:v.recipientAgeGroup,speechStyle:v.speechStyle,
  story:v,savedAt:Date.now()
 };
 try{
  sessionStorage.setItem(ORDER_KEY,JSON.stringify(draft));
  save();
 }catch(_){
  event.preventDefault();
  error('이 브라우저에서 주문 정보를 보관할 수 없어요. Safari 일반 탭에서 다시 이용해 주세요.');
 }
});
restore();
const initialStep=Number(new URLSearchParams(location.search).get('step'))||1;
showStep(initialStep);
})();