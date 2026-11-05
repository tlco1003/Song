(()=>{
'use strict';
const $=id=>document.getElementById(id);
const query=new URLSearchParams(window.location.search);
const orderId=query.get('order');
let authorized=null;
function say(message){$('revision-status').textContent=message;}
function validateInput(){
 if(!authorized)return false;
 const text=$('revision-lyrics').value.trim();
 const can=text.length>=12&&text.length<=5500&&text!==authorized.lyrics;
 $('request-revision').disabled=!can;
 return can;
}
async function load(){
 $('revision-editor').hidden=true;
 $('request-revision').disabled=true;
 if(!orderId||!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)){
  say('결제 확인된 고객 전용 링크로 들어와 주세요.');
  return;
 }
 try{
  // A same-origin authenticated HttpOnly session cookie must identify this
  // customer. No browser order data, token in URL, or paid=true is accepted.
  const response=await fetch('api/customer/lyrics-revision?orderId='+encodeURIComponent(orderId),{
   method:'GET',credentials:'same-origin',cache:'no-store'
  });
  if(!response.ok)throw Error('auth');
  const data=await response.json();
  if(data?.editingAllowed!==true||data.orderId!==orderId
    ||typeof data.lyrics!=='string'||!Number.isSafeInteger(data.revisionVersion)
    ||typeof data.csrfToken!=='string'||data.csrfToken.length<12)
    throw Error('auth');
  authorized=data;
  $('revision-title').textContent=data.title||'내 노래 가사';
  $('revision-lyrics').value=data.lyrics;
  $('revision-editor').hidden=false;
  say('결제와 본인 인증이 확인됐어요. 수정할 부분을 바꾼 뒤 검토를 요청하세요.');
  validateInput();
 }catch(_){
  authorized=null;
  say('가사 수정 권한을 확인할 수 없습니다. 결제 완료 후 전송되는 고객 전용 링크로 접속해 주세요.');
 }
}
$('revision-lyrics').addEventListener('input',validateInput);
$('request-revision').addEventListener('click',async()=>{
 if(!validateInput())return;
 $('request-revision').disabled=true;
 say('수정 요청을 확인하고 있어요…');
 try{
  const response=await fetch('api/customer/lyrics-revision',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json','X-CSRF-Token':authorized.csrfToken},
   body:JSON.stringify({
    orderId:authorized.orderId,
    expectedVersion:authorized.revisionVersion,
    lyrics:$('revision-lyrics').value.trim()
   })
  });
  if(!response.ok)throw Error('failed');
  const data=await response.json();
  if(data?.status!=='revision_requested')throw Error('failed');
  $('revision-editor').hidden=true;
  say('가사 수정 검토 요청이 접수됐어요. 처리 결과는 주문 안내를 통해 확인해 주세요.');
 }catch(_){
  say('수정 요청을 완료하지 못했어요. 결제 상태와 수정 가능 횟수를 확인한 후 다시 시도해 주세요.');
  validateInput();
 }
});
void load();
})();