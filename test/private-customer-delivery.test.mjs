import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createApp} from '../src/server.mjs';
import {ORDER_STATES,publicPriceCatalog} from '../src/commerce.mjs';
import {hashPrivateDeliveryToken,issuePrivateDeliveryInvitation,dispatchPrivateListeningEmail} from '../src/private-delivery-invitation.mjs';
import {commercialUpgradeQuote,assertDownloadEntitlement,confirmCommercialUpgradeAndGrant} from '../src/commercial-rights-upgrade.mjs';

const order={
 id:'WITHU_ORDER_10001',productId:'audio',state:ORDER_STATES.DELIVERED,
 customerEmail:'buyer@example.test',recipientVerified:true,
 paymentVerifiedAt:'2026-11-06T00:00:00Z',paymentKey:'ORIGINAL_PAYMENT_KEY'
};
const selectedSongs=[{index:1,candidateId:'TRACK_ABCDEF1',privateAssetKey:'private/customer/track1.mp3'}];
const rightsRecords=[{
 candidateId:'TRACK_ABCDEF1',originalOutputVerified:true,isRemix:false,
 providerCommercialUsePermitted:true,providerPermittedDownloadVerified:true,
 providerDownloadReceipt:'Suno_Official_Download_Receipt',
 thirdPartyMaterialsCleared:true,authorizedToGrantCustomerCommercialUse:true,
 customerLicenseTermsReviewed:true,reviewedAt:'2026-11-06T00:00:00Z'
}];
const viewer={orderId:order.id,sessionVerified:true,recipientVerified:true};
test('normal price is crossed out; public demo has no track/cover file download UI',()=>{
 const html=readFileSync(new URL('../docs/checkout.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../docs/checkout.css',import.meta.url),'utf8');
 const detail=readFileSync(new URL('../docs/song.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../docs/song.js',import.meta.url),'utf8');
 assert.match(css,/\.creator-list-price\s*\{[^}]*text-decoration:line-through/s);
 assert.match(html,/이메일 전용 링크로 감상/);
 assert.ok(!html.includes('다운로드 제공'));
 assert.ok(!detail.includes('id="download-cover"'));
 assert.match(detail,/id="commercial-upgrade-panel"[^>]*hidden/);
 assert.match(detail,/id="download-track"[^>]*hidden/);
 assert.ok(!script.includes('download.href=mediaPath'));
 assert.match(script,/api\/delivery\/resolve/);
 assert.match(script,/api\/delivery-downloads/);
});
test('commercial upgrade is a separate 10000 KRW per-order offer, never base price',()=>{
 const catalog=publicPriceCatalog();
 assert.equal(catalog.products[0].amountKrw,29000);
 assert.equal(catalog.products[1].amountKrw,39000);
 assert.equal(catalog.postDeliveryUpgrades.commercialUseDownload.amountKrw,10000);
 assert.equal(catalog.postDeliveryUpgrades.commercialUseDownload.chargeUnit,'per_order');
 assert.equal(catalog.postDeliveryUpgrades.commercialUseDownload.requiresVerifiedRights,true);
});
test('256-bit private listening link keeps token out of query and hash in server records',async()=>{
 const invitation=issuePrivateDeliveryInvitation({
  order:{...order,state:ORDER_STATES.READY_TO_DELIVER},
  origin:'https://withu.example/',selectedSongs
 });
 const u=new URL(invitation.deliveryUrl),token=new URLSearchParams(u.hash.slice(1)).get('delivery');
 assert.equal(u.search,'');assert.equal(token.length,43);
 assert.equal(hashPrivateDeliveryToken(token),invitation.tokenHash);
 assert.ok(!invitation.deliveryUrl.includes(order.customerEmail));
 assert.throws(()=>issuePrivateDeliveryInvitation({
  order:{...order,state:ORDER_STATES.DRAFT},origin:'https://withu.example/',selectedSongs
 }),/verified paid order/);
 let events=[];
 const receipt=await dispatchPrivateListeningEmail({
  invitation,orders:{async saveDeliveryTokenHashAtomic(v){events.push(['store',v]);}},
  mailer:{async sendPersonalListeningLink(v){events.push(['mail',v]);return {messageId:'email_001'}}}
 });
 assert.equal(receipt.messageId,'email_001');
 assert.deepEqual(events.map(x=>x[0]),['store','mail']);
 assert.ok(!JSON.stringify(events[0][1]).includes(token));
 assert.equal(events[1][1].listeningUrl,invitation.deliveryUrl);
});
test('no commercial licence unless every final recording has original, official download and clearance proof',()=>{
 const quoted=commercialUpgradeQuote({order,selectedSongs,rightsRecords,viewer});
 assert.equal(quoted.amountKrw,10000);
 assert.equal(quoted.rightsVerified,true);
 for(const field of ['providerCommercialUsePermitted','providerPermittedDownloadVerified',
  'originalOutputVerified','thirdPartyMaterialsCleared','authorizedToGrantCustomerCommercialUse']){
  const broken=[{...rightsRecords[0],[field]:false}];
  assert.throws(()=>commercialUpgradeQuote({order,selectedSongs,rightsRecords:broken,viewer}),/incomplete/);
 }
 assert.throws(()=>commercialUpgradeQuote({
  order,selectedSongs,rightsRecords:[{...rightsRecords[0],isRemix:true}],viewer
 }),/incomplete/);
 assert.throws(()=>commercialUpgradeQuote({
  order,selectedSongs,rightsRecords,viewer:{...viewer,orderId:'WRONG_CUSTOMER'}
 }),/authenticated customer/);
});
test('commercial payment requires its own provider confirmation and atomic grant, not initial receipt',async()=>{
 const upgradeIntent={id:'UPGRADE_00001',originalOrderId:order.id,
  providerOrderId:'LICENSE_ORDER_001',status:'payment_pending',amountKrw:10000,currency:'KRW'};
 const paymentKey='LICENSE_PAYMENT_KEY_0001';
 let grants=0,confirmations=0;
 const payments={async confirm({orderId,amountKrw}){confirmations++;
  assert.equal(orderId,upgradeIntent.providerOrderId);assert.equal(amountKrw,10000);
  return {status:'DONE',orderId,paymentKey,currency:'KRW',
   totalAmount:10000,balanceAmount:10000};
 }};
 const orders={async grantCommercialEntitlementAtomic(p){grants++;
  assert.equal(p.originalOrderId,order.id);assert.equal(p.amountKrw,10000);
  return {outcome:'created'};
 }};
 const args={originalOrder:order,upgradeIntent,paymentKey,claimedAmountKrw:10000,
  selectedSongs,rightsRecords,viewer,orders,payments};
 await assert.rejects(confirmCommercialUpgradeAndGrant({...args,claimedAmountKrw:39000}),/does not match/);
 assert.equal(grants,0);assert.equal(confirmations,0);
 assert.equal((await confirmCommercialUpgradeAndGrant(args)).status,'commercial_entitlement_verified');
 assert.equal(grants,1);
 await assert.rejects(confirmCommercialUpgradeAndGrant({
  ...args,payments:{async confirm(){return {status:'DONE',orderId:upgradeIntent.providerOrderId,
   paymentKey,currency:'KRW',totalAmount:10001,balanceAmount:10001};}}
 }),/not verified/);
 assert.equal(grants,1);
});
test('private stream session does not grant downloaded original without a separate entitlement',()=>{
 const entitlement={status:'active',originalOrderId:order.id,
  paymentVerified:true,amountKrw:10000,paymentKey:'UPGRADE_PAYMENT_KEY',
  permission:'nonexclusive-commercial-use',licensedCandidateIds:['TRACK_ABCDEF1']};
 assert.equal(assertDownloadEntitlement({
  order,viewer,entitlement,selectedSong:selectedSongs[0],rightsRecords
 }),true);
 for(const e of [{...entitlement,paymentVerified:false},
  {...entitlement,amountKrw:0},{...entitlement,licensedCandidateIds:[]}]){
  assert.throws(()=>assertDownloadEntitlement({
   order,viewer,entitlement:e,selectedSong:selectedSongs[0],rightsRecords
  }),/separately verified/);
 }
});
test('unconnected live email, PG and private storage routes always fail closed',async(t)=>{
 const app=createApp();
 await new Promise(done=>app.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base='http://127.0.0.1:'+app.address().port;
 const token=randomBytes(32).toString('base64url');
 let r=await fetch(base+'/api/delivery/resolve',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})
 });
 assert.equal(r.status,503);
 r=await fetch(base+'/api/commerce/commercial-upgrade/checkout',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deliveryToken:token})
 });
 assert.equal(r.status,503);
 r=await fetch(base+'/api/delivery-assets/'+('A'.repeat(24)));
 assert.equal(r.status,503);
 r=await fetch(base+'/api/delivery-downloads/'+('B'.repeat(24)));
 assert.equal(r.status,503);
});
