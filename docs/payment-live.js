/**
 * WITHU optional real checkout UI. This module makes ZERO payment requests
 * until BOTH the public configuration and reviewed server release permit it.
 * Secret keys and Firestore Admin credentials must NEVER appear here.
 */
import {WITHU_PAYMENT_PUBLIC_CONFIG as config} from './withu-payment-public-config.js';

const $=id=>document.getElementById(id);
const status=message=>{$('payment-unavailable').textContent=message;};
const SDK='https://www.gstatic.com/firebasejs/11.10.0/';
const DRAFT_KEY='withu-order-draft-v1';
const MAX_AGE=30*60*1000;

function draftFromSession(){
  const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null');
  if(!draft||draft.version!==1||Date.now()-draft.savedAt>MAX_AGE
    ||draft.savedAt>Date.now()||!draft.title?.trim()||!draft.lyrics?.trim()
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
function permitted(){
  if(!config.enabled)return false;
  return !!(config.firebase?.apiKey&&config.firebase?.authDomain
    &&config.firebase?.projectId&&config.firebase?.appId
    &&config.appCheckEnterpriseSiteKey);
}
function script(url){
  return new Promise((resolve,reject)=>{
    const el=document.createElement('script');
    el.src=url;el.async=true;el.onload=resolve;el.onerror=reject;
    document.head.append(el);
  });
}
async function previewLoaded(){
  if(window.WITHU_PAYMENT_PREVIEW_READY)return;
  await new Promise(resolve=>window.addEventListener('withu:payment-preview-ready',resolve,{once:true}));
}
async function start(){
  if(!permitted())return; // Existing preview checkout remains disabled.
  try{
    await previewLoaded();
    draftFromSession();
    const [
      {initializeApp},{getAuth,sendSignInLinkToEmail,isSignInWithEmailLink,
        signInWithEmailLink,onAuthStateChanged,reload},
      {getFunctions,httpsCallable},
      {initializeAppCheck,ReCaptchaEnterpriseProvider}
    ]=await Promise.all([
      import(SDK+'firebase-app.js'),import(SDK+'firebase-auth.js'),
      import(SDK+'firebase-functions.js'),import(SDK+'firebase-app-check.js')
    ]);
    const app=initializeApp(config.firebase);
    initializeAppCheck(app,{
      provider:new ReCaptchaEnterpriseProvider(config.appCheckEnterpriseSiteKey),
      isTokenAutoRefreshEnabled:true
    });
    const auth=getAuth(app),fns=getFunctions(app,'asia-northeast3');
    const readiness=(await httpsCallable(fns,'withuCheckoutReadiness')()).data;
    if(!readiness?.canCharge||!readiness.clientKey)return;

    const button=$('confirm-checkout');
    const card=document.createElement('section');
    card.setAttribute('aria-label','구매자 이메일 인증');
    card.className='checkout-card';
    const heading=document.createElement('h3');
    heading.textContent='구매자 이메일 인증';
    const info=document.createElement('p');
    info.textContent='주문정보 보호를 위해 완성곡 수신 이메일로 본인인증 링크를 보내요.';
    const authButton=document.createElement('button');
    authButton.type='button';authButton.className='checkout-button';
    authButton.textContent='이메일 인증 링크 받기';
    const authInfo=document.createElement('p');
    authInfo.setAttribute('role','status');
    card.append(heading,info,authButton,authInfo);
    $('payment-methods').before(card);

    let verifiedUser=null,prepared=null,widgets=null,busy=false;
    const renderState=()=>{
      button.disabled=busy||!verifiedUser;
      if(!prepared)button.textContent=verifiedUser?'결제수단 불러오기':'이메일 인증 후 결제할 수 있어요';
      authButton.disabled=busy;
    };
    onAuthStateChanged(auth,user=>{
      verifiedUser=user?.emailVerified&&user.email?user:null;
      authInfo.textContent=verifiedUser?
        '인증 완료: '+verifiedUser.email:'이메일 본인인증이 필요합니다.';
      renderState();
    });

    const completeLink=async()=>{
      if(!isSignInWithEmailLink(auth,location.href))return false;
      const email=localStorage.getItem('withu-payment-auth-email')||emailFromForm();
      await signInWithEmailLink(auth,email,location.href);
      localStorage.removeItem('withu-payment-auth-email');
      // Remove the one-time verification parameters from URL/history.
      history.replaceState(null,'',new URL('payment.html',location.href).pathname);
      authInfo.textContent='이메일 인증이 완료됐습니다.';
      return true;
    };
    authButton.addEventListener('click',async()=>{
      if(busy)return;
      busy=true;renderState();
      try{
        if(await completeLink())return;
        const email=emailFromForm();
        localStorage.setItem('withu-payment-auth-email',email);
        await sendSignInLinkToEmail(auth,email,{
          url:new URL('payment.html',location.href).href,
          handleCodeInApp:true
        });
        authInfo.textContent='인증 메일을 보냈습니다. 같은 주소의 인증 링크를 열어 주세요.';
      }catch(error){
        authInfo.textContent='이메일 인증을 확인하지 못했습니다. 이메일과 인증 링크를 확인해 주세요.';
      }finally{busy=false;renderState();}
    });
    if(isSignInWithEmailLink(auth,location.href)){
      try{await completeLink();}
      catch(_){authInfo.textContent='링크 인증에 실패했습니다. 동일한 이메일을 입력하고 인증을 다시 시도해 주세요.';}
    }
    status('이메일 본인인증을 완료하면 안전한 결제창을 이용할 수 있습니다.');
    renderState();

    button.addEventListener('click',async()=>{
      if(busy||!verifiedUser)return;
      busy=true;renderState();
      try{
        await reload(verifiedUser);
        if(!verifiedUser.emailVerified)throw Error('이메일 인증이 필요합니다.');
        const email=emailFromForm();
        if(email!==verifiedUser.email.toLowerCase())throw Error('인증한 이메일과 수신 이메일이 다릅니다.');
        if(!$('consent-delivery').checked||!$('consent-service').checked)
          throw Error('전달 및 제작·환불 약관에 동의해 주세요.');
        if(!prepared){
          const draft=draftFromSession();
          const key='withu-payment-attempt-'+draft.savedAt+'-'+draft.selectedProduct;
          let requestId=sessionStorage.getItem(key);
          if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
          const created=(await httpsCallable(fns,'createWithuOrder')({
            requestId,productId:draft.selectedProduct,
            songTitle:draft.title,confirmedLyrics:draft.lyrics,
            genreSelection:draft.genreSelection,
            mood:draft.mood||'따뜻한',
            sharedStyleNotes:draft.sharedStyleNotes||'',
            deliveryEmail:email,
            consentDelivery:true,consentTerms:true
          })).data;
          if(created.productId!==draft.selectedProduct||created.currency!=='KRW'
            ||!Number.isSafeInteger(created.amountKrw))
            throw Error('서버 상품·금액과 선택한 주문이 다릅니다.');
          prepared=created;
          await script('https://js.tosspayments.com/v2/standard');
          if(typeof window.TossPayments!=='function')
            throw Error('결제 제공자 SDK가 연결되지 않았습니다.');
          const methods=document.createElement('div');methods.id='withu-live-payment-widget';
          const agreement=document.createElement('div');agreement.id='withu-live-payment-agreement';
          $('payment-methods').hidden=true;
          $('payment-methods').after(methods,agreement);
          widgets=window.TossPayments(readiness.clientKey).widgets({customerKey:verifiedUser.uid});
          await widgets.setAmount({currency:'KRW',value:created.amountKrw});
          await widgets.renderPaymentMethods({selector:'#withu-live-payment-widget',variantKey:'DEFAULT'});
          await widgets.renderAgreement({selector:'#withu-live-payment-agreement',variantKey:'AGREEMENT'});
          status('토스페이먼츠 결제수단을 선택한 뒤 결제하기 버튼을 눌러 주세요.');
          button.textContent='결제하기';
        }else{
          await widgets.requestPayment({
            orderId:prepared.orderId,orderName:prepared.orderName,
            customerEmail:email,
            successUrl:new URL('payment-success.html',location.href).href,
            failUrl:new URL('payment-fail.html',location.href).href
          });
        }
      }catch(error){
        status(error?.message||'결제 준비 중 오류가 발생했습니다.');
      }finally{busy=false;renderState();if(prepared&&widgets)button.textContent='결제하기';}
    });
  }catch(_){
    // Never enable the button on failed initialization, missing App Check,
    // missing Firebase settings, or readiness errors.
    $('confirm-checkout').disabled=true;
    status('안전한 결제 기능을 준비하고 있습니다.');
  }
}
void start();
