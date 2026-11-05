/**
 * WITHU payment choice chips -> official TossPayments v2 payment-window API.
 *
 * All payment choices remain selectable in preview; NO transaction can begin
 * until the authenticated Firebase backend confirms reviewed readiness.
 * Legacy payment window uses matched API-individual test_ck/live_ck and
 * test_sk/live_sk (NOT widget test_gck/live_gck credentials).
 */
import {WITHU_PAYMENT_PUBLIC_CONFIG as config} from './withu-payment-public-config.js';
import {
  getWithuPaymentMethod,requiresDirectPayConsent,buildTossPaymentWindowRequest
} from './payment-methods.js';

const $=id=>document.getElementById(id);
const SDK='https://www.gstatic.com/firebasejs/11.10.0/';
const DRAFT_KEY='withu-order-draft-v1';
const MAX_AGE=30*60*1000;
const status=message=>{$('payment-unavailable').textContent=message;};

function draftFromSession(){
  const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null');
  if(!draft||draft.version!==1||!Number.isFinite(draft.savedAt)
    ||Date.now()-draft.savedAt>MAX_AGE||draft.savedAt>Date.now()
    ||typeof draft.title!=='string'||!draft.title.trim()
    ||typeof draft.lyrics!=='string'||!draft.lyrics.trim()
    ||!['audio','audio_duo'].includes(draft.selectedProduct))
    throw new Error('주문 내용이 없거나 유효기간이 지났습니다. 이전 화면에서 다시 확인해 주세요.');
  return draft;
}
function emailFromForm(){
  const email=$('delivery-email').value.trim().toLowerCase();
  if(!email||email!==$('delivery-email-again').value.trim().toLowerCase())
    throw new Error('완성곡 수신 이메일을 두 번 동일하게 입력해 주세요.');
  return email;
}
function selectedChoice(){
  const selected=document.querySelector('input[name="paymentMethod"]:checked')?.value;
  return getWithuPaymentMethod(selected);
}
function directPayConsentGranted(choiceId){
  if(!requiresDirectPayConsent(choiceId))return true;
  return ['withu-direct-financial-terms','withu-direct-privacy-terms',
    'withu-direct-third-party-terms'].every(id=>$(id)?.checked===true);
}
function publicConfigReady(){
  return config.enabled===true
    &&!!(config.firebase?.apiKey&&config.firebase?.authDomain
      &&config.firebase?.projectId&&config.firebase?.appId
      &&config.appCheckEnterpriseSiteKey);
}
async function checkoutPreviewReady(){
  if(window.WITHU_PAYMENT_PREVIEW_READY)return;
  await new Promise(resolve=>{
    window.addEventListener('withu:payment-preview-ready',resolve,{once:true});
  });
}
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const node=document.createElement('script');
    node.src=src;node.async=true;
    node.onload=resolve;
    node.onerror=()=>reject(new Error('결제사 보안 모듈을 불러오지 못했습니다.'));
    document.head.append(node);
  });
}
async function initialize(){
  if(!publicConfigReady())return; // Preview radio chips still work.
  const button=$('confirm-checkout');
  try{
    await checkoutPreviewReady();
    const [
      {initializeApp},
      {getAuth,sendSignInLinkToEmail,isSignInWithEmailLink,
        signInWithEmailLink,onAuthStateChanged,reload},
      {getFunctions,httpsCallable},
      {initializeAppCheck,ReCaptchaEnterpriseProvider}
    ]=await Promise.all([
      import(SDK+'firebase-app.js'),
      import(SDK+'firebase-auth.js'),
      import(SDK+'firebase-functions.js'),
      import(SDK+'firebase-app-check.js')
    ]);
    const app=initializeApp(config.firebase);
    initializeAppCheck(app,{
      provider:new ReCaptchaEnterpriseProvider(config.appCheckEnterpriseSiteKey),
      isTokenAutoRefreshEnabled:true
    });
    const auth=getAuth(app),functions=getFunctions(app,'asia-northeast3');
    const readiness=(await httpsCallable(functions,'withuCheckoutReadiness')()).data;
    if(!readiness?.canCharge
      ||typeof readiness.clientKey!=='string'
      ||!/^(test|live)_ck_/.test(readiness.clientKey)){
      status('현재 결제가 비활성화되어 있어요. 결제기관 계약과 운영 검증 후 사용할 수 있습니다.');
      return;
    }

    const authSection=document.createElement('section');
    authSection.className='checkout-card';
    authSection.setAttribute('aria-label','구매자 이메일 인증');
    const title=document.createElement('h3');
    title.textContent='구매자 이메일 인증';
    const info=document.createElement('p');
    info.textContent='주문을 보호하기 위해 완성곡 수신 이메일로 본인 인증 링크를 보내요.';
    const authButton=document.createElement('button');
    authButton.type='button';authButton.className='checkout-button';
    authButton.textContent='이메일 인증 링크 받기';
    const authStatus=document.createElement('p');
    authStatus.setAttribute('role','status');
    authSection.append(title,info,authButton,authStatus);
    $('payment-methods').before(authSection);
    let verifiedUser=null,busy=false;

    function render(){
      button.disabled=busy||!verifiedUser;
      button.textContent=verifiedUser?'선택한 결제수단으로 결제하기':'이메일 인증 후 결제할 수 있어요';
      authButton.disabled=busy;
    }
    onAuthStateChanged(auth,user=>{
      verifiedUser=user?.emailVerified&&user.email?user:null;
      authStatus.textContent=verifiedUser
        ?'이메일 인증 완료: '+verifiedUser.email
        :'결제 전에 이메일 본인 인증이 필요합니다.';
      render();
    });
    async function completeEmailLink(){
      if(!isSignInWithEmailLink(auth,location.href))return false;
      const email=localStorage.getItem('withu-payment-auth-email')||emailFromForm();
      await signInWithEmailLink(auth,email,location.href);
      localStorage.removeItem('withu-payment-auth-email');
      history.replaceState(null,'',new URL('payment.html',location.href).pathname);
      authStatus.textContent='이메일 인증을 완료했습니다.';
      return true;
    }
    authButton.addEventListener('click',async()=>{
      if(busy)return;
      busy=true;render();
      try{
        if(await completeEmailLink())return;
        const email=emailFromForm();
        localStorage.setItem('withu-payment-auth-email',email);
        await sendSignInLinkToEmail(auth,email,{
          url:new URL('payment.html',location.href).href,
          handleCodeInApp:true
        });
        authStatus.textContent='인증 링크를 발송했습니다. 메일에서 링크를 선택해 주세요.';
      }catch(_){
        authStatus.textContent='이메일 주소와 인증 링크를 확인한 뒤 다시 시도해 주세요.';
      }finally{busy=false;render();}
    });
    if(isSignInWithEmailLink(auth,location.href)){
      try{await completeEmailLink();}
      catch(_){authStatus.textContent='인증 링크 확인에 실패했습니다. 같은 이메일을 다시 입력해 주세요.';}
    }

    await loadScript('https://js.tosspayments.com/v2/standard');
    if(typeof window.TossPayments!=='function')
      throw new Error('토스페이먼츠 결제 모듈을 확인하지 못했습니다.');
    status('원하는 결제수단 칩을 선택하고 이메일 인증과 필수 동의를 완료해 주세요.');
    render();

    button.addEventListener('click',async()=>{
      if(busy||!verifiedUser)return;
      busy=true;render();
      let paymentStarted=false;
      try{
        const chosen=selectedChoice();
        const email=emailFromForm();
        await reload(verifiedUser);
        if(!verifiedUser.emailVerified
          ||verifiedUser.email.toLowerCase()!==email)
          throw new Error('인증한 이메일과 수신 이메일이 다릅니다.');
        if(!$('consent-delivery').checked||!$('consent-service').checked)
          throw new Error('완성곡 전달과 제작·환불 안내에 동의해 주세요.');
        if(!directPayConsentGranted(chosen.id))
          throw new Error('선택한 간편결제의 전자금융거래·개인정보 필수 약관에 동의해 주세요.');

        const draft=draftFromSession();
        const requestSlot='withu-payment-attempt-'+draft.savedAt+'-'+draft.selectedProduct;
        let requestId=sessionStorage.getItem(requestSlot);
        if(!requestId){
          requestId=crypto.randomUUID();
          sessionStorage.setItem(requestSlot,requestId);
        }
        const created=(await httpsCallable(functions,'createWithuOrder')({
          requestId,productId:draft.selectedProduct,
          songTitle:draft.title,confirmedLyrics:draft.lyrics,
          genreSelection:draft.genreSelection,
          mood:draft.mood||'따뜻한',
          sharedStyleNotes:draft.sharedStyleNotes||'',
          deliveryEmail:email,
          consentDelivery:true,consentTerms:true
        })).data;
        if(created.productId!==draft.selectedProduct
          ||created.currency!=='KRW'
          ||!Number.isSafeInteger(created.amountKrw)
          ||created.amountKrw<=0)
          throw new Error('서버 상품 금액을 확인하지 못했습니다.');

        // After a payment attempt starts, do not blindly start another one
        // for the same order. A failed redirect/network can hide a prior charge.
        const lockKey='withu-payment-window-started-'+created.orderId;
        if(sessionStorage.getItem(lockKey))
          throw new Error('이 주문에 이미 결제 시도가 있습니다. 중복 결제하지 말고 주문 상태를 확인해 주세요.');

        // Never use the email or raw UID as the gateway customer identifier.
        const digest=await crypto.subtle.digest('SHA-256',
          new TextEncoder().encode('withu-toss-customer-v1:'+verifiedUser.uid));
        const customerKey='WITHU_'+[...new Uint8Array(digest)]
          .map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,40);
        const payment=window.TossPayments(readiness.clientKey).payment({customerKey});
        const successUrl=new URL('payment-success.html',location.href).href;
        const failUrl=new URL('payment-fail.html',location.href).href;
        const pgRequest=buildTossPaymentWindowRequest({
          choiceId:chosen.id,order:created,customerEmail:email,
          successUrl,failUrl
        });
        status(chosen.label+' 결제 인증창으로 이동합니다. 같은 주문을 중복 결제하지 마세요.');
        sessionStorage.setItem(lockKey,'1');
        paymentStarted=true;
        await payment.requestPayment(pgRequest);
      }catch(error){
        status(paymentStarted
          ?'결제 요청 결과를 확인하지 못했습니다. 중복 결제하지 말고 주문 상태를 확인해 주세요.'
          :(error instanceof Error?error.message:'결제 요청을 준비하지 못했습니다.'));
      }finally{busy=false;render();}
    });
  }catch(_){
    button.disabled=true;
    status('보안 결제 기능을 준비하고 있습니다. 현재 실제 결제를 할 수 없습니다.');
  }
}
void initialize();
