/** Operator-only brand video inquiry list. Reuses admin.js Firebase ID token. */
export async function loadVideoAdInquiries(api,container){
 if(typeof api!=='function'||!container)throw new Error('운영자 API가 필요합니다.');
 const response=await api('/api/admin/video-ads/inquiries');
 const entries=Array.isArray(response.inquiries)?response.inquiries:[];
 const label={
  received:'접수',reviewing:'검토',quote_prepared:'견적 준비',
  awaiting_customer:'고객 회신 대기',closed:'종료'
 };
 const allowed=Object.keys(label);
 container.replaceChildren();
 if(!entries.length){
  const p=document.createElement('p');
  p.textContent='접수된 브랜드 영상 상담이 없습니다.';
  container.append(p);return;
 }
 for(const item of entries){
  const row=document.createElement('article');
  row.className='admin-order';
  const content=document.createElement('div');
  const title=document.createElement('strong');
  title.textContent=String(item.brand||'브랜드명 없음')+' · '+String(item.product||'제품명 없음');
  const meta=document.createElement('small');
  meta.textContent=String(item.email||'이메일 없음')+' · '+String(item.id||'');
  const detail=document.createElement('p');
  detail.style.whiteSpace='pre-wrap';
  detail.style.overflowWrap='anywhere';
  detail.textContent=String(item.brief||'설명 없음').slice(0,1500);
  const extra=document.createElement('small');
  extra.textContent=String(item.category||'')+' · '+String(item.format||'')+' · '+
   String(item.budget||'')+(item.productUrl?' · 제품 URL: '+item.productUrl:'');
  content.append(title,meta,detail,extra);
  const right=document.createElement('div');
  const select=document.createElement('select');
  select.setAttribute('aria-label',String(item.brand||'')+' 상담 진행상태 변경');
  for(const status of allowed){
   const option=document.createElement('option');
   option.value=status;option.textContent=label[status];
   if(status===item.status)option.selected=true;
   select.append(option);
  }
  let previous=item.status;
  select.addEventListener('change',async()=>{
   select.disabled=true;
   try{
    const result=await api('/api/admin/video-ads/inquiries/'+item.id+'/status',{
     method:'POST',data:{status:select.value}
    });
    if(result.status!==select.value)throw Error('상태 저장 응답을 확인할 수 없습니다.');
    previous=select.value;
   }catch(error){
    select.value=previous;
    window.alert(error?.message||'상담 상태 저장에 실패했습니다.');
   }finally{select.disabled=false;}
  });
  right.append(select);
  row.append(content,right);
  container.append(row);
 }
}
