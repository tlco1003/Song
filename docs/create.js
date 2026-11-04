(()=>{
'use strict';
const $=id=>document.getElementById(id);
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
function updateStyle(){ $('song-style').value=style();$('handoff-status').textContent='음악 분위기를 준비했어요. 자유롭게 수정할 수 있습니다.';}
$('genre').addEventListener('change',updateStyle);
$('mood').addEventListener('change',updateStyle);
$('style-from-choices').addEventListener('click',updateStyle);
updateStyle();
$('story-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const v=story(),status=$('generation-status'),button=$('generate-lyrics');
 if(!v.recipient.trim()||(v.memory+v.message+v.gratitudeApology).trim().length<10){
   status.textContent='부르는 이름과 10자 이상의 추억이나 전할 말을 적어 주세요.';return;
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
   updateStyle();
   status.textContent='가사가 준비됐어요. 직접 수정한 다음 음악으로 완성해 보세요.';
   $('song-lyrics').scrollIntoView({behavior:'smooth',block:'center'});
 }catch(error){
   status.textContent=error.message==='lyrics-service-pending'?
     '온라인 작사 서비스 연결을 준비 중이에요. 오른쪽에 직접 가사를 적으면 음악 제작 화면으로 이동할 수 있어요.':
     '가사 작성에 실패했어요: '+error.message;
 }finally{button.disabled=false;}
});
async function copyField(id,success){
 const value=$(id).value.trim();
 if(!value){$('handoff-status').textContent='먼저 '+(id==='song-lyrics'?'가사':'음악 스타일')+'를 작성해 주세요.';return;}
 try{
   if(!navigator.clipboard?.writeText)throw Error('not available');
   await navigator.clipboard.writeText(value);
   $('handoff-status').textContent=success;
 }catch(_){
   $(id).focus();$(id).select();
   $('handoff-status').textContent='텍스트를 선택했어요. 휴대폰 복사 메뉴를 눌러 복사해 주세요.';
 }
}
$('copy-lyrics').addEventListener('click',()=>copyField('song-lyrics','가사를 복사했어요. 음악 제작 화면의 Lyrics에 붙여넣어 주세요.'));
$('copy-style').addEventListener('click',()=>copyField('song-style','음악 스타일을 복사했어요. 음악 제작 화면의 Style에 붙여넣어 주세요.'));
$('go-create').addEventListener('click',()=>{
 if(!$('song-lyrics').value.trim()){$('handoff-status').textContent='가사를 먼저 입력해 주세요.';return;}
 if(!$('song-style').value.trim())updateStyle();
 $('handoff-status').textContent='새 탭에서 음악 제작 화면을 엽니다. Custom 모드에서 복사한 가사와 스타일을 붙여넣어 주세요.';
 window.open('https://suno.com/create','_blank','noopener,noreferrer');
});
})();