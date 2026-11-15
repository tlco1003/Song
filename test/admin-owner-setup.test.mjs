import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('owner can verify email and identify Firebase UID without bypassing server authorization',()=>{
 const js=get('docs/admin.js'),html=get('docs/admin.html');
 for(const id of ['admin-owner-identity','admin-owner-uid','admin-send-verification','admin-refresh-verification'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/sendEmailVerification\(user\)/);
 assert.match(js,/await user\.reload\(\)/);
 assert.match(js,/await user\.getIdToken\(true\)/);
 assert.match(js,/user\?\.uid/);
 assert.match(js,/const authenticated=Boolean\(user&&user\.emailVerified\)/);
 assert.match(js,/await api\('\/api\/admin\/orders'\)/);
 assert.match(get('src/production-runtime.mjs'),/user\.uid!==env\.WITHU_ADMIN_UID\|\|user\.email_verified!==true/);
 assert.match(html,/admin\.js\?v=20261116-owner-verify-01/);
});
