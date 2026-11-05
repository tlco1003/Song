/**
 * WITHU selectable payment chips -> official TossPayments v2 Payment Window SDK.
 * This is an allowlist, not a guarantee that an uncontracted MID supports all methods.
 * IMPORTANT: use Toss "API individual integration" keys test_ck/live_ck and
 * matching test_sk/live_sk for this payment().requestPayment() integration.
 */
export const WITHU_PAYMENT_METHODS=Object.freeze({
  toss_pay:Object.freeze({id:'toss_pay',label:'토스페이',method:'CARD',easyPay:'TOSSPAY'}),
  naver_pay:Object.freeze({id:'naver_pay',label:'네이버페이',method:'CARD',easyPay:'NAVERPAY'}),
  kakao_pay:Object.freeze({id:'kakao_pay',label:'카카오페이',method:'CARD',easyPay:'KAKAOPAY'}),
  payco:Object.freeze({id:'payco',label:'페이코',method:'CARD',easyPay:'PAYCO'}),
  samsung_pay:Object.freeze({id:'samsung_pay',label:'삼성페이',method:'CARD',easyPay:'SAMSUNGPAY'}),
  apple_pay:Object.freeze({id:'apple_pay',label:'애플페이',method:'CARD',easyPay:'APPLEPAY'}),
  card:Object.freeze({id:'card',label:'신용·체크카드',method:'CARD'}),
  transfer:Object.freeze({id:'transfer',label:'실시간 계좌이체',method:'TRANSFER'}),
  virtual_account:Object.freeze({id:'virtual_account',label:'가상계좌',method:'VIRTUAL_ACCOUNT'}),
  mobile_phone:Object.freeze({id:'mobile_phone',label:'휴대폰 결제',method:'MOBILE_PHONE'}),
  culture_gift:Object.freeze({id:'culture_gift',label:'문화상품권',method:'CULTURE_GIFT_CERTIFICATE'}),
  book_gift:Object.freeze({id:'book_gift',label:'도서문화상품권',method:'BOOK_GIFT_CERTIFICATE'}),
  game_gift:Object.freeze({id:'game_gift',label:'게임문화상품권',method:'GAME_GIFT_CERTIFICATE'})
});

export function getWithuPaymentMethod(id){
  if(typeof id!=='string'||!Object.hasOwn(WITHU_PAYMENT_METHODS,id))
    throw new Error('지원하지 않는 결제수단입니다.');
  return WITHU_PAYMENT_METHODS[id];
}

export function requiresDirectPayConsent(id){
  return !!getWithuPaymentMethod(id).easyPay;
}

export function buildTossPaymentWindowRequest({
  choiceId,order,customerEmail,successUrl,failUrl
}){
  const chosen=getWithuPaymentMethod(choiceId);
  if(!order||typeof order.orderId!=='string'
    ||!/^[A-Za-z0-9_=\-]{6,64}$/.test(order.orderId)
    ||typeof order.orderName!=='string'||!order.orderName.trim()||order.orderName.length>100
    ||order.currency!=='KRW'
    ||!Number.isSafeInteger(order.amountKrw)||order.amountKrw<=0
    ||typeof customerEmail!=='string'
    ||customerEmail.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
    ||![successUrl,failUrl].every(s=>typeof s==='string'&&s.startsWith('https://')))
    throw new Error('서버 주문 또는 결제 환경 설정이 올바르지 않습니다.');
  const request={
    method:chosen.method,
    amount:{currency:'KRW',value:order.amountKrw},
    orderId:order.orderId,
    orderName:order.orderName,
    customerEmail,
    successUrl,
    failUrl
  };
  if(chosen.easyPay){
    request.card={flowMode:'DIRECT',easyPay:chosen.easyPay};
  }else if(chosen.method==='CARD'){
    request.card={flowMode:'DEFAULT'};
  }else if(chosen.method==='VIRTUAL_ACCOUNT'){
    request.virtualAccount={validHours:24};
  }
  return request;
}
