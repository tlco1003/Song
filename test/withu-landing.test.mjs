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
  assert.match(html,/세상에서 하나뿐인 당신의 노래로,/);
  assert.match(html,/마음을 담은 감동을 선물해요/);
  assert.ok(css.includes('height:126px'));
  assert.ok(js.includes('advanceLyrics'));
  assert.ok(js.includes('filterLyricLines'));
});
test('three user-provided songs have lyrics files matched to track IDs',()=>{
  assert.deepEqual(tracks.tracks.map(t=>t.title),['엄마에게 전하는 노래','나라는 사람','구태환에게','내사랑김정미']);
  assert.equal(tracks.tracks[0].file,'mother-song.mp4');
  assert.equal(tracks.tracks[0].mediaKind,'video');
  assert.deepEqual(tracks.tracks.slice(1).map(t=>t.file),['nara.mp3','taehwan.mp3','jeongmi.mp3']);
  for(const t of tracks.tracks.slice(1)){
    assert.equal(Object.hasOwn(t,'sunoId'),false);
    assert.match(t.lyricsFile,/^lyrics-[a-z]+\.txt$/);
    const lyrics=read('docs/media/'+t.lyricsFile);
    assert.ok(lyrics.length>400);
  }
  assert.match(read('docs/media/lyrics-nara.txt'),/하나님께 감사드려요/);
  assert.match(read('docs/media/lyrics-taehwan.txt'),/금호동 집에서/);
  assert.match(read('docs/media/lyrics-jeongmi.txt'),/정미야, 네가 있어 참 다행이야/);
});
test('playlist controls and private local upload controls are connected to new JS',()=>{
  for(const id of ['previous-track','next-track','music-audio','music-video','no-audio','track-list','local-song','local-lyrics','lyrics-scroll','copy-lyrics','local-review','review-gallery']){
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes("'"+id+"'"),id+' not used by JS');
  }
  assert.match(html,/내 기기에서만/);
  assert.doesNotMatch(html,/embedded-player|embedded-zone|suno.com\/embed/);
  assert.doesNotMatch(js,/suno.com\/embed/);
  assert.match(js,/videoPlayer/);
  assert.match(js,/track\.mediaKind==='video'/);
  assert.equal(html.includes('/upload/main/docs/media'),false);
});
test('reviews show only files with confirmed consent',()=>{
  assert.deepEqual(reviews.reviews,[]);
  assert.match(js,/consentConfirmed===true/);
  assert.match(html,/공개에 동의한/);
});
