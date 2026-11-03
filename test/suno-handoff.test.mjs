import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeStoryInput,validateLyricInput,buildLyricPrompt,buildSunoPackage,genres} from '../src/lib.mjs';
import {createApp} from '../src/server.mjs';

const mother={
  recipient:'엄마',
  memory:'열심히 일하고 다른 사람들을 배려하고 나를 안아주시던 모습',
  message:'엄마의 딸이라서 다행이야. 내 마음속에 엄마가 최고야',
  gratitudeApology:'말없이 나를 살펴주시고 사랑해 주셔서 참 고마워',
  occasion:'감사',
  genre:'발라드',
  mood:'따뜻한',
  lyricLength:'full'
};

test('five original gift questions survive age/register extensions',()=>{
  const info=normalizeStoryInput({...mother,recipientAgeGroup:'60s',relativePosition:'older',speechStyle:'casual'});
  assert.equal(info.brief.recipient,'엄마');
  assert.equal(info.brief.memory,mother.memory);
  assert.equal(info.brief.message,mother.message);
  assert.equal(info.brief.gratitudeApology,mother.gratitudeApology);
  assert.equal(info.brief.occasion,'감사');
  assert.deepEqual(info.delivery,{recipientAgeGroup:'60s',relativePosition:'older',speechStyle:'casual'});
});

test('recipient seniority never forces honorifics against chosen casual register',()=>{
  const input=validateLyricInput({...mother,recipientAgeGroup:'70plus',relativePosition:'older',speechStyle:'casual'});
  const prompt=buildLyricPrompt(input);
  assert.match(prompt, /평소 실제로 그 사람에게 쓰는 말투/);
  assert.match(prompt, /무조건 존댓말이 아니다/);
  assert.match(prompt, /"speechStyle":"casual"/);
  assert.match(prompt, /"relativePosition":"older"/);
});

test('peer may choose polite register and unknown defaults are safe',()=>{
  const polite=validateLyricInput({...mother,relativePosition:'peer',speechStyle:'polite'});
  assert.match(buildLyricPrompt(polite),/"speechStyle":"polite"/);
  assert.deepEqual(normalizeStoryInput(mother).delivery,{
    recipientAgeGroup:'unknown',relativePosition:'unknown',speechStyle:'auto'
  });
});

test('reject invalid age, seniority and speech levels',()=>{
  assert.throws(()=>validateLyricInput({...mother,recipientAgeGroup:'300s'}),/나이대/);
  assert.throws(()=>validateLyricInput({...mother,relativePosition:'boss'}),/관계/);
  assert.throws(()=>validateLyricInput({...mother,speechStyle:'formalOnly'}),/말투/);
});

test('Suno Custom handoff uses approved lyrics exactly and never claims API generation',()=>{
  const lyrics='[Verse 1]\n엄마, 그땐 난 몰랐어\n[Chorus]\n내 마음속엔 언제나 엄마가 최고야';
  const pack=buildSunoPackage({...mother,lyrics,speechStyle:'polite'});
  assert.equal(pack.provider,'suno');
  assert.equal(pack.mode,'manual-custom-handoff');
  assert.equal(pack.apiConnected,false);
  assert.equal(pack.lyrics,lyrics);
  assert.equal(pack.sunoUrl,'https://suno.com/create');
  assert.match(pack.stylePrompt,/piano-led ballad/);
  assert.match(pack.stylePrompt,/polite Korean/);
});

test('Suno handoff validates lyric content, accepts jazz and never invents output',()=>{
  assert.ok(genres.includes('재즈'));
  assert.throws(()=>buildSunoPackage({...mother,lyrics:''}),/12자/);
  const pack=buildSunoPackage({...mother,genre:'재즈',lyrics:'[Verse]\n나를 생각해 주었던 너에게 고마워'});
  assert.match(pack.stylePrompt,/vocal jazz/);
});

test('client preserves five original exact Korean questions and speech choice',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  for(const phrase of [
    '상대방을 어떻게 부르나요?',
    '그 사람과의 추억의 장소나 있었던 일이 있나요?',
    '그 사람에게 해주고 싶은 말이 있나요?',
    '미안했던 일이나 고마웠던 일을 이야기해주세요.',
    '어떤 상황에 보내는 노래인가요?',
    '평소 그 사람에게 어떤 말투로 이야기하나요?'
  ])assert.ok(html.includes(phrase),phrase);
  assert.ok(html.includes('id="sunoLyrics"') && html.includes('id="sunoStyle"'));
});

test('HTTP Suno handoff works without paid provider access',async(t)=>{
  const app=createApp();
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const res=await fetch('http://127.0.0.1:'+app.address().port+'/api/suno-package',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...mother,lyrics:'[Verse]\n엄마 항상 고마워\n[Chorus]\n엄마 딸이라 다행이야'})
  });
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.apiConnected,false);
  assert.match(result.stylePrompt,/Korean/);
});
