import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('docs/payment.js');
const html=read('docs/payment.html');
const prepare=read('scripts/prepare-firebase.mjs');
test('official Toss widget can render only with actual test client key while checkout stays server-gated',()=>{
 assert.match(js,/fetch\('payment-widget-public.json'/);
 assert.match(js,/renderPaymentMethods/);
 assert.match(js,/renderAgreement/);
 assert.match(js,/const liveReady=Boolean\(data&&runtime\?\.canCharge===true/);
 assert.match(js,/if\(!liveReady\)\{/);
 assert.match(js,/if\(!enabled\|\|!prepared\|\|busy\)return/);
 assert.match(js,/fetch\('\/api\/orders'/);
 assert.match(html,/id="payment-widget-mode"/);
 assert.match(html,/id="confirm-checkout"[^>]*disabled/);
});
test('static widget config is generated only with a test client key, never any secret',()=>{
 assert.match(prepare,/setting\('WITHU_PAYMENT_MODE'\)==='test'/);
 assert.match(prepare,/setting\('WITHU_LIVE_PAYMENTS_ENABLED'\)==='false'/);
 assert.match(prepare,/\^test_gck_/);
 assert.match(prepare,/await rm\(configPath,\{force:true\}\)/);
 assert.match(prepare,/JSON\.stringify\(\{schemaVersion:1,mode:'test'/);
 assert.ok(!read('.gitignore').includes('!docs/payment-widget-public.json'));
 assert.match(read('.gitignore'),/docs\/payment-widget-public.json/);
});
