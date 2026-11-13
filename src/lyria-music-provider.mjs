/**
 * Google Lyria 3.5 — official Gemini Interactions API transport.
 * Server only. No consumer Suno cookies, browser automation, public API keys,
 * customer-delivery URLs, or unverified commercial-use claims.
 * Ref: https://ai.google.dev/gemini-api/docs/music-generation
 */
export const LYRIA_MODEL='lyria-3.5';
export const LYRIA_ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
export const MAX_MUSIC_BYTES=25*1024*1024;

export class LyriaGenerationError extends Error {
 constructor(code){super(code);this.name='LyriaGenerationError';this.code=code;}
}
function bounded(value,max,label){
 if(typeof value!=='string'||!value.trim()||value.length>max)
  throw new LyriaGenerationError('INVALID_'+label);
 return value.trim();
}
export function makeLyriaMusicPrompt(song){
 if(!song||!Number.isSafeInteger(song.index)||song.index<1)
  throw new LyriaGenerationError('INVALID_SONG_INDEX');
 const title=bounded(song.title,100,'TITLE');
 const style=bounded(song.stylePrompt,1000,'STYLE');
 const lyrics=bounded(song.lyrics,5500,'LYRICS');
 return [
  'Produce one original, fully arranged Korean-language song.',
  'Follow the musical direction while retaining the provided Korean lyrics as faithfully as possible.',
  'Never imitate a named real singer, recording or copyrighted melody.',
  'Keep clear Korean diction; do not add unrelated verses, speech or advertisements.',
  'Song title (creative context): '+title,
  'Style and arrangement:\n'+style,
  'Lyrics:\n'+lyrics
 ].join('\n\n');
}
export function extractLyriaMp3(response){
 const blocks=(Array.isArray(response?.steps)?response.steps:[])
  .filter(step=>step?.type==='model_output')
  .flatMap(step=>Array.isArray(step.content)?step.content:[]);
 const audioBlocks=blocks.filter(block=>block?.type==='audio'&&typeof block.data==='string');
 if(audioBlocks.length!==1)throw new LyriaGenerationError('MISSING_OR_MULTIPLE_AUDIO');
 const raw=audioBlocks[0].data;
 if(raw.length<1400||raw.length>Math.ceil(MAX_MUSIC_BYTES*4/3)+8
  ||raw.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
  throw new LyriaGenerationError('INVALID_AUDIO_BASE64');
 const bytes=Buffer.from(raw,'base64');
 if(bytes.length<1024||bytes.length>MAX_MUSIC_BYTES)
  throw new LyriaGenerationError('INVALID_AUDIO_SIZE');
 const mp3=bytes.toString('ascii',0,3)==='ID3'
  ||bytes[0]===255&&(bytes[1]&224)===224;
 if(!mp3)throw new LyriaGenerationError('NOT_MP3_AUDIO');
 const generatedText=blocks
  .filter(block=>block?.type==='text'&&typeof block.text==='string')
  .map(block=>block.text).join('\n').slice(0,12000);
 return Object.freeze({
  bytes,contentType:'audio/mpeg',ext:'mp3',generatedText,
  model:LYRIA_MODEL,provider:'google_lyria',bytesLength:bytes.length
 });
}
export function createLyriaMusicProvider({
 apiKey,fetcher=globalThis.fetch,timeoutMs=240000
}={}){
 if(typeof apiKey!=='string'||apiKey.trim().length<12)
  throw new LyriaGenerationError('API_KEY_NOT_CONFIGURED');
 if(typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)
  ||timeoutMs<1000||timeoutMs>300000)
  throw new LyriaGenerationError('INVALID_TRANSPORT');
 return Object.freeze({
  async createLicensedSong({order,song}={}){
   if(order?.paymentStatus!=='paid'||!order.paymentKey||!order.paymentVerifiedAt)
    throw new LyriaGenerationError('PAYMENT_NOT_VERIFIED');
   const input=makeLyriaMusicPrompt(song);
   let response;
   try{
    response=await fetcher(LYRIA_ENDPOINT,{
     method:'POST',
     headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
     body:JSON.stringify({model:LYRIA_MODEL,input}),
     signal:AbortSignal.timeout(timeoutMs)
    });
   }catch(_){
    // A timeout could occur AFTER a billed generation. Never auto-retry.
    throw new LyriaGenerationError('PROVIDER_OUTCOME_UNKNOWN');
   }
   if(!response?.ok)throw new LyriaGenerationError('PROVIDER_REJECTED');
   let payload;
   try{payload=await response.json();}
   catch(_){throw new LyriaGenerationError('INVALID_PROVIDER_RESPONSE');}
   return extractLyriaMp3(payload);
  }
 });
}
