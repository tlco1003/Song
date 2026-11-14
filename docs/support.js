(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={available:false};
function message(x){$('support-result').textContent=x;}
function setAvailable(ok){
 state.available=ok;$('support-submit').disabled=!ok;
 $('support-submit').textContent=ok?'운영자에게 문의 접수하기':'이메일로 문의해 주세요';
 $('support-readiness').textContent=ok?
  '문의 접수 가능 · 공개 글은 관리자 답변과 승인 후 게시됩니다.':
  '게시판 서버가 아직 연결되지 않았습니다. 현재는 이메일로 문의해 주세요.';
}
function item(row){
 const el=document.createElement('article');el.className='support-item';
 const tag=document.createElement('small');
 const cat={general:'일반 문의',order:'주문·제작',technical:'음원·기술',other:'기타'};
 tag.textContent=(cat[row.category]||'문의')+' · '+String(row.nickname||'익명').slice(0,24);
 const h=document.createElement('h3');h.textContent=String(row.title||'문의').slice(0,90);
 const body=document.createElement('p');body.textContent=String(row.body||'').slice(0,1200);
 el.append(tag,h,body);
 if(typeof row.answer==='string'&&row.answer){
  const quote=document.createElement('blockquote');quote.textContent='WITHU 답변\n'+row.answer.slice(0,900);el.append(quote);
 }
 return el;
}
async function load(){
 setAvailable(false);
 try{
  const [readyRes,listRes]=await Promise.all([
   fetch('/api/support/readiness',{cache:'no-store'}),
   fetch('/api/support/questions',{cache:'no-store'})
  ]);
  if(!readyRes.ok||!listRes.ok)throw Error('not-deployed');
  const ready=await readyRes.json(),list=await listRes.json();
  if(!Array.isArray(list.questions))throw Error('invalid');
  setAvailable(ready.canSubmit===true&&list.canSubmit===true);
  const entries=$('support-list');entries.replaceChildren();
  if(!list.questions.length){
   const p=document.createElement('p');p.className='support-empty';
   p.textContent='아직 공개 승인된 문의가 없습니다. 비공개 문의는 게시판에 표시되지 않아요.';
   entries.append(p);
  }else list.questions.slice(0,30).forEach(x=>entries.append(item(x)));
 }catch(_){
  setAvailable(false);
  $('support-list').replaceChildren();
  const p=document.createElement('p');p.className='support-empty';
  p.textContent='게시판 서버 연결 전입니다. 문의와 환불 신청은 이메일 tlco1003@naver.com으로 보내주세요.';
  $('support-list').append(p);
 }
}
function visibility(){
 const isPublic=$('support-visibility').value==='public';
 if($('support-category').value==='refund'&&isPublic){
  $('support-visibility').value='private';
  message('환불 문의는 비공개로만 접수할 수 있습니다.');
 }
 const visible=$('support-visibility').value==='public';
 $('support-public-consent-row').hidden=!visible;
 $('support-public-consent').required=visible;
 if(!visible)$('support-public-consent').checked=false;
}
$('support-visibility').addEventListener('change',visibility);
$('support-category').addEventListener('change',visibility);
$('support-reload').addEventListener('click',()=>{void load();});
$('support-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!state.available)return message('현재는 이메일로 문의해 주세요.');
 const form=$('support-form');
 if(!form.reportValidity())return;
 const data={
  category:$('support-category').value,nickname:$('support-nickname').value.trim(),
  email:$('support-email').value.trim(),title:$('support-title').value.trim(),
  body:$('support-body').value.trim(),visibility:$('support-visibility').value,
  publicConsent:$('support-public-consent').checked,
  privacyAccepted:$('support-privacy').checked,replyAccepted:$('support-reply').checked,
  honeypot:$('support-website').value,policyVersion:'support-v1-20261115'
 };
 const btn=$('support-submit');btn.disabled=true;
 try{
  const res=await fetch('/api/support/questions',{method:'POST',credentials:'same-origin',
   cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await res.json().catch(()=>({}));
  if(!res.ok||result.status!=='pending')throw Error(result.error||'문의 접수에 실패했습니다.');
  form.reset();visibility();
  message('문의가 접수됐습니다. 접수번호 '+String(result.reference||'')+
   ' · 공개 글도 관리자 검토 후에만 게시됩니다. 이메일 발송은 별도 운영 절차입니다.');
  void load();
 }catch(error){message(error.message||'문의 접수에 실패했습니다. 이메일을 이용해 주세요.');}
 finally{btn.disabled=!state.available;}
});
visibility();void load();
})();