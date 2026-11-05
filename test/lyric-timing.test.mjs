import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterLyricLines,parseLyricDocument,cueIndexAt,formatCueTime,serializeTimedLyrics} from '../docs/lyric-timing.mjs';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('plain published lyrics are NOT treated as synchronized even with a known track duration',()=>{
 const manifest=JSON.parse(read('docs/media/tracks.json'));
 for(const track of manifest.tracks){
  const doc=parseLyricDocument(read('docs/media/'+track.lyricsFile));
  assert.ok(doc.lines.length>4,track.title);
  assert.equal(doc.cues,null,track.title+' must not jump by an invented proportional timeline');
 }
});

test('parses valid timestamped lyrics with fractional seconds, and repeated text',()=>{
 const doc=parseLyricDocument('[00:17.25]엄마, 난 가끔 그런 생각을 해\n[00:24.7]어떻게 그렇게 살아왔을까\n[01:11.05]엄마, 난 가끔 그런 생각을 해');
 assert.deepEqual(doc.lines,['엄마, 난 가끔 그런 생각을 해','어떻게 그렇게 살아왔을까','엄마, 난 가끔 그런 생각을 해']);
 assert.deepEqual(doc.cues,[17.25,24.7,71.05]);
 assert.equal(cueIndexAt(doc.cues,0),-1);
 assert.equal(cueIndexAt(doc.cues,17.24),-1);
 assert.equal(cueIndexAt(doc.cues,17.25),0);
 assert.equal(cueIndexAt(doc.cues,31),1);
 assert.equal(cueIndexAt(doc.cues,71.05),2);
 assert.equal(cueIndexAt(doc.cues,9999),2);
});

test('never synchronizes partial, unordered, empty or malformed timecode files',()=>{
 for(const input of [
  '[00:12.00]첫 구절\n시간 없는 다음 구절',
  '[00:12.00]첫 구절\n[00:11.00]다음 구절',
  '[00:12.00]첫 구절\n[00:12.00]다음 구절',
  '[00:12.00]첫 구절\n[00:66.00]다음 구절',
  '[00:12.00]첫 구절\n[00:20.00]',
  ''
 ]){
  assert.equal(parseLyricDocument(input).cues,null,JSON.stringify(input));
 }
});

test('strips arrangement-only headers while retaining genuinely timed lines',()=>{
 const doc=parseLyricDocument('[Verse 1]\n[00:04.00]사랑해\n\n[Chorus]\n[00:21.30]엄마');
 assert.deepEqual(doc.lines,['사랑해','엄마']);
 assert.deepEqual(doc.cues,[4,21.3]);
 assert.deepEqual(filterLyricLines(' [Bridge]\n안녕\n\n[Outro] '),['안녕']);
});

test('timestamp writer creates parseable files with no invented timings',()=>{
 const source=serializeTimedLyrics(['첫 줄','두 번째 줄','첫 줄'],[12.34,15.67,100]);
 assert.equal(source,'[00:12.34]첫 줄\n[00:15.67]두 번째 줄\n[01:40.00]첫 줄\n');
 const restored=parseLyricDocument(source);
 assert.deepEqual(restored.cues,[12.34,15.67,100]);
 assert.deepEqual(restored.lines,['첫 줄','두 번째 줄','첫 줄']);
 assert.throws(()=>serializeTimedLyrics(['a','b'],[1]),/require a start time/);
 assert.throws(()=>serializeTimedLyrics(['a','b'],[2,1]),/increasing/);
 assert.throws(()=>serializeTimedLyrics(['a','b'],[2,null]),/Missing or invalid/);
 assert.throws(()=>serializeTimedLyrics(['a','b'],[2,2.001]),/increasing/);
 assert.equal(cueIndexAt(null,3),-1);
 assert.equal(cueIndexAt([1,5],Number.NaN),-1);
});

test('a malformed unclosed Verse heading is not shown as spoken lyrics',()=>{
 const doc=parseLyricDocument('Verse 1]\n[00:03.20]첫 노래\n[Chorus]\n[00:12.40]후렴');
 assert.deepEqual(doc.lines,['첫 노래','후렴']);
 assert.deepEqual(doc.cues,[3.2,12.4]);
});
test('the public timing workbench supports AI draft import but never publishes guessed times',()=>{
 const editor=read('docs/lyric-timer.js');
 const page=read('docs/lyric-timer.html');
 assert.ok(editor.includes('importTimingFile'));
 assert.ok(editor.includes('draft.matched?.[i]===false?null:v'));
 assert.ok(editor.includes('supplied.some((text,i)=>text!==lines[i])'));
 assert.ok(page.includes('id="import-timing"'));
 assert.ok(page.includes('실제 음악으로 교정'));
 assert.equal(editor.includes('api.github.com/repos/'),false);
});
