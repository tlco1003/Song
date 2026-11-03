import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateLyricInput,validateSong,buildLyricPrompt,buildMusicPrompt,lyricPolicy} from '../src/lib.mjs';

const base={
  recipient:'엄마',
  memory:'항상 열심히 일하고 사람들에게 배려하는 모습, 사랑으로 안아주는 모습',
  message:'언제나 내 마음속엔 엄마가 최고야. 엄마 딸이라서 다행이야.',
  gratitudeApology:'나를 먼저 생각해 주는 한없는 사랑에 감사해.',
  occasion:'감사',
  genre:'발라드',
  mood:'감동적인',
  lyricLength:'full'
};
test('canonical Korean prompt is read from real repository file',()=>{
  assert.equal(lyricPolicy,readFileSync(new URL('../가사 프롬프트.md',import.meta.url),'utf8'));
  for(const phrase of ['그랬을까','헤아려','꾸밈','기억','후렴'])assert.ok(lyricPolicy.includes(phrase),phrase);
});
test('all five customer answers survive server validation',()=>{
  const val=validateLyricInput(base);
  for(const name of ['recipient','memory','message','gratitudeApology','occasion'])assert.equal(val.brief[name],base[name]);
  const prompt=buildLyricPrompt(val);
  for(const name of ['recipient','memory','message','gratitudeApology','occasion'])assert.ok(prompt.includes(base[name]),name);
  assert.match(prompt,/3~4분/);
});
test('optional anecdote may be blank but must not be invented by server',()=>{
  const val=validateLyricInput({...base,memory:''});
  assert.equal(val.brief.memory,'');assert.match(val.story,/미입력/);
});
test('invalid recipient and occasion are rejected',()=>{
  assert.throws(()=>validateLyricInput({...base,recipient:''}),/상대방/);
  assert.throws(()=>validateLyricInput({...base,occasion:'가짜 상황'}),/선물/);
});
test('long lyric does not silently enter the 30-second audio pipeline',()=>{
  assert.throws(()=>validateSong({...base,voiceId:'voiceABC123'}),/30초/);
});
test('short lyric keeps user wording for provider music prompt',()=>{
  const val=validateSong({...base,lyricLength:'short',voiceId:'voiceABC123',lyrics:'[Verse]\n엄마의 눈빛\n[Chorus]\n엄마 딸이라 다행이야'});
  assert.match(buildMusicPrompt(val),/엄마의 눈빛/);
  assert.match(buildMusicPrompt(val),/엄마 딸이라 다행이야/);
});
