import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createMurekaProvider,makeMurekaRequest,parseMurekaTask,
 allowedMurekaAudioUrl,MUREKA_BASE,MUREKA_MODEL
} from '../src/mureka-music-provider.mjs';
import {createMurekaLyricsProvider,MUREKA_LYRICS_ENDPOINT}
 from '../src/mureka-lyrics-provider.mjs';

const key='mureka_fake_secret_for_tests_only';
const ID='withu_'+'a'.repeat(32);
const song={index:1,title:'엄마에게',genre:'발라드',
 lyrics:'[Verse 1]\n엄마 고마워요\n[Chorus]\n언제나 사랑해요',
 stylePrompt:'Original Korean ballad with warm piano, gentle strings and expressive emotional arc.'};
const paid={id:ID,paymentStatus:'paid',paymentVerifiedAt:1700000000000,
 paymentKey:'pg_verified'};
const audioUrl='https://verified-cdn.example/track.mp3?token=temporarySignedValue';
const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(1500)]);
test('Mureka song generation always bills n=1 and respects 1024-char style',()=>{
 assert.deepEqual(Object.keys(makeMurekaRequest(song)).sort(),
  ['lyrics','model','n','prompt','stream']);
 assert.equal(makeMurekaRequest(song).n,1);
 assert.equal(makeMurekaRequest(song).model,MUREKA_MODEL);
 assert.equal(makeMurekaRequest(song).stream,false);
 assert.throws(()=>makeMurekaRequest({...song,stylePrompt:'a'.repeat(1025)}),
  /MUREKA_INVALID_SONG_PLAN/);
});
test('paid Mureka submits exactly one official song; query result is not customer download',async()=>{
 const calls=[];
 const provider=createMurekaProvider({apiKey:key,fetcher:async(url,options)=>{
  calls.push({url,options});
  if(options.method==='POST')
   return {ok:true,json:async()=>({id:'123456',status:'preparing',model:'mureka-9.5'})};
  if(options.method==='GET')
   return {ok:true,json:async()=>({id:'123456',status:'succeeded',
    model:'mureka-9.5',choices:[{id:'song_123',url:audioUrl}]})};
  throw Error('unsupported method');
 }});
 const submitted=await provider.submitSong({order:paid,song});
 assert.equal(submitted.id,'123456');
 assert.equal(submitted.ready,false);
 assert.equal(calls[0].url,MUREKA_BASE+'/v1/song/generate');
 assert.equal(JSON.parse(calls[0].options.body).n,1);
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+key);
 const query=await provider.querySong(submitted.id);
 assert.equal(query.status,'succeeded');
 assert.equal(query.audioUrl,audioUrl);
 assert.equal(calls[1].url,MUREKA_BASE+'/v1/song/query/123456');
});
test('Mureka provider blocks unpaid orders and unknown task states',async()=>{
 let count=0;
 const provider=createMurekaProvider({apiKey:key,fetcher:async()=>{
  count++;throw Error('unexpected billed call');
 }});
 await assert.rejects(provider.submitSong({
  order:{...paid,paymentStatus:'pending'},song
 }),/MUREKA_PAID_ORDER_REQUIRED/);
 assert.equal(count,0);
 assert.throws(()=>parseMurekaTask({id:'123',status:'mystery'}),
  /MUREKA_TASK_STATUS_UNKNOWN/);
 assert.throws(()=>parseMurekaTask({id:'123',status:'succeeded',choices:[{},{}]}),
  /MUREKA_TASK_MISSING_AUDIO/);
 assert.throws(()=>parseMurekaTask({id:'999',status:'succeeded',
  choices:[{url:audioUrl}]},{taskId:'123'}),/MUREKA_TASK_RESPONSE_INVALID/);
});
test('Mureka audio download requires an exact authorized HTTPS CDN host',async()=>{
 const calls=[];
 const provider=createMurekaProvider({apiKey:key,fetcher:async(url,options)=>{
  calls.push({url,options});
  return {ok:true,headers:{get:(name)=>
   name==='content-length'?String(mp3.length):name==='content-type'?'audio/mpeg':null},
   arrayBuffer:async()=>mp3};
 }});
 await assert.rejects(provider.downloadSong({audioUrl,allowedAudioHosts:''}),
  /MUREKA_AUDIO_HOST_NOT_APPROVED/);
 assert.equal(calls.length,0);
 assert.throws(()=>allowedMurekaAudioUrl(
  'http://127.0.0.1/secret','127.0.0.1'),/MUREKA_AUDIO_URL_FORBIDDEN/);
 assert.throws(()=>allowedMurekaAudioUrl(
  'https://verified-cdn.example.attacker.test/x','verified-cdn.example'),
  /MUREKA_AUDIO_HOST_NOT_APPROVED/);
 const downloaded=await provider.downloadSong({
  audioUrl,allowedAudioHosts:'verified-cdn.example'
 });
 assert.equal(downloaded.ext,'mp3');
 assert.equal(downloaded.sizeBytes,mp3.length);
 assert.equal(calls.length,1);
 assert.equal(calls[0].options.headers,undefined);
 assert.equal(calls[0].options.redirect,'error');
});
test('Mureka rejects corrupt audio and unapproved redirect content',async()=>{
 const provider=createMurekaProvider({apiKey:key,fetcher:async()=>({
  ok:true,headers:{get:()=>null},arrayBuffer:async()=>Buffer.alloc(1500)
 })});
 await assert.rejects(provider.downloadSong({
  audioUrl,allowedAudioHosts:'verified-cdn.example'
 }),/MUREKA_AUDIO_INVALID_MP3/);
});
test('Mureka lyrics use same secret and are checked by the existing lyrics validation engine',async()=>{
 const calls=[];
 const lyricText='[Verse 1]\n엄마 고마워요\n[Chorus]\n우리 함께할게요';
 const lyrics=createMurekaLyricsProvider({apiKey:key,fetcher:async(url,options)=>{
  calls.push({url,options});
  return {ok:true,json:async()=>({title:'엄마에게',lyrics:lyricText})};
 }});
 assert.equal(await lyrics.generate({
  prompt:'Use original Korean lyrics grounded in user story. '.repeat(4)
 }),lyricText);
 assert.equal(calls[0].url,MUREKA_LYRICS_ENDPOINT);
 assert.equal(JSON.parse(calls[0].options.body).prompt.length>40,true);
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+key);
});
