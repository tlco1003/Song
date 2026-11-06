/**
 * Contact and transactional delivery selection contract.
 * Browser validation is for UX only. Persist private contact information only
 * in the protected paid-order store; never in public Github Pages/URLs/logs.
 */
const CHANNELS=Object.freeze(['email','sms','kakao']);
export function normalizeKoreanMobile(value){
 if(typeof value!=='string')throw new TypeError('Customer phone must be text');
 const digits=value.replace(/[\s-]/g,'');
 if(!/^01[016789]\d{7,8}$/.test(digits))throw new Error('Valid Korean mobile number required');
 return digits;
}
export function normalizeDeliveryChannel(value){
 if(!CHANNELS.includes(value))throw new Error('Unknown customer notification channel');
 return value;
}
export function validateCheckoutDeliveryContact({
 customerEmail,customerPhone,deliveryChannel='email',
 deliveryConsent
}={}){
 if(typeof customerEmail!=='string')throw new Error('Customer email required');
 const email=customerEmail.trim().toLowerCase();
 if(email.length>254||!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/u.test(email))
  throw new Error('Valid customer email required');
 const phone=normalizeKoreanMobile(customerPhone);
 const channel=normalizeDeliveryChannel(deliveryChannel);
 if(deliveryConsent!==true)throw new Error('Contact delivery consent required');
 return Object.freeze({customerEmail:email,customerPhone:phone,deliveryChannel:channel,
  deliveryConsent:true});
}
