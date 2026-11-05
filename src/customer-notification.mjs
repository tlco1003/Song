/**
 * WITHU customer transactional email, never from the browser.
 * Resend keys and verified sender domains live only in backend secrets.
 * Customers receive a portal URL, NOT songs, asset keys or bearer tokens.
 */
function address(value){
 if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)||/[\r\n]/.test(value))
  throw Error('Invalid email address');
 return value;
}
function clean(value,max=100){
 return typeof value==='string'?value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max):'';
}
export function makeResendCustomerEmail({
 apiKey=process.env.RESEND_API_KEY,
 from=process.env.WITHU_FROM_EMAIL,
 portalUrl=process.env.WITHU_CUSTOMER_PORTAL_URL,
 fetchImpl=globalThis.fetch
}={}){
 if(typeof apiKey!=='string'||!apiKey.startsWith('re_'))throw Error('Resend API key missing');
 address(from);
 const link=new URL(portalUrl);
 if(link.protocol!=='https:'||link.pathname!=='/song.html'||link.search||link.hash)
  throw Error('Portal must be an HTTPS /song.html URL with no access token');
 if(typeof fetchImpl!=='function')throw Error('Resend transport missing');
 async function transmit({to,subject,text,idempotencyKey}){
  const headers={Authorization:'Bearer '+apiKey,'Content-Type':'application/json'};
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const res=await fetchImpl('https://api.resend.com/emails',{
   method:'POST',headers,body:JSON.stringify({from,to:[address(to)],subject,text})
  });
  if(!res.ok)throw Error('Customer email provider rejected message (HTTP '+res.status+')');
  const json=await res.json();
  if(typeof json?.id!=='string'||!json.id)throw Error('Customer mail provider missing message ID');
  return {messageId:json.id};
 }
 return Object.freeze({
  async sendLoginCode({email,code,expiresMinutes}){
   if(typeof code!=='string'||!/^\d{6}$/.test(code)||expiresMinutes!==10)
    throw Error('Invalid one-time login code');
   return transmit({
    to:email,subject:'[WITHU] 나의 음악 선물함 인증번호',
    text:'WITHU 음악 선물함 인증번호: '+code+'\n\n10분 이내에 입력해 주세요. 인증번호를 타인에게 알려주지 마세요.\n\n직접 요청하지 않았다면 이 메일은 무시해 주세요.'
   });
  },
  async sendPaidReceipt({orderId,customerEmail,productName,amountKrw,idempotencyKey}){
   if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)
    ||idempotencyKey!=='withu-receipt-'+orderId
    ||!Number.isSafeInteger(amountKrw)||amountKrw<=0
    ||typeof productName!=='string'||!productName.trim()||productName.length>100)
    throw Error('Invalid verified payment receipt');
   const text=[
    'WITHU — 결제가 확인되었습니다.',
    '',
    '주문번호: '+orderId,
    '상품: '+clean(productName),
    '결제 완료 금액: '+amountKrw.toLocaleString('ko-KR')+'원',
    '',
    '완성된 노래는 제작과 검수가 끝나면 이 이메일로 별도 안내해 드립니다.',
    '나의 음악 선물함: '+link.toString(),
    '선물함에서는 이 이메일로 본인 인증 후 음악을 확인할 수 있습니다.'
   ].join('\n');
   return transmit({to:customerEmail,subject:'[WITHU] 결제가 확인되었습니다',
    text,idempotencyKey});
  },
  async sendReadyNotice({orderId,customerEmail,selectedSongs,idempotencyKey}){
   if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)
    ||idempotencyKey!=='withu-delivery-'+orderId
    ||!Array.isArray(selectedSongs)||!selectedSongs.length||selectedSongs.length>2)
    throw Error('Invalid verified delivery notice');
   if(selectedSongs.some(s=>!Number.isSafeInteger(s.index)||s.index<1
      ||typeof s.title!=='string'||s.title.length>120))
    throw Error('Invalid selected song metadata');
   const text=[
    'WITHU — 주문하신 음악 선물이 완성되었습니다.',
    '',
    '주문번호: '+orderId,
    '완성곡: '+selectedSongs.map(s=>clean(s.title)).join(', '),
    '',
    '아래 고객 전용 페이지에서 결제 시 등록한 이메일로 인증해 주세요.',
    link.toString(),
    '',
    '인증 후 구매한 곡만 재생하거나 원본 음원을 다운로드할 수 있습니다.',
    '이 메일에는 음원 파일이나 다운로드 권한 토큰이 첨부되지 않습니다.'
   ].join('\n');
   return transmit({
    to:customerEmail,subject:'[WITHU] 음악 선물이 완성되었어요',
    text,idempotencyKey
   });
  }
 });
}
