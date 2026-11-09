import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('authorized share QR stays on device and does not grant downloads',()=>{
 const html=read('docs/my-music.html'),js=read('docs/song.js');
 assert.match(html,/id="gift-qr-show"/);assert.match(html,/id="gift-lyrics-print"/);
 assert.match(js,/!isPrivate\|\|!privateShareUrl/);
 assert.match(js,/url\.pathname!=='\/gift\.html'/);
 assert.match(js,/new QRCode\(/);
 assert.doesNotMatch(js,/api\.qrserver\.com/);
 assert.match(js,/window\.print\(\)/);
});
test('package comparison distinguishes rights and price',()=>{
 const html=read('docs/checkout.html');
 assert.match(html,/상품별 제공 내용 비교/);
 assert.match(html,/원본 음원·상업적 이용/);
 assert.match(html,/별도 결제·권리 검증/);
});
test('operator can resend receipts but does not receive bearer link in browser',()=>{
 const html=read('docs/admin.html'),js=read('docs/admin.js');
 assert.match(html,/id="admin-resend-receipt"/);
 assert.match(js,/resend-receipt/);
 assert.doesNotMatch(js,/WITHU_LINK_ENCRYPTION_KEY/);
});
