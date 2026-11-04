import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('docs/index.html'),js=read('docs/site.js');
const tracks=JSON.parse(read('docs/media/tracks.json'));
const reviews=JSON.parse(read('docs/reviews/reviews.json'));
test('WITHU public site has Korean handwriting and mobile layout',()=>{
  assert.match(html,/<title>WITHU/);
  assert.match(html,/Nanum\+Pen\+Script/);
  assert.match(html,/Gaegu/);
  assert.match(html,/viewport/);
  assert.match(html,/withu-player-layout/);
});
test('the three supplied song names and Suno UUIDs are listed accurately',()=>{
  assert.deepEqual(tracks.tracks.map(t=>t.title),['나라는 사람','구태환에게','내사랑김정미']);
  assert.deepEqual(tracks.tracks.map(t=>t.file),['nara.mp3','taehwan.mp3','jeongmi.mp3']);
  for(const t of tracks.tracks)assert.match(t.sunoId,/^[0-9a-f-]{36}$/);
  assert.ok(js.includes('https://suno.com/embed/'));
});
test('previous, next, media controls, upload preview and GitHub admin publishing are wired',()=>{
  for(const id of ['withu-prev','withu-next','withu-audio','withu-suno-embed','withu-track-list','withu-upload-music','withu-publish-music','withu-refresh-media']){
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes("'"+id+"'"),'missing JS binding for '+id);
  }
  assert.match(html,/https:\/\/github.com\/tlco1003\/Song\/upload\/main\/docs\/media/);
  assert.match(html,/내 기기에서만/);
});
test('real video review area never displays fabricated testimonials',()=>{
  assert.deepEqual(reviews.reviews,[]);
  assert.ok(html.includes('id="withu-review-gallery"'));
  assert.ok(html.includes('id="withu-upload-review"'));
  assert.ok(html.includes('id="withu-publish-review"'));
  assert.match(js,/실제 영상 후기를 준비하고 있어요/);
  assert.match(html,/동의한 영상만/);
});
