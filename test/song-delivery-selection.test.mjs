import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORDER_STATES} from '../src/commerce.mjs';
import {buildSongProductionPlan} from '../src/song-production-plan.mjs';
import {prepareCustomerDeliverables} from '../src/song-delivery-selection.mjs';
import {sendSelectedCustomerSongs} from '../src/customer-delivery.mjs';

function paidOrder(productId='audio',selection={mode:'single',genres:['발라드']}){
 const order={
  id:'WITHU_ORDER_10001',productId,genreSelection:selection,
  songTitle:'엄마에게',confirmedLyrics:'엄마, 난 언제나 고마워요.',
  mood:'따뜻한',sharedStyleNotes:'',
  paymentVerifiedAt:'2026-11-05T11:11:00.000Z',
  paymentKey:'payment_test_abcdef',
  state:ORDER_STATES.READY_TO_DELIVER
 };
 return {...order,paidSongPlan:structuredClone(buildSongProductionPlan(order))};
}
function batch(index,keys){
 return {index,candidates:keys.map((id,i)=>({
  id,privateAssetKey:'private/music/'+id+'.mp3',status:'READY'
 }))};
}
test('single-song order sends exactly ONE file even when Suno produced TWO candidates',()=>{
 const order=paidOrder();
 const deliveries=prepareCustomerDeliverables({
  order,
  candidateBatches:[batch(1,['TAKE_0001','TAKE_0002'])],
  selections:[{index:1,candidateId:'TAKE_0002'}]
 });
 assert.equal(deliveries.deliveryCount,1);
 assert.equal(deliveries.songs.length,1);
 assert.equal(deliveries.songs[0].candidateId,'TAKE_0002');
 assert.equal(deliveries.songs[0].privateAssetKey,'private/music/TAKE_0002.mp3');
 assert.ok(!JSON.stringify(deliveries).includes('TAKE_0001'));
});
test('two purchased songs select one verified file per independent song request',()=>{
 const order=paidOrder('audio_duo',{mode:'different',genres:['발라드','재즈']});
 const deliveries=prepareCustomerDeliverables({
  order,candidateBatches:[
   batch(1,['AUDIO_A001','AUDIO_A002']),
   batch(2,['AUDIO_B001','AUDIO_B002'])
  ],
  selections:[
   {index:1,candidateId:'AUDIO_A002'},
   {index:2,candidateId:'AUDIO_B001'}
  ]
 });
 assert.equal(deliveries.deliveryCount,2);
 assert.deepEqual(deliveries.songs.map(s=>s.genre),['발라드','재즈']);
 assert.deepEqual(deliveries.songs.map(s=>s.candidateId),['AUDIO_A002','AUDIO_B001']);
 assert.ok(!JSON.stringify(deliveries).includes('AUDIO_A001'));
 assert.ok(!JSON.stringify(deliveries).includes('AUDIO_B002'));
});
test('same-genre two songs still require distinct chosen assets',()=>{
 const order=paidOrder('audio_duo',{mode:'same',genres:['트로트']});
 assert.throws(()=>prepareCustomerDeliverables({
  order,candidateBatches:[
   batch(1,['SAME_ASSET']),
   batch(2,['SAME_ASSET'])
  ],
  selections:[
   {index:1,candidateId:'SAME_ASSET'},
   {index:2,candidateId:'SAME_ASSET'}
  ]
 }),/cannot deliver the same music file/);
});
test('unpaid, missing, duplicated and unverified candidates cannot be delivered',()=>{
 const order=paidOrder();
 const batches=[batch(1,['FIRST_TAKE','SECOND_TAKE'])];
 const selections=[{index:1,candidateId:'FIRST_TAKE'}];
 const good={order,candidateBatches:batches,selections};
 assert.throws(()=>prepareCustomerDeliverables({...good,order:{...order,state:ORDER_STATES.PAID}}),/verified-paid, approved/);
 assert.throws(()=>prepareCustomerDeliverables({...good,order:{...order,paymentVerifiedAt:null}}),/verified-paid, approved/);
 assert.throws(()=>prepareCustomerDeliverables({...good,selections:[]}),/Exactly one selection/);
 assert.throws(()=>prepareCustomerDeliverables({...good,selections:[...selections,...selections]}),/Exactly one selection/);
 assert.throws(()=>prepareCustomerDeliverables({...good,selections:[{index:1,candidateId:'MISSING_CANDIDATE'}]}),/not verified and ready/);
 const pending=[batch(1,['FIRST_TAKE'])];
 pending[0].candidates[0].status='PROCESSING';
 assert.throws(()=>prepareCustomerDeliverables({...good,candidateBatches:pending}),/not verified and ready/);
 const unsafe=[batch(1,['FIRST_TAKE'])];
 unsafe[0].candidates[0].privateAssetKey='https://public.example.test/music.mp3';
 assert.throws(()=>prepareCustomerDeliverables({...good,candidateBatches:unsafe}),/not verified and ready/);
});


test('ready notice sends only titles while private store saves the one chosen asset',async()=>{
 const order={...paidOrder(),recipientVerified:true,customerEmail:'customer@example.test'};
 const notices=[],persisted=[];
 const result=await sendSelectedCustomerSongs({
  order,deliveryJob:{orderId:order.id,key:'deliver:'+order.id,status:'claimed'},
  candidateBatches:[batch(1,['SONG_CHOICE_1','SONG_CHOICE_2'])],
  selections:[{index:1,candidateId:'SONG_CHOICE_2'}],
  deliveryStore:{
   async publishSelectionAtomic(args){persisted.push(args);return {outcome:'published'};},
   async markDeliveredAtomic(args){persisted.push({marked:args});return {outcome:'completed'};}
  },
  deliveryAdapter:{async sendReadyNotice(args){notices.push(args);return {messageId:'mock-ready-123'};}}
 });
 assert.equal(result.deliveredSongCount,1);
 assert.equal(notices.length,1);
 assert.equal(persisted.length,2);
 assert.equal(persisted[1].marked.nextState,ORDER_STATES.DELIVERED);
 assert.equal(persisted[0].selectedSongs[0].candidateId,'SONG_CHOICE_2');
 assert.equal(persisted[0].selectedSongs[0].privateAssetKey,'private/music/SONG_CHOICE_2.mp3');
 assert.equal(notices[0].selectedSongs.length,1);
 assert.equal(notices[0].selectedSongs[0].candidateId,undefined);
 assert.equal(notices[0].selectedSongs[0].privateAssetKey,undefined);
 assert.ok(!JSON.stringify(notices).includes('SONG_CHOICE_1'));
 assert.ok(!JSON.stringify(notices).includes('SONG_CHOICE_2'));
 assert.equal(notices[0].idempotencyKey,'withu-delivery-'+order.id);
});
test('unpaid, unverified or incomplete selections never publish or email',async()=>{
 const order=paidOrder(),notices=[],persisted=[];
 const makeArgs=o=>({
  order:o,deliveryJob:{orderId:o.id,key:'deliver:'+o.id,status:'claimed'},
  candidateBatches:[batch(1,['SONG_CHOICE_1','SONG_CHOICE_2'])],
  selections:[{index:1,candidateId:'SONG_CHOICE_1'}],
  deliveryStore:{
   async publishSelectionAtomic(args){persisted.push(args);return {outcome:'published'};},
   async markDeliveredAtomic(args){persisted.push({marked:args});return {outcome:'completed'};}
  },
  deliveryAdapter:{async sendReadyNotice(args){notices.push(args);return {messageId:'mock'};}}
 });
 await assert.rejects(sendSelectedCustomerSongs(makeArgs(order)),/not authorized/);
 const verified={...order,customerEmail:'customer@example.test',recipientVerified:true};
 await assert.rejects(sendSelectedCustomerSongs({...makeArgs(verified),selections:[]}),/Exactly one selection/);
 await assert.rejects(sendSelectedCustomerSongs({...makeArgs(verified),deliveryStore:null}),/Durable private delivery/);
 assert.equal(notices.length,0);
 assert.equal(persisted.length,0);
});
