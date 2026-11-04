import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('docs/index.html');
const css=read('docs/style.css');
const js=read('docs/player.js');
const tracks=JSON.parse(read('docs/media/tracks.json'));
const reviews=JSON.parse(read('docs/reviews/reviews.json'));

test('WITHU first screen leads with premium handwritten listening UI',()=>{
  assert.match(html,/<title>WITHU/);
  assert.match(html,/Nanum\+Brush\+Script/);
  assert.match(html,/Gowun\+Batang/);
  assert.match(css,/Cormorant Garamond/);
  assert.ok(html.indexOf('id="top"')<html.indexOf('id="gifts"'));
  assert.ok(html.indexOf('class="listening-section"')<html.indexOf('class="gift-section"'));
  assert.match(html,/id="lyrics-content"/);
});
test('no proprietary process, provider name, source code links or five questions in public HTML',()=>{
  assert.doesNotMatch(html,/Suno|Gemini|GPT|OpenAI|github\.com|프로젝트 살펴보기|다섯 가지 물음|FIVE QUESTIONS|Verse\s*\d/);
  assert.doesNotMatch(html,/상대방을 어떻게 부르나요/);
  assert.match(html,/마음이 머무는 곳에/);
});
test('three user-provided songs have lyrics files matched to track IDs',()=>{
  assert.deepEqual(tracks.tracks.map(t=>t.title),['나라는 사람','구태환에게','내사랑김정미']);
  assert.deepEqual(tracks.tracks.map(t=>t.file),['nara.mp3','taehwan.mp3','jeongmi.mp3']);
  for(const t of tracks.tracks){
    assert.match(t.sunoId,/^[0-9a-f-]{36}$/);
    assert.match(t.lyricsFile,/^lyrics-[a-z]+\.txt$/);
    const lyrics=read('docs/media/'+t.lyricsFile);
    assert.ok(lyrics.length>400);
  }
  assert.match(read('docs/media/lyrics-nara.txt'),/하나님께 감사드려요/);
  assert.match(read('docs/media/lyrics-taehwan.txt'),/금호동 집에서/);
  assert.match(read('docs/media/lyrics-jeongmi.txt'),/정미야, 네가 있어 참 다행이야/);
});
test('playlist controls and private local upload controls are connected to new JS',()=>{
  for(const id of ['previous-track','next-track','music-audio','embedded-player','track-list','local-song','local-lyrics','lyrics-scroll','copy-lyrics','local-review','review-gallery']){
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes("'"+id+"'"),id+' not used by JS');
  }
  assert.match(html,/내 기기에서만/);
  assert.doesNotMatch(html,//upload/main/docs/media/);
});
test('reviews show only files with confirmed consent',()=>{
  assert.deepEqual(reviews.reviews,[]);
  assert.match(js,/consentConfirmed===true/);
  assert.match(html,/공개에 동의한/);
});
