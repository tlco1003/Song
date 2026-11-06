import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORDER_STATES} from '../src/commerce.mjs';
import {buildSongProductionPlan} from '../src/song-production-plan.mjs';
import {finalizeSelectedPaidMusic}
 from '../src/finalize-licensed-customer-delivery.mjs';

const base={
 id:'WITHU_DELIVERY_00001',
 productId:'audio',genreSelection:{mode:'single',genres:['발라드']},
 songTitle:'엄마에게',
 confirmedLyrics:'[Verse 1]\n사랑하는 엄마에게\n[Chorus]\n언제나 고마워요',
 state:ORDER_STATES.READY_TO_DELIVER,recipientVerified:true,
 paymentVerifiedAt:'2026-11-06T10:00:00Z',
 paymentKey:'VERIFIED_PROVIDER_PAYMENT_001',
 customerEmail:'customer@example.test',
 deliveryChannel:'email',
 mood:'감동적인',eraPreference:'1980s',
 story:{speechStyle:'polite',recipientAgeGroup:'50s'}
};
const order={...base,paidSongPlan:buildSongProductionPlan(base)};
const deliveryJob={key:'deliver:'+order.id,orderId:order.id,status:'claimed'};
const selectedSongs=[{index:1,candidateId:'CANDIDATE_001'}];
const candidateBatches=[{index:1,candidates:[
 {id:'CANDIDATE_001',status:'READY',privateAssetKey:'private/order1/customer_final.mp3'},
 {id:'CANDIDATE_002',status:'READY',privateAssetKey:'private/order1/candidate_not_selected.mp3'}
]}];
const passed={
 candidateId:'CANDIDATE_001',songIndex:1,
 privateAssetStoredVerified:true,lyricsAndVocalsReviewed:true,
 commercialProductionRightsVerified:true,customerSpecificAssetVerified:true,
 finalApprovalVerified:true
};
const config={
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',
 RESEND_API_KEY:'re_not_a_live_key',
 WITHU_FROM_EMAIL:'music@withu.example'
};
test('fully approved paid track produces one private email link, never raw audio attachment',async()=>{
 const sequence=[];
 const orders={
  reserveDeliveryManifestAtomic:async v=>{
   sequence.push('manifest');
   assert.equal(v.approvedManifest.deliveryCount,1);
   assert.equal(v.approvedManifest.songs[0].candidateId,'CANDIDATE_001');
   assert.equal(v.approvedManifest.songs[0].privateAssetKey,'private/order1/customer_final.mp3');
   return {outcome:'created'};
  },
  saveDeliveryTokenHashAtomic:async v=>{
   sequence.push('token');
   assert.match(v.tokenHash,/^[a-f0-9]{64}$/);
  },
  recordNotificationAcceptedAtomic:async v=>{
   sequence.push('receipt');
   assert.equal(v.status,'provider_accepted_not_recipient_delivered');
   return {outcome:'created'};
  }
 };
 let captured=null;
 const result=await finalizeSelectedPaidMusic({
  order,deliveryJob,candidateBatches,selections:selectedSongs,
  qualityVerifier:{async verifyApprovedSong({orderId,selectedSong}){
   sequence.push('quality');
   assert.equal(orderId,order.id);
   assert.equal(selectedSong.candidateId,'CANDIDATE_001');
   return passed;
  }},
  orders,config,
  fetcher:async(url,options)=>{
   assert.equal(url,'https://api.resend.com/emails');
   sequence.push('provider');
   captured=JSON.parse(options.body);
   return {ok:true,json:async()=>({id:'resent_test_message_00001'})};
  }
 });
 assert.equal(result.status,'notification_accepted_not_inbox_verified');
 assert.equal(result.deliveryCount,1);
 assert.equal(result.customerMusicAccessGrantedOnlyViaPrivateLink,true);
 assert.deepEqual(sequence,['quality','manifest','token','provider','receipt']);
 assert.equal(captured.attachments,undefined);
 assert.equal(captured.to[0],'customer@example.test');
 assert.match(captured.text,/https:\/\/withu\.example\/my-music\.html#delivery=/);
 assert.ok(!captured.text.includes('private/order1/customer_final.mp3'));
 assert.ok(!captured.text.includes('CANDIDATE_002'));
});
test('unapproved vocal, rights or customer-scope data cannot produce or send customer link',async()=>{
 for(const failed of [
  {lyricsAndVocalsReviewed:false},
  {commercialProductionRightsVerified:false},
  {privateAssetStoredVerified:false},
  {customerSpecificAssetVerified:false},
  {finalApprovalVerified:false}
 ]){
  let calls=0;
  await assert.rejects(finalizeSelectedPaidMusic({
   order,deliveryJob,candidateBatches,selections:selectedSongs,
   qualityVerifier:{verifyApprovedSong:async()=>({...passed,...failed})},
   orders:{
    reserveDeliveryManifestAtomic:async()=>{calls++;return {outcome:'created'};},
    saveDeliveryTokenHashAtomic:async()=>{calls++;},
    recordNotificationAcceptedAtomic:async()=>{calls++;return {outcome:'created'};}
   },config,fetcher:async()=>{calls++;throw Error('must not email')}
  }),/failed audio/);
  assert.equal(calls,0);
 }
});
test('unpaid order and duplicate audio candidates never trigger delivery',async()=>{
 const orders={
  reserveDeliveryManifestAtomic:async()=>{throw Error('must not reserve');},
  saveDeliveryTokenHashAtomic:async()=>{throw Error('must not persist');},
  recordNotificationAcceptedAtomic:async()=>{throw Error('must not notify');}
 };
 const opts={order,deliveryJob,candidateBatches,selections:selectedSongs,
  qualityVerifier:{verifyApprovedSong:async()=>passed},orders,config,
  fetcher:async()=>{throw Error('must not send')}
 };
 await assert.rejects(finalizeSelectedPaidMusic({
  ...opts,order:{...order,state:ORDER_STATES.PAID}
 }),/verified payment/);
 await assert.rejects(finalizeSelectedPaidMusic({
  ...opts,candidateBatches:[{index:1,candidates:[
   {id:'CANDIDATE_001',status:'NOT_READY',privateAssetKey:'private/order1/customer_final.mp3'}
  ]}]
 }),/not verified and ready/);
});
