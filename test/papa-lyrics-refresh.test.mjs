import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const home=read('docs/index.html');
const homePlayer=read('docs/player.js');
const detail=read('docs/song.html');
const detailPlayer=read('docs/song.js');
const manifest=JSON.parse(read('docs/media/tracks.json'));

test('updated father lyrics are stored and referenced by the public track manifest',()=>{
 const father=manifest.tracks.find(track=>track.id==='song-papa');
 assert.ok(father);
 assert.equal(father.file,'Papa.mp4');
 assert.equal(father.lyricsFile,'lyrics-papa.txt');
 const contents=read('docs/media/lyrics-papa.txt');
 assert.match(contents,/아빠, 내가 기억하는 우리아빠/);
 assert.match(contents,/윤종구씨는/);
 assert.match(contents,/아빠의 계절도 평안하기를/);
});

test('both homepage and detail page request a fresh copy of published lyrics',()=>{
 assert.match(homePlayer,/readText\(fileURL\('media\/',track\.lyricsFile\)\+'\?lyricsUpdated='\+Date\.now\(\)\)/);
 assert.match(detailPlayer,/fetchLyrics\('media\/'\+encodeURIComponent\(item\.lyricsFile\)\+'\?lyricsUpdated='\+Date\.now\(\)\)/);
 assert.match(home,/player\.js\?v=\d{8}-[a-z0-9-]+/);
 assert.match(detail,/song\.js\?v=20261106-[a-z0-9-]+/);
 assert.match(homePlayer,/cache:'no-store'/);
 assert.match(detailPlayer,/cache:'no-store'/);
});
