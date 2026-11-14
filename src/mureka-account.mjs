/**
 * Read-only official Mureka billing health check.
 * Never generates music, never returns a token or account identifier.
 * https://platform.mureka.ai/docs/api/operations/get-v1-account-billing.html
 */
export const MUREKA_BILLING_ENDPOINT='https://api.mureka.ai/v1/account/billing';
export class MurekaBillingError extends Error{
 constructor(code){super(code);this.name='MurekaBillingError';this.code=code;}
}
export async function checkMurekaAccount({
 apiKey,fetcher=globalThis.fetch,timeoutMs=15000
}={}){
 if(typeof apiKey!=='string'||apiKey.length<12)
  throw new MurekaBillingError('MUREKA_API_KEY_NOT_CONFIGURED');
 if(typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)
  ||timeoutMs<1000||timeoutMs>30000)
  throw new MurekaBillingError('MUREKA_BILLING_CONFIG_INVALID');
 let response;
 try{
  response=await fetcher(MUREKA_BILLING_ENDPOINT,{
   method:'GET',
   headers:{Authorization:'Bearer '+apiKey},
   redirect:'error',signal:AbortSignal.timeout(timeoutMs)
  });
 }catch(_){throw new MurekaBillingError('MUREKA_BILLING_UNAVAILABLE');}
 if(!response?.ok)throw new MurekaBillingError('MUREKA_BILLING_AUTH_OR_BALANCE_FAILED');
 let body;
 try{body=await response.json();}
 catch(_){throw new MurekaBillingError('MUREKA_BILLING_INVALID_RESPONSE');}
 if(!Number.isSafeInteger(body?.balance)||body.balance<0
  ||!Number.isSafeInteger(body?.concurrent_request_limit)
  ||body.concurrent_request_limit<0)
  throw new MurekaBillingError('MUREKA_BILLING_INVALID_RESPONSE');
 return Object.freeze({
  provider:'mureka',status:'api_authenticated',
  balanceCents:body.balance,
  concurrentRequestLimit:body.concurrent_request_limit,
  musicGenerationNotTested:true
 });
}
