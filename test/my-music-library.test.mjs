import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../src/server.mjs';
import {ORDER_STATES} from '../src/commerce.mjs';
import {issuePrivateDeliveryInvitation} from '../src/private-delivery-invitation.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const home=read('docs/index.html');
const checkout=read('docs/checkout.html');
const box=read('docs/my-music.html');
const script=read('docs/song.js');
const server=read('src/server.mjs');

test('products and music configuration appear before bottom launch sale notes',()=>{
 const order=['id="product-audio"','id="inline-genre-options"',
  'id="dedication-outro"','id="video-inline-options"','class="promotion-note"'];
 const positions=order.map(x=>checkout.indexOf(x));
 assert.ok(positions.every(v=>v>0));
 assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
 assert.ok(checkout.indexOf('class="promotion-note"')<
  checkout.indexOf('data-checkout-step="review"'));
 assert.doesNotMatch(checkout,/<em class="choice-highlight">출시 특가세일<\/em>/);
 assert.match(checkout,/출시 기념 특가세일/);
 assert.match(checkout,/data-reference-for="audio"/);
 assert.ok(!checkout.includes('다운로드 제공'));
});
test('home top navigation leads into a distinct guest-only My Music page',()=>{
 const nav=home.slice(home.indexOf('<nav aria-label="사이트 메뉴">'),home.indexOf('</nav>')+6);
 assert.ok(nav.indexOf('href="my-music.html"')>=0);
 assert.ok(nav.indexOf('href="my-music.html"')<nav.indexOf('href="#top"'));
 for(const str of ['data-withu-view="customer"','id="my-music-guest"',
  'id="my-music-customer" hidden','id="detail-audio"','id="detail-video"',
  'id="detail-repeat"','id="private-track-choice"','id="detail-lyrics-text"',
  'id="commercial-upgrade-panel"','id="commercial-upgrade-buy"']){
  assert.ok(box.includes(str),str);
 }
 assert.ok(!box.includes('song-mother'));
 assert.match(script,/if\(isCustomerLibrary\)/);
 assert.match(script,/await loadPrivate\(delivered\|\|null\)/);
 assert.match(script,/api\/delivery\/library/);
 assert.match(script,/history\.replaceState/);
 assert.match(script,/customer.hidden=true/);
 assert.match(script,/guest.hidden=true/);
 assert.ok(!script.includes('localStorage.getItem'));
});
test('verified email link targets My Music, never the public song demo',()=>{
 const order={
  id:'WITHU_ORDER_55555',productId:'audio',state:ORDER_STATES.READY_TO_DELIVER,
  paymentVerifiedAt:'2026-11-06T00:00:00Z',paymentKey:'PG_CONFIRMED_111',
  recipientVerified:true,customerEmail:'buyer@example.test'
 };
 const invitation=issuePrivateDeliveryInvitation({
  order,origin:'https://withu.example/',
  selectedSongs:[{index:1,candidateId:'TAKE_0001'}]
 });
 const url=new URL(invitation.deliveryUrl);
 assert.equal(url.pathname,'/my-music.html');
 assert.equal(url.search,'');
 assert.match(url.hash,/^#delivery=[A-Za-z0-9_-]{43}$/);
 assert.ok(!invitation.deliveryUrl.includes(order.customerEmail));
});
test('unconnected production services show no private songs',async(t)=>{
 const app=createApp();await new Promise(done=>app.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(done=>app.close(done)));
 const base='http://127.0.0.1:'+app.address().port;
 let response=await fetch(base+'/my-music.html');
 assert.equal(response.status,200);
 assert.match(await response.text(),/id="my-music-customer" hidden/);
 response=await fetch(base+'/api/delivery/library');
 assert.equal(response.status,503);
});
test('customer library requires a valid session, verified paid orders and per-song rights',async(t)=>{
 const sid='A'.repeat(43);
 let authorized=true,calls=0;
 const track=(num,rights)=>({
  index:num,title:'구매한 노래 '+num,genre:'발라드',
  file:'track'+num+'.mp3',
  privateMediaUrl:'/api/delivery-assets/'+String(num).repeat(24),
  privateDownloadUrl:'/api/delivery-downloads/'+String(num).repeat(24),
  orderRef:'ord_'+String(num).repeat(24),
  commercialUpgrade:rights
 });
 const adapter={
  async getPrivateDeliveryLibrary({sessionId}){
   assert.equal(sessionId,sid);calls++;
   return {
    sessionVerified:true,verifiedCustomerAccount:true,
    verifiedOriginalPayment:true,verifiedRecipient:true,
    everyPurchasedTrackAuthorized:authorized,status:'delivered',
    tracks:[
     track(1,{status:'active',paymentVerified:true,rightsVerified:true,amountKrw:10000}),
     track(2,{status:'available',rightsVerified:true,amountKrw:10000})
    ]
   };
  }
 };
 const app=createApp({customerAccess:adapter});
 await new Promise(done=>app.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(done=>app.close(done)));
 const base='http://127.0.0.1:'+app.address().port;
 let response=await fetch(base+'/api/delivery/library');
 assert.equal(response.status,401);
 assert.equal(calls,0);
 response=await fetch(base+'/api/delivery/library',{
  headers:{cookie:'withu_delivery_session='+sid}
 });
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.tracks.length,2);
 assert.equal(result.commercialUpgrade.status,'unavailable');
 assert.equal(result.tracks[0].commercialUpgrade.status,'active');
 assert.equal(result.tracks[1].commercialUpgrade.status,'available');
 assert.ok(result.tracks[0].privateDownloadUrl);
 assert.ok(!Object.hasOwn(result.tracks[1],'privateDownloadUrl'));
 assert.match(result.tracks[0].orderRef,/^ord_/);
 assert.ok(!JSON.stringify(result).includes('paymentKey'));
 authorized=false;
 response=await fetch(base+'/api/delivery/library',{
  headers:{cookie:'withu_delivery_session='+sid}
 });
 assert.equal(response.status,403);
});
test('upgrade purchase is tied to the selected verified order, not a global profile toggle',()=>{
 assert.match(script,/item\?\.commercialUpgrade\|\|response\?\.commercialUpgrade/);
 assert.match(script,/orderRef:track\?\.orderRef/);
 assert.match(server,/everyPurchasedTrackAuthorized!==true/);
 assert.match(server,/!tokenHash&&!orderRef/);
 assert.match(server,/sanitizeCustomerCommercialStatus/);
 assert.match(server,/orderRef:orderRef\|\|null/);
});
