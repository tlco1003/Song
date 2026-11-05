/**
 * Toss redirect query is untrusted. Never show "paid" until WITHU's
 * authenticated Firebase server verifies official Toss approval and DB commit.
 */
import {WITHU_PAYMENT_PUBLIC_CONFIG as config} from './withu-payment-public-config.js';
const status=document.getElementById('withu-confirm-status');
const orderNode=document.getElementById('withu-confirm-order');
const SDK='https://www.gstatic.com/firebasejs/11.10.0/';
async function confirm(){
  if(!config.enabled)throw Error('결제 승인 기능이 준비 중입니다.');
  const params=new URLSearchParams(location.search);
  const orderId=params.get('orderId');
  const paymentKey=params.get('paymentKey');
  const amountText=params.get('amount');
  const amount=Number(amountText);
  if(!/^WITHU_[A-Za-z0-9_-]{16,58}$/.test(orderId||'')
    ||typeof paymentKey!=='string'||paymentKey.length<6||paymentKey.length>200
    ||!/^\d+$/.test(amountText||'')||!Number.isSafeInteger(amount)||amount<1)
    throw Error('결제 결과 주소가 올바르지 않습니다.');
  const [{initializeApp},{getAuth,onAuthStateChanged},
    {getFunctions,httpsCallable},{initializeAppCheck,ReCaptchaEnterpriseProvider}]=
    await Promise.all([
      import(SDK+'firebase-app.js'),import(SDK+'firebase-auth.js'),
      import(SDK+'firebase-functions.js'),import(SDK+'firebase-app-check.js')
    ]);
  const app=initializeApp(config.firebase);
  initializeAppCheck(app,{
    provider:new ReCaptchaEnterpriseProvider(config.appCheckEnterpriseSiteKey),
    isTokenAutoRefreshEnabled:true
  });
  const auth=getAuth(app);
  const user=await new Promise(resolve=>{
    const unsubscribe=onAuthStateChanged(auth,u=>{unsubscribe();resolve(u);});
  });
  if(!user?.emailVerified)throw Error('주문한 이메일 계정으로 인증한 후 확인할 수 있습니다.');
  orderNode.textContent='주문번호: '+orderId;
  const result=(await httpsCallable(getFunctions(app,'asia-northeast3'),'confirmWithuPayment')({
    orderId,paymentKey,amount
  })).data;
  if(result.status==='paid_verified'||result.status==='already_processed'){
    status.textContent='결제사의 승인이 확인되었습니다. 주문 접수 상태를 확인해 주세요.';
  }else if(result.status==='awaiting_deposit'){
    status.textContent='가상계좌가 발급되었지만 아직 입금 완료가 아닙니다. 입금 확인 전에는 제작을 시작하지 않습니다.';
  }else{
    status.textContent='결제 완료가 확인되지 않았습니다. 주문번호로 문의해 주세요.';
  }
}
confirm().catch(()=>{
  status.textContent='서버의 최종 결제 확인이 완료되지 않았습니다. 중복 결제하지 말고 주문번호로 문의해 주세요.';
});
