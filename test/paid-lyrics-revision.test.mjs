import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORDER_STATES} from '../src/commerce.mjs';
import {viewPaidLyrics,requestPaidLyricsRevision} from '../src/paid-lyrics-revision.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('docs/lyrics-revision.html');
const client=read('docs/lyrics-revision.js');
const server=read('src/server.mjs');
const session={authenticated:true,emailVerified:true,userId:'customer_1001'};
const order={
 id:'ORDER_123456',customerId:session.userId,
 songTitle:'엄마에게',confirmedLyrics:'엄마에게 꼭 전하고 싶은 사랑의 이야기입니다.',
 state:ORDER_STATES.PAID,paymentVerifiedAt:'2026-11-05T00:00:00Z',
 paymentKey:'test_payment_123456',revisionAllowed:true,revisionVersion:0
};
test('only order owner with verified paid order may view lyrics',()=>{
 const own=viewPaidLyrics({session,order});
 assert.equal(own.lyrics,order.confirmedLyrics);
 assert.equal(own.editingAllowed,true);
 for(const wrong of [
  {session:{...session,userId:'someone_else'},order},
  {session:{...session,emailVerified:false},order},
  {session:{...session,authenticated:false},order},
  {session,order:{...order,state:ORDER_STATES.PAYMENT_PENDING}},
  {session,order:{...order,paymentVerifiedAt:null}},
  {session,order:{...order,revisionAllowed:false}},
  {session,order:{...order,state:ORDER_STATES.REFUNDED}}
 ])assert.throws(()=>viewPaidLyrics(wrong),/Authenticated paid customer/);
});
test('postpayment lyrics revision is a review request, not an automatic overwrite',async()=>{
 const calls=[];
 const store={async createRevisionRequestAtomic(input){
  calls.push(input);return {outcome:'queued',status:'revision_requested'};
 }};
 const updated='엄마에게 정말 사랑한다고 오늘도 말하고 싶어요.';
 const result=await requestPaidLyricsRevision({
  session,order,lyrics:updated,expectedVersion:0,store
 });
 assert.equal(result.status,'revision_requested');
 assert.equal(calls.length,1);
 assert.equal(calls[0].nextStatus,'revision_requested');
 assert.equal(calls[0].newLyrics,updated);
 assert.equal(calls[0].requestKey,'revision:ORDER_123456:1');
 assert.equal(order.confirmedLyrics,'엄마에게 꼭 전하고 싶은 사랑의 이야기입니다.');
});
test('revision version mismatch and unverified customers never reach storage',async()=>{
 let count=0;
 const store={async createRevisionRequestAtomic(){count++;return {status:'revision_requested'};}};
 await assert.rejects(requestPaidLyricsRevision({session,order,lyrics:'새로운 수정 가사 내용입니다.',expectedVersion:99,store}),/version has changed/);
 await assert.rejects(requestPaidLyricsRevision({session:{...session,userId:'intruder'},order,lyrics:'새로운 수정 가사 내용입니다.',expectedVersion:0,store}),/Authenticated paid customer/);
 await assert.rejects(requestPaidLyricsRevision({session,order,lyrics:order.confirmedLyrics,expectedVersion:0,store}),/no change/);
 assert.equal(count,0);
});
test('public creation has no editable lyrics or music style, paid-only editor fails closed',()=>{
 const create=read('docs/create.html');
 assert.ok(!create.includes('id="song-lyrics"'));
 assert.ok(!create.includes('id="song-style"'));
 assert.ok(!create.includes('id="copy-lyrics"'));
 assert.ok(!create.includes('id="copy-style"'));
 assert.ok(create.includes('id="song-lyrics-preview"'));
 assert.ok(ui.includes('id="revision-editor" hidden'));
 assert.ok(ui.includes('id="request-revision"')&&ui.includes('disabled'));
 assert.match(client,/editingAllowed!==true/);
 assert.match(client,/credentials:'same-origin'/);
 assert.match(client,/X-CSRF-Token/);
 assert.match(server,/pathname.startsWith\('\/api\/customer\/lyrics-revision'\)/);
 assert.match(server,/new AppError\(503/);
});
