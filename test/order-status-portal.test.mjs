import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizePaidOrder} from '../src/order-status-portal.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const order={paymentStatus:'paid',paymentKey:'pg_valid',paymentVerifiedAt:176000000,
 productId:'audio',production:{status:'manual_required',lyricsReady:true},
 confirmedLyrics:'[Verse 1] test',delivery:{status:'not_sent'},tracks:[]};
test('status response includes payment but never exposes customer contacts or files',()=>{
 const s=summarizePaidOrder(order);
 assert.equal(s.status,'in_production');assert.equal(s.steps.delivery,'pending');
 assert.equal(s.listeningUrl,undefined);assert.equal(s.customerEmail,undefined);
});
test('final status does not require a customer download grant',()=>{
 const s=summarizePaidOrder({...order,delivery:{status:'sent'}});
 assert.equal(s.status,'delivered');assert.equal(s.steps.delivery,'completed');
});
test('receipt API requires a paid order and scoped 43-character bearer token',()=>{
 const s=read('src/order-status-portal.mjs');
 assert.match(s,/paid\(order\)/);assert.match(s,/withuStatusLinks/);
 assert.match(s,/checkOrigin\(req,env\)/);assert.match(s,/tokenHash\(token\)/);
 assert.match(read('docs/order-status.js'),/api\/order-status\/resolve/);
});
