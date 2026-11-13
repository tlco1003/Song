(() => {
 'use strict';
 const form=document.getElementById('video-ad-form');
 const button=document.getElementById('video-ad-submit');
 const message=document.getElementById('video-ad-message');
 let ready=false,sending=false;
 function info(text){message.textContent=text;}
 async function checkReadiness(){
  try{
   const result=await fetch('/api/video-ads/readiness',{cache:'no-store',credentials:'same-origin'});
   if(!result.ok)throw Error('운영 API에 접근할 수 없습니다.');
   const data=await result.json();
   ready=data.canSubmit===true&&data.status==='accepting_inquiries';
  }catch(_){ready=false;}
  button.disabled=!ready;
  button.textContent=ready?'영상 상담 신청하기':'상담 접수 준비 중';
  info(ready?'제작 가능성을 검토하는 상담 신청입니다. 아직 결제되지 않습니다.':
   '현재 온라인 상담 저장 기능은 비활성화되어 있습니다. 개인정보 운영 승인 및 Firebase 배포가 완료된 후 접수가 가능합니다.');
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!ready||sending)return;
  if(!form.reportValidity())return;
  const get=id=>document.getElementById(id).value;
  const body={
   brand:get('brand'),email:get('email'),product:get('product'),
   productUrl:get('productUrl'),category:get('category'),format:get('format'),
   budget:get('budget'),brief:get('brief'),
   rightsConfirmed:document.getElementById('rightsConfirmed').checked,
   privacyAccepted:document.getElementById('privacyAccepted').checked,
   replyAccepted:document.getElementById('replyAccepted').checked,
   honeypot:get('website-contact'),policyVersion:'video-ads-pilot-v1'
  };
  button.disabled=true;sending=true;info('서버에 상담 신청을 등록하고 있습니다.');
  try{
   const response=await fetch('/api/video-ads/inquiries',{
    method:'POST',cache:'no-store',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok||result.status!=='received'||!result.inquiryId)
    throw Error(result.error||'상담 신청을 등록하지 못했습니다.');
   form.reset();
   info('상담 신청이 접수되었습니다. 접수번호: '+result.inquiryId+
    '. 계약·견적·납기 조건을 검토한 후 회신합니다. 신청만으로 결제되지 않습니다.');
  }catch(error){info(error.message||'등록 오류가 발생했습니다.');}
  finally{sending=false;button.disabled=!ready;}
 });
 void checkReadiness();
})();