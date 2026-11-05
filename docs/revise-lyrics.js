(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={orderId:null,revisionVersion:null,csrf:null,original:null};
function status(value){$('revision-status').textContent=value;}
async function load(){
 $('revision-editor').hidden=true;
 $('submit-revision').disabled=true;
 try{
  // An authenticated HttpOnly/SameSite cookie must be issued by the private
  // backend after verified customer email/order ownership checks.
  const r=await fetch('api/commerce/revisions/current',{
   method:'GET',credentials:'same-origin',headers:{Accept:'application/json'},
   cache:'no-store'
  });
  if(!r.ok){
   if([401,403].includes(r.status))throw Error('결제한 주문의 본인 인증이 필요해요. 전달된 주문 이메일을 확인해 주세요.');
   throw Error('현재 가사 수정 접수를 이용할 수 없어요. 결제 확인 후 안내되는 고객 전용 링크로 접속해 주세요.');
  }
  const data=await r.json();
  if(data?.editingAllowed!==true||typeof data.orderId!=='string'
   ||typeof data.lyrics!=='string'||!Number.isSafeInteger(data.revisionVersion)
   ||typeof data.csrfToken!=='string'||!data.csrfToken)
    throw Error('수정 가능한 주문을 확인하지 못했어요.');
  state.orderId=data.orderId;state.revisionVersion=data.revisionVersion;
  state.csrf=data.csrfToken;state.original=data.lyrics;
  $('revision-song-title').textContent=typeof data.title==='string'?data.title:'내 노래';
  $('revised-lyrics').value=data.lyrics;
  $('revision-editor').hidden=false;
  $('submit-revision').disabled=false;
  status('인증된 주문의 가사입니다. 내용을 수정한 뒤 요청을 보내세요.');
 }catch(e){status(e.message);}
}
$('submit-revision').addEventListener('click',async()=>{
 if(!state.orderId||!state.csrf)return;
 const lyrics=$('revised-lyrics').value.trim();
 if(lyrics.length<12||lyrics.length>5500){
  status('가사는 12자 이상 5,500자 이하로 입력해 주세요.');return;
 }
 if(lyrics===state.original.trim()){
  status('변경된 내용이 없어요.');return;
 }
 $('submit-revision').disabled=true;
 status('가사 수정 요청을 확인하는 중이에요.');
 try{
  const r=await fetch('api/commerce/revisions/current',{
   method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},
   body:JSON.stringify({orderId:state.orderId,expectedVersion:state.revisionVersion,lyrics})
  });
  if(!r.ok)throw Error('수정 요청을 접수하지 못했어요. 주문 인증과 제작 상태를 다시 확인해 주세요.');
  const data=await r.json();
  if(data?.status!=='revision_requested')throw Error('수정 요청 접수 상태를 확인할 수 없어요.');
  status('가사 수정 요청을 접수했어요. 제작 담당자의 확인 후 안내해 드립니다.');
  state.original=lyrics;
 }catch(e){status(e.message);}
 finally{$('submit-revision').disabled=false;}
});
void load();
})();