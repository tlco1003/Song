import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
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
  assert.match(css,/\.album-art\.cover-artwork\{/);
  assert.ok(js.includes('advanceLyrics'));
  assert.ok(js.includes('filterLyricLines'));
});
test('all ten music letters display genre from the shared public track manifest',()=>{
  assert.equal(tracks.tracks.length,10);
  assert.equal(tracks.tracks.filter(t=>t.genreSource==='prompt').length,2);
  for(const t of tracks.tracks){
    assert.ok(typeof t.genre==='string'&&t.genre.trim().length>0,t.title+' missing genre');
    assert.ok(['prompt','editorial'].includes(t.genreSource),t.title+' missing genre source');
  }
  assert.equal(tracks.tracks.find(t=>t.id==='song-cinderella-laundry').genre,'뮤지컬 팝 · 재즈 스윙');
  assert.ok(html.includes('id="track-genre"'));
  assert.ok(html.includes('class="genre-disclaimer"'));
  assert.match(js,/\$\('track-genre'\)\.textContent=track\.genre/);
  assert.match(js,/genre\.className='track-genre'/);
  assert.match(css,/\.track-name \.track-genre/);
});

test('published songs retain unique IDs and wedding music and lyrics are paired',()=>{
  assert.equal(tracks.version,1);
  const byId=new Map(tracks.tracks.map(track=>[track.id,track]));
  assert.equal(byId.size,tracks.tracks.length,'duplicate track id');
  assert.equal(byId.get('song-mother').file,'mother-song.mp4');
  assert.equal(byId.get('song-mother').mediaKind,'video');
  assert.equal(tracks.tracks[1].id,'song-papa');
  assert.equal(byId.get('song-papa').title,'아빠의 계절');
  assert.equal(byId.get('song-papa').file,'Papa.mp4');
  assert.equal(byId.get('song-papa').mediaKind,'video');
  assert.equal(byId.get('song-papa').lyricsFile,'lyrics-papa.txt');
  assert.equal(byId.get('song-nara').file,'nara.mp3');
  assert.equal(byId.get('song-taehwan').file,'taehwan.mp3');

  const wedding=byId.get('song-romantic-wedding');
  assert.equal(wedding.title,'로맨틱 웨딩');
  assert.equal(wedding.file,'romantic-wedding.mp3');
  assert.equal(wedding.lyricsFile,'lyrics-wedding.txt');
  assert.ok(statSync(new URL('../docs/media/romantic-wedding.mp3',import.meta.url)).size>1024);

  for(const id of ['song-nara','song-taehwan','song-jeongmi','song-romantic-wedding']){
    const track=byId.get(id);
    assert.ok(track,'missing '+id);
    assert.equal(Object.hasOwn(track,'sunoId'),false);
    assert.match(track.lyricsFile,/^lyrics-[a-z]+\.txt$/);
    const lyrics=read('docs/media/'+track.lyricsFile);
    assert.ok(lyrics.length>400,'missing lyrics for '+id);
  }
  assert.match(read('docs/media/lyrics-nara.txt'),/하나님께 감사드려요/);
  assert.match(read('docs/media/lyrics-taehwan.txt'),/금호동 집에서/);
  assert.match(read('docs/media/lyrics-jeongmi.txt'),/정미야, 네가 있어 참 다행이야/);
  assert.match(read('docs/media/lyrics-wedding.txt'),/우리 서로 기도해요/);
  assert.match(js,/manifest\.tracks\.filter/);
  assert.doesNotMatch(js,/tracks=published/,'HEAD failures must not hide songs from the manifest');
});
test('mother video and nara song load the uploaded lyrics with the exact lyricsFile key',()=>{
  const byId=new Map(tracks.tracks.map(track=>[track.id,track]));
  for(const [id,expected] of [
    ['song-mother','lyrics-mother-song.txt'],
    ['song-papa','lyrics-papa.txt'],
    ['song-nara','lyrics-nara.txt']
  ]){
    const track=byId.get(id);
    assert.ok(track,'missing '+id);
    assert.equal(track.lyricsFile,expected);
    assert.equal(Object.hasOwn(track,'dlyricsFile'),false);
    assert.ok(read('docs/media/'+expected).trim().length>400);
  }
  assert.match(js,/fileURL\('media\/',track\.lyricsFile\)/);
  assert.match(js,/lyricsFile:'lyrics-mother-song\.txt'/);
});

test('new 씨앗을심어 and 새벽여섯시반 entries have correct display names and real lyric text',()=>{
  const sprout=tracks.tracks.find(t=>t.id==='song-sprout');
  const morning=tracks.tracks.find(t=>t.id==='song-am630');
  assert.ok(sprout);
  assert.ok(morning);
  assert.equal(sprout.title,'씨앗을심어');
  assert.equal(sprout.file,'sprout.mp3');
  assert.equal(sprout.lyricsFile,'lyrics-sprout.txt');
  assert.equal(sprout.durationSeconds,274.944);
  assert.equal(morning.title,'새벽여섯시반');
  assert.equal(morning.file,'am630.mp3');
  assert.equal(morning.lyricsFile,'lyrics-am630.txt');
  assert.equal(morning.durationSeconds,428.04);
  assert.match(read('docs/media/lyrics-sprout.txt'),/나는 매일매일 힘겹게 계속 씨앗을 심고 있어/);
  assert.match(read('docs/media/lyrics-am630.txt'),/고요한 새벽 여섯 시 반/);
  // The lyrics are ready, but audio is only considered published after its files exist.
  assert.match(js,/track.availability!=='missing'/);
});

test('세탁소의 신데렐라 is listed with complete lyrics and verified MP3 metadata',()=>{
  const song=tracks.tracks.find(x=>x.id==='song-cinderella-laundry');
  assert.ok(song);
  assert.equal(song.title,'세탁소의 신데렐라');
  assert.equal(song.subtitle,'동전 하나만 더!');
  assert.equal(song.file,'cinderella-laundry.mp3');
  assert.equal(song.lyricsFile,'lyrics-cinderella-laundry.txt');
  assert.equal(song.durationSeconds,221.64);
  const lyrics=read('docs/media/'+song.lyricsFile);
  assert.match(lyrics,/짝짝이 양말에 구겨진 셔츠/);
  assert.match(lyrics,/그거요\? 내일 찾으러 올게요!/);
  assert.doesNotMatch(lyrics,/\[(?:Verse|Chorus|Pre-Chorus|Bridge|Outro|Final)/);
});

test('80s city pop summer song has playable MP3 and its complete published lyrics',()=>{
  const song=tracks.tracks.find(t=>t.id==='song-summer-80s');
  assert.ok(song);
  assert.equal(song.title,'우리의 첫 번째 여름');
  assert.equal(song.genre,'80s 일본 시티팝');
  assert.equal(song.file,'80s-citypop.mp3');
  assert.equal(song.lyricsFile,'lyrics-80s-citypop.txt');
  assert.equal(song.productType,'audio_with_cover');
  assert.equal(Object.hasOwn(song,'coverImage'),false,'new music should use fallback until its own cover exists');
  assert.ok(statSync(new URL('../docs/media/'+song.file,import.meta.url)).size>1024);
  const lyrics=read('docs/media/'+song.lyricsFile);
  for(const phrase of ['백조가 헤엄치던','디즈니랜드','해리포터','클럽','Oh, our summer night']){
    assert.ok(lyrics.includes(phrase),'lyrics are missing '+phrase);
  }
  assert.doesNotMatch(lyrics,/\[(?:Intro|Verse|Chorus|Bridge|Outro|Final)/);
});

test('Cinderella short loops silently while its full MP3 drives playback and lyrics',()=>{
  const song=tracks.tracks.find(t=>t.id==='song-cinderella-laundry');
  assert.ok(song);
  assert.equal(song.file,'cinderella-laundry.mp3');
  assert.equal(song.visualFile,'cinderella-laundry-loop.mp4');
  assert.equal(song.visualMode,'silent-loop');
  assert.ok(statSync(new URL('../docs/media/'+song.file,import.meta.url)).size>1024);
  assert.ok(statSync(new URL('../docs/media/'+song.visualFile,import.meta.url)).size>1024);
  assert.match(html,/<video id="music-visual" autoplay muted loop playsinline/);
  assert.match(js,/musicVisual\.muted=true/);
  assert.match(js,/musicVisual\.loop=true/);
  assert.match(js,/musicVisual\.controls=false/);
  assert.match(js,/track\.visualMode==='silent-loop'/);
  assert.ok(js.includes("albumArt.hidden=track.showCoverWithVisual!==true"));
  assert.match(js,/void musicVisual\.play\(\)/);
  assert.match(css,/#music-visual\{/);
});

test('mother cinematic preview keeps her face cover, 16:9 loop and MP3 playback',()=>{
 const mother=tracks.tracks.find(t=>t.id==='song-mother');
 assert.equal(mother.coverImage,'covers/mother-thanks.webp');
 assert.equal(mother.visualFile,'mother-intro-loop.mp4');
 assert.equal(mother.visualAspect,'16:9');
 assert.equal(mother.showCoverWithVisual,true);
 assert.equal(mother.audioFile,'mother-song.mp3');
 assert.ok(statSync(new URL('../docs/covers/mother-thanks.webp',import.meta.url)).size>1024);
 assert.ok(statSync(new URL('../docs/media/mother-intro-loop.mp4',import.meta.url)).size>1024);
 for(const id of ['music-visual-expand','music-visual-close','music-visual-fit','music-visual-fullscreen-controls']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.ok(css.includes('aspect-ratio:16/9'));
 assert.ok(css.includes('.music-visual-stage.is-landscape'));
 assert.ok(js.includes("musicVisualStage.classList.toggle('is-landscape'"));
 assert.ok(js.includes('function expandVisual()'));
 assert.ok(js.includes('function closeVisual('));
 assert.ok(js.includes("sound.src='media/mother-song.mp3'"));
 assert.ok(js.includes('video.muted=true;video.defaultMuted=true'));
});

test('playlist controls and private local upload controls are connected to new JS',()=>{
  for(const id of ['previous-track','next-track','music-audio','music-video','no-audio','track-list','local-song','local-lyrics','lyrics-scroll','local-review','review-gallery']){
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes("'"+id+"'"),id+' not used by JS');
  }
  assert.ok(!html.includes('id="copy-lyrics"'),'Public home must not expose lyric copying');
  assert.ok(!js.includes("copy-lyrics"),'Public home JS must not access lyric copy controls');
  assert.match(html,/기기에서만/);
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
