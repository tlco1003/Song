import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMurekaAccount,MUREKA_BILLING_ENDPOINT}
 from '../src/mureka-account.mjs';
import {readFileSync} from 'node:fs';

test('read-only Mureka balance probe is authenticated without generating any song',async()=>{
 const calls=[];
 const out=await checkMurekaAccount({
  apiKey:'mureka_test_secret_key_only',
  fetcher:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,json:async()=>({
    account_id:83921,balance:1575,
    total_recharge:2000,total_spending:425,
    concurrent_request_limit:5
   })};
  }
 });
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,MUREKA_BILLING_ENDPOINT);
 assert.equal(calls[0].options.method,'GET');
 assert.equal(out.balanceCents,1575);
 assert.equal(out.concurrentRequestLimit,5);
 assert.equal(out.status,'api_authenticated');
 assert.equal(out.musicGenerationNotTested,true);
 assert.ok(!Object.hasOwn(out,'account_id'));
 assert.ok(!JSON.stringify(out).includes('mureka_test_secret_key'));
});
test('broken Mureka billing credentials and invalid balances fail closed',async()=>{
 await assert.rejects(checkMurekaAccount({
  apiKey:'mureka_test_secret_key_only',
  fetcher:async()=>({ok:false,status:401})
 }),/MUREKA_BILLING_AUTH_OR_BALANCE_FAILED/);
 await assert.rejects(checkMurekaAccount({
  apiKey:'mureka_test_secret_key_only',
  fetcher:async()=>({ok:true,json:async()=>({
   balance:-10,concurrent_request_limit:100
  })})
 }),/MUREKA_BILLING_INVALID_RESPONSE/);
});
test('public admin code uses server-side authenticated API instead of browser provider key',()=>{
 const html=readFileSync(new URL('../docs/admin.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../docs/admin.js',import.meta.url),'utf8');
 assert.match(html,/admin-mureka-check/);
 assert.match(js,/\/api\/admin\/providers\/mureka\/account/);
 assert.doesNotMatch(html,/MUREKA_API_KEY/);
 assert.doesNotMatch(js,/Bearer \$MUREKA_API_KEY/);
});
