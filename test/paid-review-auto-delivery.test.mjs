import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewedPaidOrderReadyForAutoDelivery as ready} from '../src/production-auto-delivery-gate.mjs';
const id='withu_'+'a'.repeat(32);
const track=(i,reviewed=true,rightsVerified=true)=>({
 index:i,reviewed,rightsVerified,title:'희망의 노래 '+i,
 lyrics:'[Verse] 기다렸던 좋은 날이 오늘 찾아오네',
 storagePath:'orders/'+id+'/tracks/'+i+'-private.mp3'
});
const paid={id,productId:'audio',paymentStatus:'paid',
 paymentKey:'pay_key_1234567890',paymentVerifiedAt:123456,
 delivery:{status:'not_sent'},tracks:[track(1)]};
test('only completed, paid, reviewed and rights-approved song is sent once',()=>{
 const prior={...paid,tracks:[track(1,false,false)]};
 assert.equal(ready(prior,paid),true);
 assert.equal(ready(paid,paid),false);
 assert.equal(ready(prior,{...paid,paymentStatus:'pending'}),false);
 assert.equal(ready(prior,{...paid,paymentVerifiedAt:null}),false);
 assert.equal(ready(prior,{...paid,delivery:{status:'sent'}}),false);
 assert.equal(ready(prior,{...paid,delivery:{status:'failed'}}),false);
 assert.equal(ready(prior,{...paid,state:'refunded'}),false);
 assert.equal(ready(prior,{...paid,tracks:[track(1,true,false)]}),false);
 assert.equal(ready(prior,{...paid,tracks:[track(1,false,true)]}),false);
 assert.equal(ready(prior,{...paid,tracks:[{...track(1),storagePath:'orders/other/tracks/1.mp3'}]}),false);
});
test('2-song delivery requires both paid tracks to receive manual approval',()=>{
 const duo={...paid,productId:'audio_duo',tracks:[track(1),track(2)]};
 assert.equal(ready({...duo,tracks:[track(1),track(2,false)]},duo),true);
 assert.equal(ready({...duo,tracks:[track(1,false),track(2,false)]},{...duo,tracks:[track(1),track(2,false)]}),false);
 assert.equal(ready({...duo,tracks:[track(1,false),track(2,false)]},{...duo,tracks:[track(1),null]}),false);
 assert.equal(ready({...duo,tracks:[track(1,false),track(2,false)]},{...duo,tracks:[track(1)]}),false);
});
test('Firebase trigger exists and is a verified review transition rather than unconditional polling',()=>{
 const src=requireSource();
 assert.ok(src.includes('export const autoDeliverReviewedOrder=onDocumentUpdated'));
 assert.ok(src.includes('reviewedPaidOrderReadyForAutoDelivery(before,after)'));
 assert.ok(src.includes('sendCompletedEmail({'));
 assert.ok(src.includes("secrets:['RESEND_API_KEY','WITHU_LINK_ENCRYPTION_KEY']"));
});
function requireSource(){return requireFile('../src/firebase-production.mjs')}
function requireFile(p){return readFileSync(new URL(p,import.meta.url),'utf8')}
