/** Private operator-only support inbox. All text uses textContent. */
export async function loadSupportQuestions(api,container){
 const result=await api('/api/admin/support/questions');
 const rows=Array.isArray(result.questions)?result.questions:[];
 container.replaceChildren();
 if(!rows.length){const p=document.createElement('p');p.textContent='아직 고객문의가 없습니다.';container.append(p);return;}
 for(const q of rows){
  const card=document.createElement('article');card.className='admin-order';
  const body=document.createElement('div');body.style.minWidth='0';
  const title=document.createElement('strong');title.textContent=String(q.title||'문의');
  const meta=document.createElement('small');meta.textContent=
   String(q.nickname||'')+' · '+String(q.email||'')+' · '+
   String(q.category||'')+' · '+String(q.visibility||'')+' · '+String(q.status||'');
  const text=document.createElement('p');text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';
  text.textContent=String(q.body||'').slice(0,1200);
  body.append(title,meta,text);
  const controls=document.createElement('div');controls.style.minWidth='min(100%,290px)';
  const answer=document.createElement('textarea');answer.rows=3;answer.maxLength=900;
  answer.setAttribute('aria-label','공개 답변 입력');answer.placeholder='공개 문의에 대한 승인 답변';
  answer.value=String(q.answer||'');answer.style.width='100%';
  const note=document.createElement('p');note.setAttribute('role','status');note.style.fontSize='12px';
  const buttons=document.createElement('div');buttons.className='admin-toolbar';
  const actions=[
   ...(q.visibility==='public'&&q.category!=='refund'?[['publish','답변 공개 승인']]:[]),
   ['resolved','개별 처리 완료'],['hide','숨김']
  ];
  for(const [action,label] of actions){
   const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.className='admin-secondary';
   btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{
     const data={action,...(action==='publish'?{answer:answer.value.trim()}:{})};
     const update=await api('/api/admin/support/questions/'+encodeURIComponent(q.id)+'/moderate',{
      method:'POST',data
     });
     note.textContent='상태 저장: '+String(update.status||'');
     q.status=update.status;
    }catch(e){note.textContent=e.message||'저장 실패';}
    finally{btn.disabled=false;}
   });
   buttons.append(btn);
  }
  controls.append(answer,buttons,note);card.append(body,controls);container.append(card);
 }
}
