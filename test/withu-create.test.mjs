import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const home=read('docs/index.html'),create=read('docs/create.html');
const createScript=read('docs/create.js'),player=read('docs/player.js');
const css=read('docs/create.css');
const server=read('src/server.mjs');

test('WITHU homepage links to first party music creation',()=>{
  assert.match(home,/href="create.html"/);
  assert.match(home,/id="featured"/);
  assert.match(home,/id="mother-featured-video"/);
  assert.match(home,/id="mother-video-pending"/);
  assert.match(player,/media\/mother-song\.mp4/);
  assert.match(player,/method:'HEAD'/);
  assert.ok(!home.includes('github.com'));
});
test('public creation collects the original five answers and speech choices',()=>{
  for(const id of ['recipient','memory','message','gratitudeApology','occasion','recipientAgeGroup','relativePosition','speechStyle','genre','mood','lyricLength']){
    assert.ok(create.includes('id="'+id+'"'),id);
  }
  assert.match(create,/id="song-lyrics"/);
  assert.match(create,/id="song-style"/);
  assert.match(create,/id="copy-lyrics"/);
  assert.match(create,/id="copy-style"/);
  assert.match(create,/id="go-create"/);
  assert.match(css,/creation-layout/);
});
test('creation uses only documented official direct creation URL and clipboard, not invented auto-prefill',()=>{
  assert.match(create,/href="https:\/\/suno\.com\/create"/);
  assert.match(createScript,/navigator\.clipboard\.writeText/);
  assert.match(createScript,/fetch\('api\/lyrics'/);
  assert.ok(!/\?lyrics=|\?prompt=|\?style=/.test(create+createScript));
  assert.match(createScript,/lyrics-service-pending/);
});
test('HTTPS backend serves landing, lyric creation and opt-in mother video routes',()=>{
  for(const line of ["'/create.html':'docs/create.html'","'/create.js':'docs/create.js'","'/create.css':'docs/create.css'"]){
    assert.ok(server.includes(line),line);
  }
  assert.ok(server.includes('(?:mp3|m4a|wav|ogg|txt|mp4)'));
  assert.match(server,/public multi-user|authenticated|commercial website/i);
});
