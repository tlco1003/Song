/**
 * Official Mureka lyrics API; optional provider in existing server-only
 * private lyrics pipeline. Same MUREKA_API_KEY as the music provider.
 * https://platform.mureka.ai/docs/api/operations/post-v1-lyrics-generate.html
 */
export const MUREKA_LYRICS_ENDPOINT='https://api.mureka.ai/v1/lyrics/generate';
export class MurekaLyricsError extends Error{
 constructor(code){super(code);this.name='MurekaLyricsError';this.code=code;}
}
export function createMurekaLyricsProvider({apiKey,fetcher=globalThis.fetch,
 timeoutMs=60000}={}){
 if(typeof apiKey!=='string'||apiKey.length<12)
  throw new MurekaLyricsError('MUREKA_LYRICS_KEY_NOT_CONFIGURED');
 if(typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)
  ||timeoutMs<1000||timeoutMs>120000)
  throw new MurekaLyricsError('MUREKA_LYRICS_TRANSPORT_INVALID');
 return Object.freeze({
  async generate({prompt,lyricLength='full'}={}){
   if(typeof prompt!=='string'||prompt.length<40||prompt.length>50000
    ||!['full','short'].includes(lyricLength))
    throw new MurekaLyricsError('MUREKA_PRIVATE_LYRIC_PROMPT_INVALID');
   let response;
   try{
    response=await fetcher(MUREKA_LYRICS_ENDPOINT,{
     method:'POST',headers:{
      Authorization:'Bearer '+apiKey,'Content-Type':'application/json'
     },body:JSON.stringify({prompt}),redirect:'error',
     signal:AbortSignal.timeout(timeoutMs)
    });
   }catch(_){throw new MurekaLyricsError('MUREKA_LYRICS_OUTCOME_UNKNOWN');}
   if(!response?.ok)throw new MurekaLyricsError('MUREKA_LYRICS_REJECTED');
   let value;
   try{value=await response.json();}
   catch(_){throw new MurekaLyricsError('MUREKA_LYRICS_INVALID_JSON');}
   if(typeof value?.lyrics!=='string'||!value.lyrics.trim())
    throw new MurekaLyricsError('MUREKA_LYRICS_EMPTY');
   return value.lyrics.trim();
  }
 });
}
