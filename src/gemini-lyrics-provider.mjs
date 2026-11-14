/**
 * Optional Google Gemini text lyrics adapter. Uses the SAME Gemini API key
 * as Lyria but is a different billed model/request. The existing lyric policy,
 * paid-order checks and provider interface remain authoritative.
 * https://ai.google.dev/gemini-api/docs/interactions
 */
export const GEMINI_TEXT_ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
export const DEFAULT_GEMINI_LYRICS_MODEL='gemini-3.6-flash';
export class GeminiLyricsError extends Error{
 constructor(code){super(code);this.name='GeminiLyricsError';this.code=code;}
}
export function geminiTextFromResponse(result){
 if(typeof result?.output_text==='string'&&result.output_text.trim())
  return result.output_text.trim();
 const chunks=(Array.isArray(result?.steps)?result.steps:[])
  .filter(step=>step?.type==='model_output')
  .flatMap(step=>Array.isArray(step.content)?step.content:[])
  .filter(part=>part?.type==='text'&&typeof part.text==='string')
  .map(part=>part.text);
 return chunks.join('\n').trim();
}
export function createGeminiLyricsProvider({
 apiKey,model=DEFAULT_GEMINI_LYRICS_MODEL,
 fetcher=globalThis.fetch,timeoutMs=120000
}={}){
 if(typeof apiKey!=='string'||apiKey.trim().length<12)
  throw new GeminiLyricsError('GEMINI_API_KEY_NOT_CONFIGURED');
 if(!/^gemini-[a-z0-9.-]+$/.test(model)||typeof fetcher!=='function'
  ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>180000)
  throw new GeminiLyricsError('INVALID_GEMINI_LYRICS_CONFIG');
 return Object.freeze({
  async generate({prompt,lyricLength='full'}={}){
   if(typeof prompt!=='string'||prompt.length<40||prompt.length>50000
    ||!['full','short'].includes(lyricLength))
    throw new GeminiLyricsError('INVALID_PRIVATE_LYRIC_PROMPT');
   let response;
   try{
    response=await fetcher(GEMINI_TEXT_ENDPOINT,{
     method:'POST',
     headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
     body:JSON.stringify({
      model,input:prompt,store:false,
      generation_config:{max_output_tokens:lyricLength==='full'?4500:1800}
     }),
     signal:AbortSignal.timeout(timeoutMs)
    });
   }catch(_){throw new GeminiLyricsError('GEMINI_LYRICS_OUTCOME_UNKNOWN');}
   if(!response?.ok)throw new GeminiLyricsError('GEMINI_LYRICS_REJECTED');
   let payload;
   try{payload=await response.json();}
   catch(_){throw new GeminiLyricsError('INVALID_GEMINI_LYRICS_RESPONSE');}
   if(payload?.error||payload?.status==='failed'||payload?.status==='incomplete')
    throw new GeminiLyricsError('GEMINI_LYRICS_FAILED');
   const text=geminiTextFromResponse(payload);
   if(!text)throw new GeminiLyricsError('EMPTY_GEMINI_LYRICS');
   return text;
  }
 });
}
