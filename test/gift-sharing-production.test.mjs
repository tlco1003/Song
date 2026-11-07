import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeTrackPreferences,buildSongProductionPlan}
 from '../src/song-production-plan.mjs';
import {prepareServerOrderDraft} from '../src/order-draft-preparation.mjs';
import {validateGiftComment}
 from '../src/production-comments.mjs';
import {makeOpaqueToken,tokenHash,authorizeOrderMedia}
 from '../src/production-contract.mjs';
import {linkUrl,visibleTracks,customerResponse}
 from '../src/production-runtime.mjs';
import {handleProductionDelivery}
 from '../src/production-delivery.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const story={recipient:'엄마',occasion:'생일',
 memory:'봄마다 엄마와 집 앞 꽃길을 함께 걸었어요.',
 message:'그 시간이 가장 소중한 기억이에요.',
 gratitudeApology:'늘 곁에 있어 줘서 고마워요.',
 recipientAgeGroup:'50s',relativePosition:'family',speechStyle:'casual',
 genre:'발라드',mood:'따뜻한',eraPreference:'1980s',lyricLength:'full'};
const orderId='withu_'+'a'.repeat(32);
const session={orderId,link:'/'};
const sameLyrics='[Verse 1]\n엄마와 걸었던 길\n[Chorus]\n언제나 고마웠어요\n[Verse 2]\n이제야 알 것 같아';
const duo={mode:'different',genres:['발라드','재즈']};
const prefs=[{mood:'애절한',eraPreference:'1990s'},
 {mood:'희망찬',eraPreference:'2020s'}];

test('one shared approved lyric with distinct, verified style for each purchased song',()=>{
 const draft=prepareServerOrderDraft({
  selectedProduct:'audio_duo',genreSelection:duo,story,trackPreferences:prefs
 });
 assert.deepEqual(draft.trackPreferences,prefs);
 assert.equal(draft.songStyles.length,2);
 assert.match(draft.songStyles[0].style,/Chosen genre: 발라드/);
 assert.match(draft.songStyles[1].style,/Chosen genre: 재즈/);
 assert.match(draft.songStyles[0].style,/1990s/);
 assert.match(draft.songStyles[1].style,/2020s/);
 assert.match(draft.songStyles[0].style,/dramatic/i);
 assert.match(draft.songStyles[1].style,/dramatic/i);
 assert.equal(draft.amountBreakdown.amountKrw,39000,'Per-track style picks do not cost extra');
 const plan=buildSongProductionPlan({
  productId:'audio_duo',genreSelection:duo,trackPreferences:prefs,
  confirmedLyrics:sameLyrics,songTitle:'엄마에게',
  mood:'따뜻한',eraPreference:'1980s',story
 });
 assert.deepEqual(plan.songs.map(s=>s.lyrics),[sameLyrics,sameLyrics]);
 assert.deepEqual(plan.songs.map(s=>s.mood),['애절한','희망찬']);
 assert.deepEqual(plan.songs.map(s=>s.eraPreference),['1990s','2020s']);
 assert.notEqual(plan.songs[0].stylePrompt,plan.songs[1].stylePrompt);
 assert.ok(plan.songs.every(s=>s.stylePrompt.length<=1000));
 const publicUi=read('docs/checkout.js');
 assert.ok(publicUi.includes('trackPreferences:trackPreferences()'));
 assert.ok(!publicUi.includes('stylePrompt'));
 const backend=read('src/production-admin.mjs');
 assert.match(backend,/confirmedLyrics:commonLyrics/);
 assert.match(backend,/tracks\[k\]=\{\.\.\.tracks\[k\],lyrics:commonLyrics\}/);
});
test('wrong count and invalid genre-era-mood combinations fail closed on backend',()=>{
 const baseline={mood:'따뜻한',eraPreference:'auto'};
 assert.deepEqual(normalizeTrackPreferences('audio',undefined,baseline),[baseline]);
 for(const values of [
  [prefs[0]],[],[prefs[0],{mood:'임의의 감정',eraPreference:'1990s'}],
  [prefs[0],{mood:'따뜻한',eraPreference:'2030s'}]
 ])assert.throws(()=>normalizeTrackPreferences('audio_duo',values,baseline));
 assert.throws(()=>prepareServerOrderDraft({
  selectedProduct:'audio_duo',genreSelection:duo,story,
  trackPreferences:[prefs[0]]
 }));
});
test('shareable gift access is order-scoped and repeat licensed downloads never consume a counter',()=>{
 const token=makeOpaqueToken();
 const url=linkUrl({WITHU_PUBLIC_BASE_URL:'https://music.example/'},token);
 assert.equal(url,'https://music.example/gift.html#delivery='+token);
 assert.match(tokenHash(token),/^[a-f0-9]{64}$/);
 const order={
  id:orderId,paymentStatus:'paid',
  delivery:{status:'sent'},
  productId:'audio',tracks:[{
   index:1,storagePath:'orders/'+orderId+'/tracks/1.mp3',
   title:'소중한 날',genre:'발라드',lyrics:sameLyrics,
   reviewed:true,ext:'mp3'
  }],
  upgrade:{paymentStatus:'paid',rightsVerified:true}
 };
 const media=customerResponse(order);
 assert.equal(media.track.commercialUpgrade.status,'active');
 assert.match(media.track.privateDownloadUrl,/^\/api\/delivery-downloads\//);
 assert.equal(authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:orderId,order,kind:'download'
 }),true);
 assert.equal(authorizeOrderMedia({
  sessionOrderId:orderId,assetOrderId:orderId,order,kind:'download'
 }),true,'Repeated download does not use up a purchased entitlement');
 const otherId='withu_'+'b'.repeat(32);
 assert.throws(()=>authorizeOrderMedia({
  sessionOrderId:otherId,assetOrderId:orderId,order,kind:'download'
 }));
});
test('guest comments are plain text, length-bounded and not automatically public',()=>{
 assert.deepEqual(validateGiftComment({nickname:'  나의 친구 ',text:'진짜 감동했어요!'}),
  {nickname:'나의 친구',text:'진짜 감동했어요!'});
 for(const input of [
  {nickname:'',text:'정말 좋아요'},
  {nickname:'a'.repeat(25),text:'정말 좋아요'},
  {nickname:'친구',text:'a'},
  {nickname:'친구',text:'b'.repeat(301)},
  {nickname:'친구',text:'<script>alert(1)</script>'},
  {nickname:'친구',text:'https://spam.example'},
  {nickname:'<img>',text:'안녕하세요'}
 ])assert.throws(()=>validateGiftComment(input));
 const backend=read('src/production-comments.mjs');
 assert.match(backend,/status:'pending'/);
 assert.match(backend,/status==='published'/);
 assert.match(backend,/await admin\(req,auth,env\)/);
 assert.match(backend,/withuCommentLimits/);
 assert.ok(!read('docs/my-music.html').includes('stylePrompt'));
});
test('gift opening page requires existing order-scoped link and preserves no public song files',()=>{
 const html=read('docs/gift.html');
 const js=read('docs/gift.js');
 assert.match(html,/id="gift-open"/);
 assert.match(html,/id="gift-share"/);
 assert.match(js,/\/api\/delivery\/gift-preview/);
 assert.match(js,/my-music\.html#delivery=/);
 assert.match(js,/navigator\.share/);
 assert.match(js,/^[\s\S]*?\[A-Za-z0-9_-\]/);
 assert.match(read('src/production-delivery.mjs'),/\/api\/delivery\/share-link/);
 assert.match(read('src/production-delivery.mjs'),/\/api\/delivery\/gift-preview/);
 for(const id of ['gift-share-native','gift-share-copy','gift-share-instagram',
  'gift-share-tiktok','gift-share-card','gift-comments-section','gift-comment-form']){
  assert.ok(read('docs/my-music.html').includes('id="'+id+'"'),id);
 }
 assert.match(read('docs/song.js'),/privateShareUrl/);
});
test('gift preview rejects unrelated leaked tokens and reveals only recipient nickname',async()=>{
 const token=makeOpaqueToken(),hash=tokenHash(token);
 const order={
  id:orderId,paymentStatus:'paid',paymentKey:'pay_123456',
  paymentVerifiedAt:123456,delivery:{status:'sent',tokenHash:hash},
  productId:'audio',draft:{story:{recipient:'엄마',memory:'비공개 사연'}},
  tracks:[{
   index:1,storagePath:'orders/'+orderId+'/tracks/1.mp3',
   title:'엄마에게',lyrics:sameLyrics,reviewed:true
  }]
 };
 const database={
  collection(name){
   if(name==='withuLinks')return {doc:doc=>({
    get:async()=>({exists:doc===hash,
     data:()=>({revoked:false,expiresAt:Date.now()+60000,orderId})})
   })};
   if(name==='withuOrders')return {doc:doc=>({
    get:async()=>({exists:doc===orderId,data:()=>order})
   })};
   throw Error('Unexpected private store '+name);
  }
 };
 function request(k){
  return {
   method:'POST',url:'/api/delivery/gift-preview',
   originalUrl:'/api/delivery/gift-preview',
   headers:{origin:'https://music.example'},
   get(n){return this.headers[n.toLowerCase()]},
   is(type){return type==='application/json'},
   body:{token:k},rawBody:Buffer.from(JSON.stringify({token:k}))
  };
 }
 function response(){
  return {
   statusCode:200,headers:{},
   set(k,v){this.headers[k]=v;return this},
   status(code){this.statusCode=code;return this},
   json(data){this.data=data;return this}
  };
 }
 const res=response();
 assert.equal(await handleProductionDelivery(request(token),res,{
  db:database,env:{WITHU_PUBLIC_BASE_URL:'https://music.example'},
  fetcher:fetch
 }),true);
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.data,{status:'ready',recipient:'엄마'});
 assert.ok(!JSON.stringify(res.data).includes('비공개 사연'));
 await assert.rejects(()=>handleProductionDelivery(request(makeOpaqueToken()),response(),{
  db:database,env:{WITHU_PUBLIC_BASE_URL:'https://music.example'}
 }),/유효하지 않거나/);
});

test('vertical social gift card is generated locally without exporting private audio',()=>{
 const code=read('docs/song.js');
 assert.match(code,/canvas\.width=1080;canvas\.height=1920/);
 assert.match(code,/WITHU-gift-story\.png/);
 assert.doesNotMatch(code,/canvas\.captureStream|MediaRecorder/);
 assert.match(code,/인스타그램·틱톡의 링크 스티커/);
});
