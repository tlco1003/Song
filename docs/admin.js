/**
 * WITHU live operator dashboard. Firebase Auth session is required.
 * No admin secret is entered into a public page. Access is rechecked by the
 * Cloud Function against the exact WITHU_ADMIN_UID on every request.
 */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged}
 from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
const $=id=>document.getElementById(id);
let firebaseAuth=null,orders=[],selected=null;
function status(text){$('admin-status').textContent=text;}
function workStatus(text){$('admin-work-status').textContent=text;}
async function api(url,{method='GET',data=null,file=null}={}){
 const user=firebaseAuth?.currentUser;
 if(!user||!user.emailVerified)throw Error('Firebase에서 인증된 운영자 계정이 필요합니다.');
 const jwt=await user.getIdToken();
 const headers={Authorization:'Bearer '+jwt};
 let body;
 if(file){
  headers['Content-Type']='application/octet-stream';
  headers['x-withu-file-name']=encodeURIComponent(file.name);
  body=file;
 }else if(data!==null){
  headers['Content-Type']='application/json';body=JSON.stringify(data);
 }
 const response=await fetch(url,{
  method,cache:'no-store',credentials:'same-origin',headers,
  ...(body?{body}:{})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'운영 서버 오류 '+response.status);
 return result;
}
function run(fn,which=status){
 return async()=>{
  try{await fn();}catch(error){which(error?.message||'요청에 실패했습니다.');}
 };
}
async function init(){
 const r=await fetch('/api/runtime',{cache:'no-store'}).catch(()=>null);
 if(!r?.ok)throw Error('Firebase Hosting의 운영 API가 연결되지 않았습니다. 현재 사이트는 정적 GitHub Pages일 수 있어요.');
 const cfg=await r.json();
 if(!cfg.firebaseWebConfig?.apiKey||!cfg.firebaseWebConfig?.projectId)
  throw Error('운영자 로그인 설정이 누락됐습니다. Firebase 웹 설정을 연결해 주세요.');
 firebaseAuth=getAuth(initializeApp(cfg.firebaseWebConfig));
 onAuthStateChanged(firebaseAuth,async user=>{
  const authenticated=Boolean(user&&user.emailVerified);
  $('admin-sign-out').hidden=!user;
  $('admin-workspace').hidden=!authenticated;
  if(!authenticated){
   if(user)status('운영자 이메일 인증을 완료한 뒤 다시 로그인해 주세요.');
   else status('운영자 이메일과 비밀번호를 입력해 주세요.');
   selected=null;return;
  }
  $('admin-login-panel').querySelector('#admin-password').value='';
  status('Firebase 인증 성공. 서버에서 운영자 UID를 확인하는 중…');
  try{await refresh();status('운영자 본인인증 완료 · 실제 주문 DB 연결');}
  catch(error){
   $('admin-workspace').hidden=true;
   status(error?.message||'운영자 접근 권한을 확인할 수 없습니다.');
  }
 });
}
async function login(){
 if(!firebaseAuth)throw Error('Firebase 운영 서버가 준비되지 않았습니다.');
 status('로그인 정보를 확인하고 있어요.');
 await signInWithEmailAndPassword(firebaseAuth,
  $('admin-email').value.trim(),$('admin-password').value);
}
async function refresh(){
 const result=await api('/api/admin/orders');
 orders=result.orders||[];
 renderOrders();
 if(selected){
  const current=orders.find(o=>o.id===selected.id);
  if(current)select(current);
 }
}
function txt(tag,content,cls=''){
 const el=document.createElement(tag);
 el.textContent=content||'';
 if(cls)el.className=cls;return el;
}
function renderOrders(){
 const pane=$('admin-order-list');
 pane.replaceChildren();
 if(!orders.length){
  pane.appendChild(txt('div','아직 접수된 고객 주문이 없습니다.','admin-empty'));
  return;
 }
 for(const o of orders){
  const row=document.createElement('div');
  row.className='admin-order'+(selected?.id===o.id?' active':'');
  const box=document.createElement('div');
  box.appendChild(txt('strong',
   (o.customerEmail||'수령인 없음')+' · '+(o.productId==='audio_duo'?'2곡':'1곡')));
  box.appendChild(txt('small',
   o.id+' · '+(o.paymentStatus==='paid'?'결제 확인':'미결제')+
   ' · '+(o.delivery?.status||'발송 대기')));
  const btn=document.createElement('button');
  btn.type='button';btn.className='admin-secondary';
  btn.textContent='이 주문 제작';
  btn.addEventListener('click',()=>select(o));
  row.append(box,btn);pane.append(row);
 }
}
function inputField(label,value,kind='text'){
 const wrap=document.createElement('div');
 wrap.className='admin-field';
 const lab=txt('label',label);
 const el=kind==='textarea'?document.createElement('textarea'):
  document.createElement('input');
 if(kind==='textarea'){el.rows=8;el.value=value||'';}
 else{el.type=kind;el.value=value||'';}
 wrap.append(lab,el);return {wrap,el};
}
function select(o){
 selected=o;
 $('admin-production').hidden=false;
 $('admin-selected-order').textContent=
  '주문 '+o.id+' · '+o.customerEmail+' · '+Number(o.amountKrw).toLocaleString('ko-KR')+
  '원 · '+o.paymentStatus+' · 고객 발송: '+(o.delivery?.status||'대기');
 $('admin-story').textContent=JSON.stringify(o.story||{},null,2);
 $('admin-style').textContent=JSON.stringify({
  production:o.production,genres:o.genreSelection,songStyles:o.songStyles
 },null,2);
 $('admin-finalize').disabled=o.paymentStatus!=='paid'||o.delivery?.status==='sent';
 $('admin-retry-ai').disabled=o.paymentStatus!=='paid'||o.delivery?.status==='sent';
 $('admin-revoke').disabled=!o.delivery?.messageId;
 const area=$('admin-song-editor');area.replaceChildren();
 const n=o.productId==='audio_duo'?2:1;
 for(let i=0;i<n;i++){
  const old=o.tracks?.[i]||null;
  const card=document.createElement('section');
  card.className='admin-song-card';
  card.appendChild(txt('h3','곡 '+(i+1)+' · '+(o.songStyles?.[i]?.genre||'장르 확인 중')));
  const title=inputField('완성곡 제목',old?.title||o.songTitle||'');
  const lyrics=inputField('고객에게 전달할 확정 가사',
   old?.lyrics||o.confirmedLyrics||'', 'textarea');
  const fileLabel=txt('label','최종 MP3/M4A/WAV 업로드 (25MB 이하)');
  const file=document.createElement('input');
  file.type='file';file.accept='.mp3,.m4a,.wav,audio/*';
  const uploadWrap=document.createElement('div');
  uploadWrap.className='admin-field';
  uploadWrap.append(fileLabel,file);
  const filename=txt('small',old?.storagePath?
   '현재 등록된 비공개 음원: '+old.fileName:
   '등록된 음원 없음');
  uploadWrap.append(filename);
  const agree=document.createElement('input');agree.type='checkbox';
  agree.checked=old?.rightsVerified===true;
  const check=document.createElement('label');check.className='consent-row';
  check.append(agree,txt('span',
   '직접 제작·정당하게 이용할 권리를 확인했고 음원과 가사를 검수했습니다.'));
  const save=document.createElement('button');
  save.type='button';save.className='admin-primary';
  save.disabled=o.paymentStatus!=='paid'||o.delivery?.status==='sent';
  save.textContent='이 고객의 '+(i+1)+'번 곡 저장·검수';
  save.addEventListener('click',run(async()=>{
   if(!selected||selected.id!==o.id)throw Error('고객 주문을 다시 선택해 주세요.');
   if(!agree.checked)throw Error('음원·가사 이용 권리를 확인해 주세요.');
   save.disabled=true;
   try{
    if(file.files?.[0]){
     workStatus('비공개 음원을 업로드하고 있어요…');
     await api('/api/admin/orders/'+o.id+'/tracks/'+(i+1)+'/audio',{
      method:'PUT',file:file.files[0]
     });
    }
    await api('/api/admin/orders/'+o.id+'/tracks/'+(i+1),{
     method:'POST',data:{
      title:title.el.value.trim(),lyrics:lyrics.el.value.trim(),
      genre:o.songStyles?.[i]?.genre,
      reviewed:true,rightsVerified:true
     }
    });
    workStatus('고객 '+o.id+'의 '+(i+1)+'번 곡이 비공개 저장소에 등록됐어요.');
    await refresh();
   }finally{save.disabled=false;}
  },workStatus));
  card.append(title.wrap,uploadWrap,lyrics.wrap,check,save);
  area.appendChild(card);
 }
 renderOrders();
}
async function send(){
 if(!selected)throw Error('주문을 선택하세요.');
 workStatus('실제 이메일 발송 요청 중…');
 const result=await api('/api/admin/orders/'+selected.id+'/deliver',{
  method:'POST',data:{}
 });
 workStatus(result.status==='already_sent'?
  '이미 해당 고객에게 전송된 주문입니다.':
  '고객 링크 메일 발송 API가 접수했습니다. 실제 수신함 도착은 이메일 제공사에서 확인해야 합니다.');
 await refresh();
}
async function retry(){
 if(!selected)throw Error('주문을 먼저 선택하세요.');
 const result=await api('/api/admin/orders/'+selected.id+'/retry-production',{
  method:'POST',data:{}
 });
 workStatus('결제 검증 주문의 AI 가사 재처리를 대기열에 등록했어요.');
 await refresh();
}
async function revoke(){
 if(!selected)throw Error('주문을 먼저 선택하세요.');
 if(!window.confirm('이 고객의 공유 링크를 회수하면 기존 링크와 노래 감상이 차단됩니다. 계속할까요?'))return;
 await api('/api/admin/orders/'+selected.id+'/revoke-link',{
  method:'POST',data:{}
 });
 workStatus('이 고객 주문의 공유 링크를 회수했습니다.');
 await refresh();
}
$('admin-sign-in').addEventListener('click',run(login));
$('admin-sign-out').addEventListener('click',run(async()=>{
 await signOut(firebaseAuth);$('admin-workspace').hidden=true;
}));
$('admin-refresh').addEventListener('click',run(refresh));
$('admin-finalize').addEventListener('click',run(send,workStatus));
$('admin-retry-ai').addEventListener('click',run(retry,workStatus));
$('admin-revoke').addEventListener('click',run(revoke,workStatus));
void init().catch(error=>status(error.message));
