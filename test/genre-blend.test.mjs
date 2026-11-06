import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeGenreSelection,buildSongProductionPlan} from '../src/song-production-plan.mjs';
import {quoteOrderAmount} from '../src/order-pricing.mjs';
import {prepareServerOrderDraft} from '../src/order-draft-preparation.mjs';
import {validateLyricInput,buildLyricPrompt} from '../src/lib.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const checkout=read('docs/checkout.js');
const checkoutPage=read('docs/checkout.html');
const payment=read('docs/payment.js');
const catalog=JSON.parse(read('docs/prices.json'));
const story={
 recipient:'엄마',occasion:'감사',memory:'어렸을 때 나를 늦은 밤까지 기다려 주었어요.',
 message:'사랑해요',gratitudeApology:'고마워요',recipientAgeGroup:'50s',
 relativePosition:'family',speechStyle:'polite',genre:'발라드',
 mood:'감동적인',eraPreference:'1980s',lyricLength:'full'
};

test('family, friend and lover are selectable relationship categories, including legacy keys',()=>{
 const html=read('docs/create.html');
 for(const [value,label] of [
  ['family','가족'],['friend','친구'],['lover','연인'],['spouse','배우자'],
  ['colleague','직장동료'],['mentor','스승'],['other','그 밖의 관계']
 ]){
  assert.ok(html.includes('value="'+value+'"'),value);
  assert.ok(html.includes(label),label);
  assert.equal(validateLyricInput({...story,relativePosition:value}).delivery.relativePosition,value);
 }
 assert.equal(validateLyricInput({...story,relativePosition:'older'}).delivery.relativePosition,'older');
 assert.match(buildLyricPrompt(validateLyricInput(story)),/family/);
 assert.match(buildLyricPrompt(validateLyricInput(story)),/speechStyle/);
 assert.throws(()=>validateLyricInput({...story,relativePosition:'invalid'}),/관계/);
});

test('catalog contains one 5000 KRW per-order option, no fake reference price',()=>{
 assert.equal(catalog.addOns.genreBlend.amountKrw,5000);
 assert.equal(catalog.addOns.genreBlend.chargeUnit,'per_order');
 assert.ok(!JSON.stringify(catalog).includes('referencePrice'));
 assert.ok(!checkoutPage.includes('100,000원'));
 assert.ok(checkoutPage.includes('58,000원'));
 assert.ok(checkoutPage.includes('39,000원'));
 assert.ok(checkoutPage.includes('맞춤 가사 + MP3 음원'));
});
test('server quote recomputes total from selected product and blend, not browser price',()=>{
 assert.equal(quoteOrderAmount({
  productId:'audio',genreSelection:{mode:'single',genres:['발라드']}
 }).amountKrw,29000);
 assert.equal(quoteOrderAmount({
  productId:'audio',genreSelection:{mode:'blend',genres:['발라드','재즈']}
 }).amountKrw,34000);
 assert.deepEqual(quoteOrderAmount({
  productId:'audio_duo',genreSelection:{mode:'blend',genres:['발라드','재즈']}
 }),{
  productId:'audio_duo',baseAmountKrw:39000,blendAddOnKrw:5000,
  thirdVerseAddOnKrw:0,dedicationAddOnKrw:0,
  amountKrw:44000,priceKind:'fixed',quoteRequired:false,currency:'KRW'
 });
 assert.equal(quoteOrderAmount({
  productId:'audio_duo',genreSelection:{mode:'different',genres:['재즈','트로트']}
 }).amountKrw,39000);
 assert.equal(quoteOrderAmount({
  productId:'audio_video',genreSelection:{mode:'blend',genres:['발라드','재즈']}
 }).amountKrw,305000);
 assert.throws(()=>quoteOrderAmount({
  productId:'audio',genreSelection:{mode:'blend',genres:['재즈','재즈']}
 }),/blend/);
 assert.throws(()=>quoteOrderAmount({
  productId:'audio_duo',genreSelection:{mode:'blend',genres:['트로트']}
 }),/genres/);
});

test('a mixed single track and both mixed duo tracks carry protected genre pair in style plan',()=>{
 const lyrics='[Verse 1]\n언제나 곁에서 기다리던 엄마\n[Chorus]\n엄마를 사랑해';
 const base={songTitle:'엄마에게',confirmedLyrics:lyrics,mood:'감동적인',
  eraPreference:'1980s',story,sharedStyleNotes:''};
 const one=buildSongProductionPlan({
  ...base,productId:'audio',genreSelection:{mode:'blend',genres:['발라드','재즈']}
 });
 assert.equal(one.songs.length,1);
 assert.deepEqual(one.songs[0].blendGenres,['발라드','재즈']);
 assert.match(one.songs[0].stylePrompt,/Chosen genre: 발라드/);
 assert.match(one.songs[0].stylePrompt,/Blend in 재즈/);
 const two=buildSongProductionPlan({
  ...base,productId:'audio_duo',genreSelection:{mode:'blend',genres:['발라드','재즈']}
 });
 assert.equal(two.songs.length,2);
 assert.ok(two.songs.every(s=>s.blendGenres.length===2));
 assert.ok(two.songs.every(s=>s.stylePrompt.length<=1000));
 assert.notEqual(two.songs[0].stylePrompt,two.songs[1].stylePrompt);
 const draft=prepareServerOrderDraft({
  selectedProduct:'audio_duo',
  genreSelection:{mode:'blend',genres:['발라드','재즈']},
  story
 });
 assert.equal(draft.amountBreakdown.amountKrw,44000);
 assert.equal(draft.songStyles.length,2);
 assert.equal(draft.generatedLyrics,null);
 assert.match(draft.lyricPrompt,/재즈/);
});
test('checkout preserves earlier genre instead of asking again and shows optional mixed genre',()=>{
 assert.ok(checkoutPage.includes('selected-primary-genre'));
 assert.match(checkout,/const first=\[draft\?\.genre,old\?\.first/);
 assert.match(checkout,/single-genre-blend/);
 assert.match(checkoutPage,/id="duo-mode-blend"/);
 assert.match(checkout,/mode:'blend',genres:\[first,second\]/);
 assert.match(checkout,/totalText\(\)/);
 assert.match(payment,/mode==='blend'\?catalog\.addOns\.genreBlend\.amountKrw:0/);
 assert.ok(!checkoutPage.includes('id="song-genre-first-tiles" role="group" aria-label="첫 번째 완성곡 장르 선택"'));
});
