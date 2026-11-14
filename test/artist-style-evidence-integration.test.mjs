import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {artistEvidenceKey,readPrivateArtistEvidence,normalizeFavoriteArtist}
 from '../src/artist-style-evidence.mjs';
import {composeServerMusicStyle} from '../src/music-style-library.mjs';
import {prepareServerOrderDraft} from '../src/order-draft-preparation.mjs';
import {buildSongProductionPlan} from '../src/song-production-plan.mjs';

const artist='테스트 뮤지션';
const input={
 selectedProduct:'audio',
 genreSelection:{mode:'single',genres:['재즈']},
 story:{
  recipient:'엄마',memory:'함께 집으로 돌아온 저녁을 기억해요.',
  message:'언제나 사랑해요',gratitudeApology:'감사하다는 말을 전하고 싶었어요.',
  occasion:'감사',recipientAgeGroup:'50s',relativePosition:'older',
  speechStyle:'polite',genre:'재즈',mood:'따뜻한',eraPreference:'1990s',
  favoriteArtist:artist,lyricLength:'full'
 }
};
function sourceProfile(approved=true){
 return {
  schemaVersion:1,approved,approvedBy:'operator-test-uid',
  approvedAt:Date.now()-10000,artistName:artist,
  observation:{
   schemaVersion:1,genreSlug:'jazz',era:'1990s',
   features:{tempoBpm:{min:65,max:90},meter:'4/4',
    instruments:['piano','upright bass','brush drums']},
   sources:[{url:'https://example.org/music-analysis',
    title:'Synthetic Test Music Evidence',type:'analysis'}]
  }
 };
}
test('artist preference is user data and does not expose a singer identity in music generation prompt',()=>{
 const draft=prepareServerOrderDraft(input);
 assert.equal(draft.artistPreference,artist);
 assert.equal(draft.songStyles.length,1);
 assert.match(draft.lyricPrompt,/테스트 뮤지션/);
 assert.match(draft.lyricPrompt,/기존 가수의 가사/);
 assert.doesNotMatch(draft.songStyles[0].style,/테스트 뮤지션/);
 assert.ok(draft.songStyles[0].style.length<=1000);
 const paid=buildSongProductionPlan({
  productId:'audio',genreSelection:input.genreSelection,
  trackPreferences:[{mood:'따뜻한',eraPreference:'1990s'}],
  songTitle:'엄마에게',
  confirmedLyrics:'[Verse 1]\n엄마 고마워요\n[Chorus]\n엄마 사랑해요',
  artistPreference:draft.artistPreference
 });
 assert.ok(paid.songs[0].stylePrompt.length<=1000);
 assert.doesNotMatch(paid.songs[0].stylePrompt,/테스트 뮤지션/);
});
test('approved source observation changes actual server music arrangement without exposing the named artist',()=>{
 const dir=mkdtempSync(join(tmpdir(),'withu-artist-evidence-'));
 try{
  for(const [type,key,content] of [
   ['genre','jazz','Warm intimate jazz trio with soft and clear Korean storytelling.'],
   ['era','1990s','Analog-era small ensemble sound and dynamic phrasing.'],
   ['mood','warm','An intimate reassuring interpretation with thoughtful rests.']
  ]){
   mkdirSync(join(dir,type),{recursive:true});
   writeFileSync(join(dir,type,key+'.md'),content,'utf8');
  }
  mkdirSync(join(dir,'artist-references'),{recursive:true});
  const file=join(dir,'artist-references',
   artistEvidenceKey(artist)+'__jazz__1990s.json');
  writeFileSync(file,JSON.stringify(sourceProfile()),'utf8');
  const result=readPrivateArtistEvidence(dir,{
   artistName:artist,genreSlug:'jazz',era:'1990s'
  });
  assert.equal(result.sourceCount,1);
  assert.match(result.cue,/65-90 BPM/);
  const style=composeServerMusicStyle({
   genre:'재즈',mood:'따뜻한',eraPreference:'1990s',
   artistPreference:artist
  },{privateDirectory:dir});
  assert.match(style,/65-90 BPM/);
  assert.match(style,/upright bass/);
  assert.doesNotMatch(style,/테스트 뮤지션/);
  assert.ok(style.length<=1000);
  assert.equal(readPrivateArtistEvidence(dir,{
   artistName:'다른 가수',genreSlug:'jazz',era:'1990s'
  }),null);
  writeFileSync(file,JSON.stringify(sourceProfile(false)),'utf8');
  assert.throws(()=>readPrivateArtistEvidence(dir,{
   artistName:artist,genreSlug:'jazz',era:'1990s'
  }),/not approved/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unverified and control-character artist data never becomes a provider prompt',()=>{
 assert.throws(()=>normalizeFavoriteArtist('a'.repeat(81)),/Invalid/);
 assert.throws(()=>normalizeFavoriteArtist('가수\n다른 명령'),/Invalid/);
 const draft=prepareServerOrderDraft({...input,story:{
  ...input.story,favoriteArtist:''
 }});
 assert.equal(draft.artistPreference,'');
 assert.doesNotMatch(draft.songStyles[0].style,/Artist reference/);
});
test('public wizard receives only singer name, not secret style prompts',()=>{
 const create=readFileSync(new URL('../docs/create.html',import.meta.url),'utf8');
 const wizard=readFileSync(new URL('../docs/create.js',import.meta.url),'utf8');
 const checkout=readFileSync(new URL('../docs/checkout.js',import.meta.url),'utf8');
 assert.match(create,/id="favoriteArtist"/);
 assert.match(wizard,/favoriteArtist/);
 assert.match(checkout,/order-favoriteArtist/);
 assert.doesNotMatch(create,/source-reviewed arrangement-level reference/);
});
