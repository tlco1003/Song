import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleProductionPayments} from '../src/production-payments.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const policy=read('docs/refund-policy.html');
const page=read('docs/payment.html');
const js=read('docs/payment.js');
const checkout=read('docs/checkout.html');
const server=read('src/production-payments.mjs');

test('customer refund page preserves statutory withdrawal and contract mismatch remedies',()=>{
 for(const phrase of ['제작 시작 전','7일','3개월','30일','3영업일','별도','개별 제작','회복할 수 없는','법정 권리'])
  assert.ok(policy.includes(phrase),phrase);
 for(const clause of ['제17조','제18조','시행령 제21조'])assert.ok(policy.includes(clause),clause);
 assert.ok(policy.includes('전자상거래'));
});
test('checkout shows policy, separate consent, and retains disabled-by-default payment',()=>{
 assert.match(page,/class="refund-preview"/);
 assert.match(page,/id="consent-refund" type="checkbox" required/);
 assert.ok(page.indexOf('id="consent-refund"')<page.indexOf('id="confirm-checkout"'));
 assert.match(page,/href="refund-policy.html"/);
 assert.match(checkout,/href="refund-policy.html"/);
 assert.match(js,/!\$\('consent-refund'\)\.checked/);
 assert.match(js,/refundPolicyAcknowledged:true,refundPolicyVersion:'2026-11-15'/);
 assert.match(page,/id="confirm-checkout"[^>]*disabled/);
});
test('server checks specific refund notice and stores version without waiving legal rights',()=>{
 assert.match(server,/input\.refundPolicyAcknowledged!==true/);
 assert.match(server,/input\.refundPolicyVersion!=='2026-11-15'/);
 assert.match(server,/refundPolicyConsent:/);
 assert.match(server,/statutoryRightsWaived:false/);
});
test('server refuses nonexistent or wrong-version policy acknowledgement before storage or PG',async()=>{
 const env={WITHU_PAYMENT_MODE:'test',TOSS_CLIENT_KEY:'test_gck_dummy',TOSS_SECRET_KEY:'test_gsk_dummy',WITHU_PUBLIC_BASE_URL:'https://withu.example/',WITHU_FROM_EMAIL:'WITHU <music@example.com>',RESEND_API_KEY:'mock_resend',WITHU_LINK_ENCRYPTION_KEY:'a'.repeat(64),WITHU_ADMIN_UID:'testoperator123',WITHU_OPERATOR_EMAIL:'operator@example.com',WITHU_STORAGE_BUCKET:'dummy.appspot.com',WITHU_FIREBASE_WEB_API_KEY:'dummy',WITHU_FIREBASE_AUTH_DOMAIN:'dummy.firebaseapp.com',WITHU_FIREBASE_PROJECT_ID:'dummy'};
 let writes=0;
 const db={collection(){writes++;throw Error('must not write');}};
 for(const partial of [{},{refundPolicyAcknowledged:true,refundPolicyVersion:'outdated'},{refundPolicyAcknowledged:false,refundPolicyVersion:'2026-11-15'}]){
  const body={termsAccepted:true,privacyAccepted:true,...partial};
  const req={method:'POST',originalUrl:'/api/orders',body,rawBody:Buffer.from(JSON.stringify(body)),is:type=>type==='application/json',get:name=>name==='origin'?'https://withu.example':undefined};
  await assert.rejects(handleProductionPayments(req,{}, {db,env,fetcher:async()=>{throw Error('no network');}}),/맞춤 제작의 취소·환불 기준/);
 }
 assert.equal(writes,0);
});
