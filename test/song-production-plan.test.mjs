import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSongProductionPlan,normalizeGenreSelection,publicMusicGenres,verifyPaidSongPlan} from '../src/song-production-plan.mjs';
import {publicPriceCatalog,publicCommerceReadiness} from '../src/commerce.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('docs/checkout.html');
const script=read('docs/checkout.js');
const create=read('docs/create.js');
const createPage=read('docs/create.html');
const server=read('src/server.mjs');
function order(productId,mode,genres){
 return {productId,genreSelection:{mode,genres},songTitle:'엄마에게',
  confirmedLyrics:'엄마 고마워요. 늘 사랑해요.',mood:'따뜻한',
  sharedStyleNotes:'마지막에 하프와 플룻'};
}
test('shared seven-genre catalog matches creation page options and checkout selectors',()=>{
 const genres=publicMusicGenres();
 const data=JSON.parse(read('docs/music-genres.json'));
 assert.deepEqual(genres,data.genres);
 for(const g of genres){
  assert.ok(createPage.includes('name="genreChoice" value="'+g.id+'"'),g.id+' missing from visible genre tiles');
  assert.ok(!Object.hasOwn(g,'style')&&!Object.hasOwn(g,'prompt'),'Public catalog exposed music style');
 }
 assert.ok(page.includes('id="duo-mode-same"'));
 assert.ok(page.includes('id="duo-mode-different"'));
 assert.ok(page.includes('id="song-genre-first"'));
 assert.ok(page.includes('id="song-genre-second"'));
 assert.ok(page.includes('id="song-genre-second-wrap"'));
 assert.ok(page.includes('id="genre-plan-preview"'));
 assert.ok(page.includes('id="order-song-genres"'));
 assert.ok(page.includes('id="song-shared-notes"'));
 assert.match(script,/fetch\('music-genres.json'/);
 assert.ok(server.includes("'/music-genres.json':'docs/music-genres.json'"));
});
test('single audio and video packages retain exactly one genre',()=>{
 for(const product of ['audio','audio_video']){
  const plan=buildSongProductionPlan(order(product,'single',['인디팝']));
  assert.equal(plan.songs.length,1);
  assert.equal(plan.songs[0].genre,'인디팝');
  assert.equal(plan.songs[0].index,1);
 }
});
test('two songs in one genre remain two distinct creative requests',()=>{
 const plan=buildSongProductionPlan(order('audio_duo','same',['어쿠스틱']));
 assert.equal(plan.mode,'same');
 assert.deepEqual(plan.songs.map(s=>s.genre),['어쿠스틱','어쿠스틱']);
 assert.deepEqual(plan.songs.map(s=>s.index),[1,2]);
 assert.equal(plan.songs[0].lyrics,plan.songs[1].lyrics);
 assert.notEqual(plan.songs[0].stylePrompt,plan.songs[1].stylePrompt);
 assert.match(plan.songs[1].stylePrompt,/independently composed melody/i);
});
test('two different user genres yield correctly distinct style prompts',()=>{
 const plan=buildSongProductionPlan(order('audio_duo','different',['트로트','R&B']));
 assert.deepEqual(plan.songs.map(s=>s.genre),['트로트','R&B']);
 assert.match(plan.songs[0].stylePrompt,/trot/i);
 assert.match(plan.songs[1].stylePrompt,/R&B/i);
 assert.deepEqual(plan.songs.map(s=>s.title),['엄마에게','엄마에게']);
 assert.ok(plan.songs.every(s=>s.stylePrompt.includes('하프와 플룻')));
});
test('no genre, duplicates in distinct mode and accidental wrong track count must fail closed',()=>{
 for(const selection of [
  {mode:'different',genres:['발라드','발라드']},
  {mode:'different',genres:['발라드']},
  {mode:'same',genres:['발라드','재즈']},
  {mode:'same',genres:[]},
  {mode:'single',genres:['발라드','재즈']},
  {mode:'different',genres:['팝','재즈']},
  null
 ]){
  assert.throws(()=>normalizeGenreSelection('audio_duo',selection));
 }
 assert.throws(()=>normalizeGenreSelection('audio',{mode:'same',genres:['발라드']}));
 assert.throws(()=>buildSongProductionPlan({...order('audio_duo','same',['재즈']),confirmedLyrics:''}));
});
test('paid immutable song plan must match original approved genre choice',()=>{
 const requested=order('audio_duo','different',['발라드','재즈']);
 const paidSongPlan=structuredClone(buildSongProductionPlan(requested));
 assert.deepEqual(verifyPaidSongPlan({...requested,paidSongPlan}),buildSongProductionPlan(requested));
 assert.throws(()=>verifyPaidSongPlan({
  ...requested,genreSelection:{mode:'different',genres:['발라드','트로트']},paidSongPlan
 }),/differs/);
});
test('browser remembers genre choice while real payment and email dispatch remain disabled',()=>{
 assert.match(create,/genre:answers.genre,mood:answers.mood,eraPreference:answers.eraPreference/);
 assert.doesNotMatch(create,/stylePrompt|song-style/);
 assert.ok(!createPage.includes('id="review-genre"'));
 assert.match(page,/id="order-song-genres"/);
 assert.doesNotMatch(createPage,/id="song-lyrics-preview"/);
 assert.match(script,/duoGenreChoice:/);
 assert.match(script,/genreSelection/);
 assert.match(script,/sharedStyleNotes/);
 assert.match(script,/selectedProduct:chosenProduct\(\)/);
 assert.match(script,/sessionStorage\.setItem\(KEY/);
 assert.match(script,/genreLabels\(selection\)/);
 assert.match(script,/first===second/);
 assert.match(page,/href="payment.html"/);
 assert.match(read('docs/payment.html'),/id="confirm-checkout"[^>]*disabled/);
 assert.equal(publicCommerceReadiness().canCharge,false);
 assert.deepEqual(publicPriceCatalog().products.map(x=>x.amountKrw),[29000,39000,300000]);
});
