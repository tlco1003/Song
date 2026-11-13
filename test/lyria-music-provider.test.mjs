import test from 'node:test';
import assert from 'node:assert/strict';
import {createLyriaMusicProvider,extractLyriaMp3,makeLyriaMusicPrompt,
 LYRIA_ENDPOINT,LYRIA_MODEL} from '../src/lyria-music-provider.mjs';

const song={index:1,title:'엄마에게',stylePrompt:'Piano and gentle cello. Korean vocal. 70 BPM.',
 lyrics:'[Verse 1]\n엄마 고마워요\n늘 나를 지켜줘서\n[Chorus]\n사랑해요'};
const order={paymentStatus:'paid',paymentVerifiedAt:1700000000000,paymentKey:'paid_key_mock'};
const mp3=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(2048,0)]).toString('base64');
const success={steps:[{type:'model_output',content:[
 {type:'text',text:'[Verse 1] Korean lyrics'},
 {type:'audio',mime_type:'audio/mpeg',data:mp3}
]}]};

test('official Lyria REST call preserves private style and exact Korean lyrics',async()=>{
 const calls=[];
 const provider=createLyriaMusicProvider({
  apiKey:'test_gemini_key_never_publish',
  fetcher:async(url,options)=>{calls.push({url,options});return {
   ok:true,json:async()=>success
  };}
 });
 const result=await provider.createLicensedSong({order,song});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,LYRIA_ENDPOINT);
 assert.equal(calls[0].options.headers['x-goog-api-key'],'test_gemini_key_never_publish');
 assert.equal(calls[0].options.method,'POST');
 const payload=JSON.parse(calls[0].options.body);
 assert.equal(payload.model,LYRIA_MODEL);
 assert.ok(payload.input.includes(song.lyrics));
 assert.ok(payload.input.includes(song.stylePrompt));
 assert.equal(result.bytes.toString('ascii',0,3),'ID3');
 assert.equal(result.contentType,'audio/mpeg');
 assert.equal(result.model,'lyria-3.5');
});
test('unpaid orders never call external paid API',async()=>{
 let requests=0;
 const provider=createLyriaMusicProvider({
  apiKey:'test_gemini_key_never_publish',
  fetcher:async()=>{requests++;return {ok:true,json:async()=>success};}
 });
 await assert.rejects(provider.createLicensedSong({order:{paymentStatus:'pending'},song}),
  /PAYMENT_NOT_VERIFIED/);
 assert.equal(requests,0);
});
test('prompt contract rejects client-supplied oversized hidden style',()=>{
 assert.throws(()=>makeLyriaMusicPrompt({...song,stylePrompt:'x'.repeat(1001)}),/INVALID_STYLE/);
 assert.throws(()=>makeLyriaMusicPrompt({...song,lyrics:''}),/INVALID_LYRICS/);
});
test('missing or corrupt music cannot reach private storage',()=>{
 assert.throws(()=>extractLyriaMp3({steps:[]}),/MISSING_OR_MULTIPLE_AUDIO/);
 assert.throws(()=>extractLyriaMp3({steps:[{type:'model_output',content:[
  {type:'audio',data:Buffer.alloc(2048,22).toString('base64')}
 ]}]}),/NOT_MP3_AUDIO/);
});
test('provider rejection does not return fake audio',async()=>{
 const provider=createLyriaMusicProvider({
  apiKey:'test_gemini_key_never_publish',
  fetcher:async()=>({ok:false,status:403})
 });
 await assert.rejects(provider.createLicensedSong({order,song}),/PROVIDER_REJECTED/);
});
test('ambiguous provider timeout must not be silently retried',async()=>{
 let requests=0;
 const provider=createLyriaMusicProvider({
  apiKey:'test_gemini_key_never_publish',
  fetcher:async()=>{requests++;throw new Error('timeout');}
 });
 await assert.rejects(provider.createLicensedSong({order,song}),/PROVIDER_OUTCOME_UNKNOWN/);
 assert.equal(requests,1);
});
