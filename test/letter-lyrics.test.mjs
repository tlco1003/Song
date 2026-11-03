import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStoryInput, validateLyricInput, validateSong,
  buildLyricPrompt, buildMusicPrompt, lyricPolicy
} from '../src/lib.mjs';

const gift = {
  recipient: '엄마',
  memory: '항상 열심히 일하고 사람들을 배려하는 모습, 나를 사랑으로 안아주던 모습',
  message: '내 마음속엔 늘 엄마가 최고야. 엄마 딸이라서 다행이야',
  gratitudeApology: '나를 생각해 주는 한없는 사랑에 감사합니다',
  occasion: '감사',
  genre: '발라드',
  mood: '따뜻한',
  lyricLength: 'full'
};

test('five user answers are preserved in the generated lyric prompt', () => {
  const normalized = validateLyricInput(gift);
  assert.deepEqual(normalized.brief, {
    recipient: gift.recipient,
    memory: gift.memory,
    message: gift.message,
    gratitudeApology: gift.gratitudeApology,
    occasion: gift.occasion
  });
  const prompt = buildLyricPrompt(normalized);
  for (const key of ['recipient','memory','message','gratitudeApology','occasion']) {
    assert.ok(prompt.includes(gift[key]), key + ' was omitted from the LLM prompt');
  }
  assert.match(prompt, /3~4분/);
});

test('single policy file controls the lyric prompt and instructs old models clearly', () => {
  const prompt = buildLyricPrompt(validateLyricInput(gift));
  assert.ok(prompt.startsWith(lyricPolicy));
  for (const phrase of ['기:', '승:', '전:', '결:', '그랬을까', '상대의 마음', '꾸밈말', '실제로']) {
    assert.ok(prompt.includes(phrase), 'missing policy rule: ' + phrase);
  }
});

test('omitted details are not silently substituted with fabricated memories', () => {
  const normalized = validateLyricInput({...gift,memory:''});
  assert.equal(normalized.brief.memory, '');
  assert.match(normalized.story, /미입력/);
  assert.match(buildLyricPrompt(normalized), /미입력/);
});

test('required recipient and occasion are validated', () => {
  assert.throws(()=>validateLyricInput({...gift,recipient:''}), /상대방/);
  assert.throws(()=>validateLyricInput({...gift,occasion:'알 수 없음'}), /상황/);
});

test('existing free-form requests continue to work', () => {
  const old = normalizeStoryInput({story:'너에게 전하지 못한 고마운 마음을 노래로 만들고 싶어'});
  assert.equal(old.brief,null);
  assert.match(old.story,/고마운/);
});

test('full lyrics cannot silently be passed to a 30-second music provider', () => {
  assert.throws(()=>validateSong({...gift,voiceId:'voiceABC123',lyrics:'[Verse]\n안녕'}),/30초/);
  const short=validateSong({...gift,lyricLength:'short',voiceId:'voiceABC123',lyrics:'[Verse]\n고마워 엄마\n[Chorus]\n내 마음속 최고야'});
  assert.ok(buildMusicPrompt(short).includes('고마워 엄마'));
});
