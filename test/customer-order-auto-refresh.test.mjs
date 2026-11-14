import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('buyer order status auto-refresh is token-scoped, privacy-preserving and stops on delivery',()=>{
 const js=read('docs/order-status.js');
 assert.ok(js.includes("const validToken=/^[A-Za-z0-9_-]{43}$/.test(token||'')"));
 assert.ok(js.includes("if(validToken){"));
 assert.ok(js.includes("pollTimer=setInterval"));
 assert.ok(js.includes("!document.hidden&&!busy&&!delivered"));
 assert.ok(js.includes("clearInterval(pollTimer)"));
 assert.ok(js.includes("v.status==='delivered'"));
 assert.ok(js.includes("url.pathname!=='/my-music.html'"));
 assert.ok(js.includes("fetch('/api/order-status/resolve'"));
 assert.ok(!js.includes("localStorage.setItem"));
 assert.ok(read('docs/order-status.html').includes("order-status.js?v=20261115-auto-01"));
});
