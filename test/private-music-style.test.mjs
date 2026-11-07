import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {composeServerMusicStyle,resolveEraChoice,GENRE_KEYS,ERA_KEYS} from '../src/music-style-library.mjs';
import {buildSongProductionPlan,publicMusicGenres} from '../src/song-production-plan.mjs';
import {validateLyricInput,buildLyricPrompt} from '../src/lib.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('docs/create.html'),script=read('docs/create.js');
const checkout=read('docs/checkout.html'),checkoutJs=read('docs/checkout.js');
const genres=JSON.parse(read('docs/music-genres.json'));

test('public genre catalog has labels only and no music style or music prompt leakage',()=>{
 assert.equal(genres.version,2);
 assert.deepEqual(genres.genres,publicMusicGenres());
 assert.equal(genres.genres.length,GENRE_KEYS.length);
 for(const g of genres.genres){
  assert.equal(g.id,g.label);
  assert.deepEqual(Object.keys(g).sort(),['id','label']);
 }
 for(const text of [read('docs/music-genres.json'),page,script,checkout,checkoutJs,read('docs/payment.js')]){
  assert.doesNotMatch(text,/piano-led ballad|brushed drums, upright bass|independently composed melody|STYLE \(quoted data|stylePrompt/);
 }
 assert.ok(!page.includes('id="song-style"'));
 assert.ok(!page.includes('id="copy-style"'));
 assert.ok(!page.includes('id="song-lyrics"'));
 assert.ok(!page.includes('id="copy-lyrics"'));
 assert.ok(!page.includes('id="review-recipient"'));
 assert.ok(checkout.includes('id="order-memory"'));
 assert.ok(checkout.includes('id="order-occasion"'));
 assert.ok(!page.includes('id="song-lyrics-preview"'));
 assert.ok(!page.includes('id="generate-lyrics"'));
 assert.ok(!checkout.includes('id="order-lyrics"'));
});
test('creation shows all seven genre tiles, moods and preferred eras at once',()=>{
 for(const g of GENRE_KEYS)assert.ok(page.includes('name="genreChoice" value="'+g+'"'));
 for(const mood of ['따뜻한','감동적인','설레는','애절한','희망찬','신나는']){
  assert.ok(page.includes('name="moodChoice" value="'+mood+'"'));
 }
 for(const era of ERA_KEYS){
  assert.ok(page.includes('name="eraChoice" value="'+era+'"'));
 }
 assert.match(checkout,/id="song-genre-first-tiles"/);
 assert.match(checkout,/id="song-genre-second-tiles"/);
 assert.match(checkoutJs,/label\.className='music-choice'/);
 assert.match(checkoutJs,/radio\.addEventListener\('change'/);
 assert.match(checkoutJs,/x\.label!==x\.id/);
});
test('age is just a default era heuristic; user era override always wins',()=>{
 assert.equal(resolveEraChoice({recipientAgeGroup:'40s'}),'1990s');
 assert.equal(resolveEraChoice({recipientAgeGroup:'60s'}),'1970s');
 assert.equal(resolveEraChoice({recipientAgeGroup:'unknown'}),'none');
 assert.equal(resolveEraChoice({recipientAgeGroup:'60s',eraPreference:'2020s'}),'2020s');
 assert.equal(resolveEraChoice({recipientAgeGroup:'60s',eraPreference:'none'}),'none');
 assert.throws(()=>resolveEraChoice({eraPreference:'bad-era'}),/Unsupported/);
});
test('trusted server production plan combines genre, mood and listener era without exposing to browser',()=>{
 const order={
  productId:'audio_duo',genreSelection:{mode:'different',genres:['재즈','트로트']},
  songTitle:'함께한 시간',confirmedLyrics:'우리가 함께 걷던 길을 기억해요.',
  mood:'감동적인',story:{recipientAgeGroup:'50s',speechStyle:'polite'},
  eraPreference:'2000s'
 };
 const p=buildSongProductionPlan(order);
 assert.equal(p.version,2);
 assert.equal(p.songs.length,2);
 assert.match(p.songs[0].stylePrompt,/Chosen genre: 재즈/);
 assert.match(p.songs[1].stylePrompt,/Chosen genre: 트로트/);
 assert.match(p.songs[0].stylePrompt,/2000s|Historic Korean mainstream pop/);
 assert.doesNotMatch(JSON.stringify(genres),/2000s|Historic Korean mainstream pop/);
});
test('private Markdown style files are loaded only on server; missing private file fails closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'withu-style-test-'));
 try{
  for(const name of ['genre','era','mood'])mkdirSync(join(dir,name));
  writeFileSync(join(dir,'genre','ballad.md'),'PRIVATE GENRE RECIPE FOR BALLAD: original harmonic trajectory and instrumentation');
  writeFileSync(join(dir,'era','1990s.md'),'PRIVATE 1990S RECIPE: era context without song imitation');
  writeFileSync(join(dir,'mood','warm.md'),'PRIVATE WARM RECIPE: balanced intimacy and vocal clarity');
  const s=composeServerMusicStyle({
   genre:'발라드',mood:'따뜻한',eraPreference:'1990s'
  },{privateDirectory:dir});
  assert.match(s,/PRIVATE GENRE RECIPE/);
  assert.match(s,/PRIVATE 1990S RECIPE/);
  assert.match(s,/PRIVATE WARM RECIPE/);
  assert.doesNotMatch(read('docs/create.js'),/PRIVATE GENRE RECIPE/);
  assert.throws(()=>composeServerMusicStyle({
   genre:'재즈',mood:'따뜻한',eraPreference:'1990s'
  },{privateDirectory:dir}),/Private style recipe is not configured/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('era choice reaches private lyric prompt validation, not public style strings',()=>{
 const input={
  recipient:'엄마',memory:'함께 산책했던 밤의 꽃길이 생각나요.',
  message:'정말 고마워요',gratitudeApology:'',occasion:'감사',
  recipientAgeGroup:'60s',relativePosition:'older',speechStyle:'polite',
  genre:'발라드',mood:'따뜻한',eraPreference:'1980s',lyricLength:'full'
 };
 const validated=validateLyricInput(input);
 assert.equal(validated.eraPreference,'1980s');
 const privatePrompt=buildLyricPrompt(validated);
 assert.match(privatePrompt,/시대 선택: 1980s/);
 assert.throws(()=>validateLyricInput({...input,eraPreference:'wrong'}),/시대 선택/);
});

test('the server only varies musical arrangement for bought emotional-arc options',()=>{
 const one=composeServerMusicStyle({genre:'발라드',mood:'감동적인',eraPreference:'1980s',thirdVerse:true});
 const two=composeServerMusicStyle({genre:'재즈',mood:'따뜻한',eraPreference:'none',dedicationOutro:true});
 assert.match(one,/pivotal Verse 3/);
 assert.match(two,/quiet, spacious Outro/);
 assert.ok(one.length<=1000&&two.length<=1000);
 assert.throws(()=>composeServerMusicStyle({genre:'재즈',thirdVerse:'yes'}),/emotional arc/);
});

test('all genre, era and mood combinations retain purchased emotional arcs within 1000 characters',()=>{
 const moods=['따뜻한','감동적인','설레는','애절한','희망찬','신나는'];
 for(const genre of GENRE_KEYS){
  for(const eraPreference of ERA_KEYS){
   for(const mood of moods){
    for(const thirdVerse of [false,true]){
     for(const dedicationOutro of [false,true]){
      const base={genre,mood,eraPreference,thirdVerse,dedicationOutro};
      const first=composeServerMusicStyle(base);
      assert.ok(first.length<=1000,JSON.stringify(base));
      assert.ok(!thirdVerse||first.includes('Verse 3'),JSON.stringify(base));
      assert.ok(!dedicationOutro||first.includes('Outro'),JSON.stringify(base));
      // The second track and cross-genre blend cost more prompt space.
      const other=GENRE_KEYS[(GENRE_KEYS.indexOf(genre)+1)%GENRE_KEYS.length];
      const blended=composeServerMusicStyle({
       ...base,mode:'blend',blendGenre:other,songIndex:2
      });
      assert.ok(blended.length<=1000,JSON.stringify(base));
      assert.ok(!thirdVerse||blended.includes('Verse 3'),JSON.stringify(base));
      assert.ok(!dedicationOutro||blended.includes('Outro'),JSON.stringify(base));
     }
    }
   }
  }
 }
});
