(()=>{
'use strict';
const $=id=>document.getElementById(id);
const STORY_KEY='withu-story-steps-v1',ORDER_KEY='withu-order-draft-v1';
const MAX_AGE=30*60*1000,STEP_COUNT=7;
const INPUTS=['recipient','memory','message','gratitudeApology','occasion',
 'recipientAgeGroup','relativePosition','speechStyle','genre','mood','eraPreference','lyricLength'];
const STEPS=['누구에게 전할까요?','소중한 추억','꼭 전할 말','고마움과 미안함','말투와 관계','장르와 분위기','선택 내용 확인'];
const VALUES=Object.freeze({
 recipientAgeGroup:{unknown:'선택 안 함',under20:'10대 이하','20s':'20대','30s':'30대','40s':'40대','50s':'50대','60s':'60대','70plus':'70대 이상'},
 relativePosition:{unknown:'자연스럽게',older:'윗사람',peer:'친구·동등한 사이',younger:'아랫사람'},
 speechStyle:{auto:'사연에 맞게 자연스럽게',casual:'친근한 반말',polite:'따뜻한 존댓말',mixed:'반말과 존댓말을 함께'},
 eraPreference:{auto:'나이대에 맞게',none:'시대 상관없음','1960s':'1960년대','1970s':'1970년대','1980s':'1980년대','1990s':'1990년대','2000s':'2000년대','2010s':'2010년대','2020s':'2020년대'}
});
let step=1;
function story(){return Object.fromEntries(INPUTS.map(id=>[id,$(id).value]));}
function restore(){
 try{
  const saved=JSON.parse(sessionStorage.getItem(STORY_KEY)||'null');
  if(!saved||saved.version!==2||!Number.isFinite(saved.savedAt)
    ||Date.now()-saved.savedAt<0||Date.now()-saved.savedAt>MAX_AGE)return;
  for(const id of INPUTS){
   const value=saved.answers?.[id];
   if(typeof value!=='string')continue;
   const el=$(id),max=Number(el.maxLength);
   el.value=value.slice(0,max>0?max:6000);
  }
  for(const [name,id] of [['genreChoice','genre'],['moodChoice','mood'],['eraChoice','eraPreference']]){
   const radio=[...document.querySelectorAll('input[name="'+name+'"]')].find(e=>e.value===$(id).value);
   if(radio)radio.checked=true;
  }
 }catch(_){}
}
function save(){
 sessionStorage.setItem(STORY_KEY,JSON.stringify({version:2,savedAt:Date.now(),answers:story()}));
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
 if(n===7&&(story().memory+story().message+story().gratitudeApology).trim().length<10){
  error('가사 제작을 위해 추억이나 전할 말을 10자 이상 적어 주세요.');
  return false;
 }
 return true;
}
function renderSummary(){
 const answers=story();
 for(const field of ['recipient','occasion','memory','message','gratitudeApology',
  'recipientAgeGroup','relativePosition','speechStyle','genre','mood','eraPreference']){
  const label=VALUES[field]?.[answers[field]]||answers[field]?.trim()||'선택 안 함';
  $('review-'+field).textContent=label;
 }
}
function showStep(n,{push=false}={}){
 step=Math.max(1,Math.min(STEP_COUNT,Number(n)||1));
 for(const panel of document.querySelectorAll('[data-create-step]'))
  panel.hidden=Number(panel.dataset.createStep)!==step;
 $('create-prev').hidden=step===1;
 $('create-next').hidden=step===STEP_COUNT;
 $('go-create').hidden=step!==STEP_COUNT;
 $('create-progress-label').textContent=step+' / '+STEP_COUNT+' · '+STEPS[step-1];
 $('create-progress').setAttribute('aria-valuenow',String(step));
 $('create-progress-fill').style.width=(step/STEP_COUNT*100)+'%';
 error('');
 if(step===STEP_COUNT)renderSummary();
 if(push){
  const url=new URL(location.href);
  url.searchParams.set('step',String(step));
  history.pushState({step},'',url.pathname+url.search);
 }
 window.scrollTo({top:0,behavior:'auto'});
}
$('create-next').addEventListener('click',()=>{
 if(!validStep(step))return;
 try{save();showStep(step+1,{push:true});}
 catch(_){error('현재 브라우저에서 입력 내용을 저장할 수 없습니다. Safari 일반 탭으로 다시 이용해 주세요.');}
});
$('create-prev').addEventListener('click',()=>{
 try{save();}catch(_){}
 showStep(step-1,{push:true});
});
window.addEventListener('popstate',()=>showStep(Number(new URLSearchParams(location.search).get('step'))||1));
for(const id of INPUTS){
 const el=$(id);
 if(el.type==='hidden')continue;
 el.addEventListener('change',()=>{try{save();}catch(_){}});
 el.addEventListener('input',()=>{try{save();}catch(_){}});
}
for(const [radioName,id] of [['genreChoice','genre'],['moodChoice','mood'],['eraChoice','eraPreference']]){
 for(const radio of document.querySelectorAll('input[name="'+radioName+'"]')){
  radio.addEventListener('change',()=>{
   if(!radio.checked)return;
   $(id).value=radio.value;
   try{save();}catch(_){}
  });
 }
}
$('story-form').addEventListener('submit',event=>event.preventDefault());
$('go-create').addEventListener('click',event=>{
 if(step!==7||!validStep(1)||!validStep(6)||!validStep(7)){
  event.preventDefault();return;
 }
 const answers=story();
 // Browser holds only untrusted customer answers. Never place generated lyrics,
 // internal instructions, style recipes or payment authority into sessionStorage.
 const draft={
  version:3,
  titlePreview:answers.recipient.trim()+'에게',
  genre:answers.genre,mood:answers.mood,eraPreference:answers.eraPreference,
  recipientAgeGroup:answers.recipientAgeGroup,speechStyle:answers.speechStyle,
  story:answers,savedAt:Date.now()
 };
 try{
  sessionStorage.setItem(ORDER_KEY,JSON.stringify(draft));
  save();
 }catch(_){
  event.preventDefault();
  error('주문 선택값을 저장할 수 없습니다. Safari 일반 탭에서 다시 이용해 주세요.');
 }
});
restore();
showStep(Number(new URLSearchParams(location.search).get('step'))||1);
})();