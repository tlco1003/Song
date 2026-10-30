import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSong,validateLyricInput,buildMusicPrompt,buildLyricPrompt} from '../src/lib.mjs';
const story='우리가 처음 만난 봄날을 기억하며 너에게 고맙다고 말하고 싶어';
const base={story,genre:'발라드',mood:'따뜻한',voiceId:'voiceABC123'};
test('validates lyric draft request',()=>assert.equal(validateLyricInput(base).mood,'따뜻한'));
test('rejects out of range lyric draft',()=>assert.throws(()=>validateSong({...base,lyrics:'가'.repeat(1401)}),/1400/));
test('lyric generation receives story',()=>assert.ok(buildLyricPrompt(base).includes(JSON.stringify(story))));
test('custom lyrics are passed to composition verbatim',()=>{
 const lyrics='[Verse]\n너와 함께한 날\n[Chorus]\n우리의 봄날';
 const result=validateSong({...base,lyrics});
 assert.equal(result.lyrics,lyrics);
 assert.ok(buildMusicPrompt(result).includes('Lyrics:\n'+lyrics));
});
test('empty custom lyric falls back to story generation',()=>assert.match(buildMusicPrompt(base),/Write original short Korean lyrics/));
