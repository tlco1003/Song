import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const tracks=JSON.parse(read('docs/media/tracks.json')).tracks;
const home=read('docs/index.html');
const homePlayer=read('docs/player.js');
const detail=read('docs/song.html');
const detailPlayer=read('docs/song.js');

test('published family MP4s remain audible without a separate audio asset',()=>{
 for(const id of ['song-mother','song-papa']){
  const song=tracks.find(item=>item.id===id);
  assert.ok(song,id);
  assert.equal(song.mediaKind,'video');
  assert.match(song.file,/\.mp4$/i);
 }
 assert.match(homePlayer,/videoPlayer\.muted=hasSeparateAudio/);
 assert.match(homePlayer,/videoPlayer\.controls=!hasSeparateAudio/);
 assert.match(homePlayer,/playbackPlayer=hasSeparateAudio\|\|!isVideo\?audio:videoPlayer/);
 assert.match(detailPlayer,/video\.muted=hasSeparateAudio/);
 assert.match(detailPlayer,/player=hasSeparateAudio\|\|!isVideo\?audio:video/);
 assert.match(homePlayer,/videoPlayer\.muted=false;videoPlayer\.defaultMuted=false/);
 // Mother's MP4 is muted when a separate MP3 supplies its audio.
 const mother=tracks.find(item=>item.id==='song-mother');
 assert.equal(mother.audioFile,'mother-song.mp3');
 assert.match(homePlayer,/video\.muted=true;video\.defaultMuted=true/);
 assert.match(homePlayer,/video\.controls=false;video\.loop=true/);
});

test('audio-first upgrade supports dedicated audio without duplicate audible video',()=>{
 assert.match(homePlayer,/fileOK\(track\.audioFile\|\|''\)/);
 assert.match(homePlayer,/track\.audioAvailability!=='missing'/);
 assert.match(homePlayer,/audio\.src=track\.deviceURL/);
 assert.match(homePlayer,/syncSilentVideo\(videoPlayer,audio\)/);
 assert.match(detailPlayer,/video\.controls=false;video\.loop=hasSeparateAudio/);
 assert.match(detailPlayer,/player=hasSeparateAudio\|\|!isVideo\?audio:video/);
 assert.match(homePlayer,/setMediaSession/);
 assert.match(detailPlayer,/updateMediaSession/);
});

test('repeat controls are present on main playlist and detail player',()=>{
 assert.match(home,/id="repeat-mode"/);
 assert.match(homePlayer,/repeatMode==='off'\?'one':repeatMode==='one'\?'all':'off'/);
 assert.match(homePlayer,/repeatMode==='all'/);
 assert.match(homePlayer,/audio\.loop=repeatMode==='one'/);
 assert.match(detail,/id="detail-repeat"/);
 assert.match(detailPlayer,/repeatOne=!repeatOne/);
 assert.match(detailPlayer,/player\.loop=repeatOne/);
});
