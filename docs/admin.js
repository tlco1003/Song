(()=>{
'use strict';
const $=id=>document.getElementById(id);
let connected=false,selectedOrder=null,orders=[];
const key=()=>$('admin-key').value;
function status(message){$('admin-status').textContent=message}
async function api(route,{method='GET',body=null,headers={}}={}){
 if(!connected&&key().length<32)throw Error('로컬 관리자 키 32자 이상이 필요합니다.');
 const r=await fetch(route,{method,cache:'no-store',credentials:'same-origin',
  headers:{'x-withu-test-key':key(),...headers,...(body&&!(body instanceof Blob)?{'Content-Type':'application/json'}:{})},
  ...(body!=null?{body:body instanceof Blob?body:JSON.stringify(body)}:{})});
 let result;try{result=await r.json()}catch(_){result={}}
 if(!r.ok)throw Error(result.error||result.message||'운영 서버 오류 ('+r.status+')');
 return result;
}
function run(fn){return async()=>{try{await fn()}catch(error){status('연결/요청 실패: '+(error.message||error));}}}
async function connect(){
 const r=await fetch('/api/_staging/outbox',{headers:{'x-withu-test-key':key()},credentials:'same-origin',cache:'no-store'});
 if(!r.ok)throw Error('로컬 관리자 테스트 서버가 실행 중이 아니거나 인증키가 올바르지 않습니다. 공개 사이트에서는 고객 자료를 처리할 수 없어요.');
 connected=true;status('로컬 관리자 인증 성공 · 실 결제/발송이 아닌 테스트 데이터만 표시 중');
 await refresh();
}
async function refresh(){
 if(!connected)throw Error('관리자 시험키로 먼저 연결하세요.');
 const result=await api('/api/_staging/orders');
 orders=result.orders||[];
 renderOrders();
}
function renderOrders(){
 const pane=$('admin-order-list');pane.replaceChildren();
 if(!orders.length){
  const empty=document.createElement('div');empty.className='admin-empty';empty.textContent='등록된 테스트 고객 주문이 없습니다.';pane.appendChild(empty);return;
 }
 for(const order of orders){
  const row=document.createElement('div');row.className='admin-order';
  const summary=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');
  strong.textContent=order.customerEmail+' · '+(order.productId==='audio_duo'?'2곡':'1곡');
  small.textContent=order.orderId.slice(0,24)+' · '+order.status+' · '+order.amountKrw.toLocaleString('ko-KR')+'원';
  summary.append(strong,small);
  const btn=document.createElement('button');btn.className='admin-secondary';btn.type='button';btn.textContent='이 주문 작업하기';
  btn.addEventListener('click',()=>selectOrder(order));
  row.append(summary,btn);pane.appendChild(row);
 }
}
function selectOrder(order){
 selectedOrder=order;
 $('admin-selected-order').textContent=order.customerEmail+' · '+order.orderId+' · '+order.status;
 $('admin-production').hidden=false;$('admin-upgrade').hidden=order.status!=='delivered';
 $('admin-mark-paid').disabled=order.status!=='payment_pending';
 $('admin-finalize').disabled=order.status!=='paid_test_only';
 const pane=$('admin-song-editor');pane.replaceChildren();
 const genres=order.songGenres||['발라드'];
 for(let i=0;i<(order.productId==='audio_duo'?2:1);i++){
  const card=document.createElement('div');card.className='admin-song-card';card.dataset.songIndex=String(i+1);
  const h=document.createElement('h3');h.textContent='곡 '+(i+1)+' · '+(genres[i]||genres[0]);
  const titleField=document.createElement('div');titleField.className='admin-field';
  const titleLabel=document.createElement('label');titleLabel.textContent='노래 제목';
  const title=document.createElement('input');title.className='admin-song-title';title.value='새로운 노래 '+(i+1);
  titleField.append(titleLabel,title);
  const audioField=document.createElement('div');audioField.className='admin-field';
  const audioLabel=document.createElement('label');audioLabel.textContent='완성 음원 MP3/M4A/WAV';
  const audio=document.createElement('input');audio.type='file';audio.accept='.mp3,.m4a,.wav,audio/*';audio.className='admin-song-audio';
  audioField.append(audioLabel,audio);
  const lyricField=document.createElement('div');lyricField.className='admin-field';
  const lyricLabel=document.createElement('label');lyricLabel.textContent='고객에게 보일 완성 가사';
  const lyric=document.createElement('textarea');lyric.rows=8;lyric.className='admin-song-lyrics';
  lyric.placeholder='[Verse 1]\n고객의 이야기를 담은 가사\n[Chorus]\n전하고 싶은 마음';
  lyricField.append(lyricLabel,lyric);
  card.append(h,titleField,audioField,lyricField);pane.appendChild(card);
 }
}
function draft(){
 const product=$('admin-product').value,genre=$('admin-genre').value;
 const recipient=$('admin-recipient').value.trim()||'소중한 사람';
 const memory=$('admin-memory').value.trim();
 if(memory.length<10)throw Error('고객 사연을 10자 이상 적어 주세요.');
 return {
  selectedProduct:product,genreSelection:{mode:product==='audio_duo'?'same':'single',genres:[genre]},
  story:{
   recipient,memory,occasion:'감사',message:'마음을 담아 고마움을 전하고 싶어요',
   gratitudeApology:'늘 고마워요',recipientAgeGroup:'unknown',
   relativePosition:'family',speechStyle:'polite',genre,mood:'감동적인',
   eraPreference:'1980s',lyricLength:'full'
  }
 };
}
async function newOrder(){
 if(!connected)throw Error('관리자 인증이 필요해요.');
 const result=await api('/api/_staging/orders',{method:'POST',body:{
  draft:draft(),contact:{
   customerEmail:$('admin-email').value.trim(),
   customerPhone:$('admin-phone').value.trim(),
   deliveryChannel:$('admin-channel').value,
   deliveryConsent:true
  }
 }});
 status('테스트 주문 생성: '+result.orderId+' (실제 결제 아님)');
 await refresh();
 const order=orders.find(x=>x.orderId===result.orderId);if(order)selectOrder(order);
}
async function markPaid(){
 if(!selectedOrder)throw Error('주문을 선택하세요.');
 await api('/api/_staging/orders/'+selectedOrder.orderId+'/simulate-payment',{method:'POST',body:{}});
 await refresh();selectOrder(orders.find(o=>o.orderId===selectedOrder.orderId));
 status('모의 결제완료로 전환됐어요. 실제 결제는 발생하지 않았습니다.');
}
async function upload(file){
 if(!file||file.size>25*1024*1024)throw Error('음원 파일을 선택하세요. 최대 25MB');
 const result=await api('/api/_staging/audio',{method:'POST',body:file,headers:{
  'Content-Type':'application/octet-stream','x-withu-audio-name':file.name
 }});
 return result.fileName;
}
async function finish(){
 if(!selectedOrder)throw Error('주문을 선택하세요.');
 if(selectedOrder.status!=='paid_test_only')throw Error('모의 결제완료 후 등록하세요.');
 const rows=[...document.querySelectorAll('.admin-song-card')],songs=[];
 for(const [i,row] of rows.entries()){
  const file=row.querySelector('.admin-song-audio').files?.[0];
  const title=row.querySelector('.admin-song-title').value.trim();
  const lyrics=row.querySelector('.admin-song-lyrics').value.trim();
  if(!file||title.length<2||lyrics.length<12)throw Error((i+1)+'번 곡의 음원·제목·완성 가사를 입력해 주세요.');
  const stored=await upload(file);
  songs.push({fileName:stored,title,lyrics,
   genre:selectedOrder.songGenres[i]||selectedOrder.songGenres[0]});
 }
 const result=await api('/api/_staging/orders/'+selectedOrder.orderId+'/finish',{
  method:'POST',body:{songs}
 });
 status(result.songCount+'곡 등록·링크 발급 완료 · 실제 발송 없음. 아래 발송함에서 확인하세요.');
 await refresh();selectOrder(orders.find(o=>o.orderId===selectedOrder.orderId));
 await showOutbox();
}
async function showOutbox(){
 if(!connected)throw Error('관리자 인증이 필요해요.');
 const result=await api('/api/_staging/outbox');
 const pane=$('admin-outbox-list');pane.replaceChildren();
 for(const event of result.messages||[]){
  const card=document.createElement('div');card.className='admin-outbox-row';
  const text=document.createElement('div');
  text.textContent=event.type+' · '+event.orderId+' · '+(event.recipient||'관리자 제작 대기');
  card.appendChild(text);
  if(event.listeningUrl){
   const link=document.createElement('a');link.href=event.listeningUrl;
   link.textContent='고객 전용 링크 열기 (로컬 테스트)';link.rel='noreferrer';
   card.appendChild(link);
  }
  pane.appendChild(card);
 }
 if(!pane.children.length)pane.textContent='아직 제작 완료된 고객 링크가 없습니다.';
}
async function upgrade(){
 if(!selectedOrder||selectedOrder.status!=='delivered')throw Error('먼저 제작 완료·전용 링크 발급이 필요합니다.');
 const result=await api('/api/_staging/orders/'+selectedOrder.orderId+'/simulate-upgrade',{
  method:'POST',body:{}
 });
 $('admin-upgrade-status').textContent=result.status+' · 실제 10,000원 결제나 상업적 이용 허락은 발생하지 않습니다.';
 status('고객 링크 화면을 다시 열면 추가 결제 후의 버튼 상태를 시연할 수 있어요.');
}
$('admin-connect-button').addEventListener('click',run(connect));
$('admin-refresh').addEventListener('click',run(refresh));
$('admin-create').addEventListener('click',run(newOrder));
$('admin-mark-paid').addEventListener('click',run(markPaid));
$('admin-finalize').addEventListener('click',run(finish));
$('admin-outbox').addEventListener('click',run(showOutbox));
$('admin-simulate-upgrade').addEventListener('click',run(upgrade));
if(location.hostname!=='127.0.0.1'){
 status('화면 구성은 확인할 수 있지만 공개 호스팅에서는 실제 고객 업로드가 불가능합니다. 로컬 관리자 테스트 서버 또는 비공개 운영 서버가 필요해요.');
}
})();