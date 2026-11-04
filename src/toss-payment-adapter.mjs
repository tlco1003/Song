/**
 * Future official Toss Payments server adapter.
 * Instantiating this does not enable public checkout; the orders endpoint
 * stays disabled until a durable paid-order store and all contracts are ready.
 * Documentation: https://docs.tosspayments.com/reference
 */
export function makeTossPaymentAdapter({
  secretKey=process.env.TOSS_SECRET_KEY,
  fetchImpl=globalThis.fetch
}={}){
  if(typeof secretKey!=='string'||secretKey.length<8)
    throw new Error('Toss server secret key is not configured');
  if(typeof fetchImpl!=='function')throw new Error('Toss HTTP transport missing');
  const authorization='Basic '+Buffer.from(secretKey+':','utf8').toString('base64');
  async function request(url,options={}){
    const response=await fetchImpl(url,{
      ...options,
      headers:{
        Authorization:authorization,
        'Content-Type':'application/json',
        ...(options.headers||{})
      }
    });
    if(!response.ok)
      throw new Error('Toss Payments API rejected a request (HTTP '+response.status+')');
    const payload=await response.json();
    if(!payload||typeof payload!=='object')
      throw new Error('Invalid Toss Payments response');
    return payload;
  }
  return Object.freeze({
    async confirm({paymentKey,orderId,amountKrw}){
      if(typeof paymentKey!=='string'||paymentKey.length<6
        ||typeof orderId!=='string'||orderId.length<6
        ||!Number.isSafeInteger(amountKrw)||amountKrw<=0)
        throw new Error('Invalid verified-order confirmation arguments');
      return request('https://api.tosspayments.com/v1/payments/confirm',{
        method:'POST',
        headers:{'Idempotency-Key':'withu-confirm-'+orderId},
        body:JSON.stringify({paymentKey,orderId,amount:amountKrw})
      });
    },
    async retrieve({paymentKey}){
      if(typeof paymentKey!=='string'||paymentKey.length<6||paymentKey.length>200)
        throw new Error('Invalid payment key');
      return request('https://api.tosspayments.com/v1/payments/'+encodeURIComponent(paymentKey),{
        method:'GET'
      });
    }
  });
}
