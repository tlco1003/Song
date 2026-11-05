import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCoverPrompt} from '../src/cover-image.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const home=read('docs/index.html'),player=read('docs/player.js');
const song=read('docs/song.html'),songJS=read('docs/song.js'),songCSS=read('docs/song.css');
const coverStore=read('docs/cover-store.js');
const checkout=read('docs/checkout.html'),checkoutJS=read('docs/checkout-media.js');
const server=read('src/server.mjs'),manifest=JSON.parse(read('docs/media/tracks.json'));

test('all original eight cover illustrations stay unique when father video is added',()=>{
 assert.equal(manifest.tracks.length,9);
 const expected={
  'song-mother':'mother-thanks.webp',
  'song-cinderella-laundry':'cinderella-laundry.webp',
  'song-nara':'self-lantern.webp',
  'song-taehwan':'taehwan-main.webp',
  'song-jeongmi':'friend-memory.webp',
  'song-romantic-wedding':'romantic-wedding.webp',
  'song-sprout':'sprout.webp',
  'song-am630':'am630.webp'
 };
 const paths=new Set();
 for(const t of manifest.tracks){
  if(t.id==='song-papa'){
   assert.equal(t.mediaKind,'video');
   assert.equal(t.file,'Papa.mp4');
   assert.equal(t.coverImage,undefined,'do not reuse another song cover');
   assert.equal(t.productType,'audio_video');
   continue;
  }
  assert.equal(t.coverImage,'covers/'+expected[t.id]);
  assert.match(t.coverImage,/^covers\/[a-z0-9-]+\.webp$/);
  assert.ok(!paths.has(t.coverImage));paths.add(t.coverImage);
  assert.ok(['audio_with_cover','audio_video'].includes(t.productType));
 }
 assert.equal(manifest.tracks.find(t=>t.id==='song-mother').productType,'audio_video');
});

test('home uses genuine square album images, per-track thumbnails and detail links',()=>{
 for(const id of ['album-art','current-cover','cover-fallback','cover-detail-link','track-list']){
  assert.ok(home.includes('id="'+id+'"'),id);
 }
 assert.ok(!home.includes('class="record-ring"'));
 assert.match(home,/song.html\?demo=/);
 assert.match(player,/coverFor\(track\)/);
 assert.match(player,/tile\.append\(mini,b,more\)/);
 assert.match(player,/cover\.onerror=/);
});

test('checkout removes prepayment cover samples while song detail retains cover editor',()=>{
 for(const id of ['checkout-cover-image','checkout-cover-fallback','checkout-view-song','prepay-demo']){
  assert.ok(!checkout.includes('id="'+id+'"'),id);
 }
 assert.doesNotMatch(checkoutJS,/updateExampleArt|audio-preview-play/);
 assert.match(song,/id="detail-cover"/);
 assert.match(songJS,/coverStore|WithuCovers/);
});

test('song detail player has video and audio, auto-hide, seek, fullscreen and public demo gating',()=>{
 for(const id of ['player-stage','detail-video','detail-audio','detail-play','detail-seek','detail-fullscreen','detail-controls',
  'detail-cover','cover-dialog','cover-file','cover-prompt','generate-cover','save-cover','reset-cover']){
  assert.ok(song.includes('id="'+id+'"'),id);
 }
 assert.match(songJS,/controls-hidden/);
 assert.match(songJS,/setTimeout\(.+2800/);
 assert.match(songJS,/requestFullscreen/);
 assert.match(songJS,/webkitEnterFullscreen/);
 assert.match(songJS,/duration\*Number\(seek\.value\)\/1000/);
 assert.match(songJS,/loadPrivate/);
 assert.match(songJS,/api\/delivery\//);
 assert.match(songJS,/media\/tracks\.json/);
 assert.match(songCSS,/\.detail-player:fullscreen/);
});

test('cover editor saves only to local IndexedDB and actual AI provider is optional and gated',()=>{
 assert.match(coverStore,/indexedDB\.open/);
 assert.match(coverStore,/createImageBitmap/);
 assert.match(coverStore,/image\/webp/);
 assert.match(songJS,/window\.WithuCovers\.put/);
 assert.match(songJS,/api\/covers\/generate/);
 assert.doesNotMatch(songJS,/localStorage|api\/payments\/confirm/);
 assert.match(server,/pathname==='\/api\/covers\/generate'/);
 assert.match(server,/if\(!accessToken\)/);
 assert.match(server,/if\(!process\.env\.OPENAI_API_KEY\)/);
 assert.match(server,/pathname\.startsWith\('\/api\/delivery\/'\)/);
});

test('cover prompt uses meaningful short song context without exposing internal lyric-engine prompts',()=>{
 const p=buildCoverPrompt({title:'세탁소의 신데렐라',genre:'뮤지컬 팝',prompt:'분홍빛 세탁소에서 미소 짓는 남녀'});
 assert.match(p,/세탁소의 신데렐라/);
 assert.match(p,/뮤지컬 팝/);
 assert.match(p,/1:1/);
 assert.throws(()=>buildCoverPrompt({title:'',genre:'',prompt:'x'}));
});
