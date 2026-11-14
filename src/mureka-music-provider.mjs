import {isIP} from 'node:net';
/**
 * Mureka official paid song generation adapter (2026-11-14).
 * Official spec: https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html
 * Query: https://platform.mureka.ai/docs/api/operations/get-v1-song-query-%7Btask_id%7D.html
 * Never send credentials to customer browser or embed them in generated media.
 * External creation is billable: no automatic retry of uncertain POST outcomes.
 */
export const MUREKA_PROVIDER_ID='mureka';
export const MUREKA_MODEL='mureka-9.5';
export const MUREKA_BASE='https://api.mureka.ai';
export const MUREKA_MAX_AUDIO_BYTES=25*1024*1024;
const TASK_ID=/^[A-Za-z0-9_-]{1,150}$/;
const PROCESSING=new Set(['preparing','queued','running','streaming','reviewing']);
const FINISHED_FAILURE=new Set(['failed','timeouted','cancelled']);
export class MurekaProviderError extends Error{
 constructor(code){super(code);this.name='MurekaProviderError';this.code=code;}
}
export function murekaTaskId(value){
 if(typeof value!=='string'||!TASK_ID.test(value))
  throw new MurekaProviderError('MUREKA_TASK_ID_INVALID');
 return value;
}
export function makeMurekaRequest(song,{model=MUREKA_MODEL}={}){
 if(!song||!Number.isSafeInteger(song.index)||song.index<1||song.index>2
  ||typeof song.lyrics!=='string'||song.lyrics.trim().length<12
  ||song.lyrics.length>5000||typeof song.stylePrompt!=='string'
  ||song.stylePrompt.trim().length<20||song.stylePrompt.length>1024
  ||typeof song.title!=='string'||!song.title.trim()||song.title.length>100)
  throw new MurekaProviderError('MUREKA_INVALID_SONG_PLAN');
 if(model!==MUREKA_MODEL)
  throw new MurekaProviderError('MUREKA_UNAPPROVED_MODEL');
 // n defaults to TWO billable songs. Explicit n=1 protects customer budgets.
 // Only the SOURCE-REVIEWED, server-computed music style is sent, never an
 // untrusted singer's name, prompt/secret, or copyrighted recording.
 return Object.freeze({lyrics:song.lyrics,model,n:1,
  prompt:song.stylePrompt,stream:false});
}
function typedStatus(result,{taskId}={}){
 if(!result||typeof result!=='object'||Array.isArray(result)
  ||(taskId&&result.id!==taskId))
  throw new MurekaProviderError('MUREKA_TASK_RESPONSE_INVALID');
 const id=murekaTaskId(result.id);
 const status=result.status;
 if(!PROCESSING.has(status)&&!FINISHED_FAILURE.has(status)&&status!=='succeeded')
  throw new MurekaProviderError('MUREKA_TASK_STATUS_UNKNOWN');
 if(status==='succeeded'){
  const songs=result.choices;
  if(!Array.isArray(songs)||songs.length!==1||typeof songs[0]?.url!=='string')
   throw new MurekaProviderError('MUREKA_TASK_MISSING_AUDIO');
 }
 return Object.freeze({
  id,status,model:typeof result.model==='string'?result.model:null,
  failedReason:FINISHED_FAILURE.has(status)?String(result.failed_reason||'provider_failed').slice(0,120):null,
  ...(status==='succeeded'?{audioUrl:result.choices[0].url}:{}),
  ready:status==='succeeded',failed:FINISHED_FAILURE.has(status)
 });
}
export function parseMurekaTask(result,options={}){
 return typedStatus(result,options);
}
export function allowedMurekaAudioUrl(rawUrl,hosts){
 if(typeof rawUrl!=='string'||rawUrl.length>5000)
  throw new MurekaProviderError('MUREKA_AUDIO_URL_INVALID');
 let url;
 try{url=new URL(rawUrl);}catch(_){throw new MurekaProviderError('MUREKA_AUDIO_URL_INVALID');}
 if(url.protocol!=='https:'||!url.hostname||url.username||url.password
  ||url.port&&url.port!=='443'||url.hash
  ||url.hostname==='localhost'||url.hostname.endsWith('.localhost')
  ||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')
  ||isIP(url.hostname)!==0||!url.hostname.includes('.')
  ||url.hostname.includes('..'))
  throw new MurekaProviderError('MUREKA_AUDIO_URL_FORBIDDEN');
 const allow=String(hosts||'').split(',').map(x=>x.trim().toLowerCase())
  .filter(Boolean);
 if(!allow.length||allow.some(h=>!/^[a-z0-9.-]+$/.test(h))
  ||!allow.includes(url.hostname.toLowerCase()))
  throw new MurekaProviderError('MUREKA_AUDIO_HOST_NOT_APPROVED');
 // Exact allowlist prevents fetching arbitrary internal customer-supplied URLs.
 return url.href;
}
function mp3Header(bytes){
 return bytes.toString('ascii',0,3)==='ID3'
  ||bytes[0]===255&&(bytes[1]&224)===224;
}
async function readResponse(response,label){
 let data;
 try{data=await response.json();}catch(_){
  throw new MurekaProviderError(label+'_INVALID_JSON');
 }
 return data;
}
export function createMurekaProvider({apiKey,fetcher=globalThis.fetch,
 requestTimeoutMs=30000}={}){
 if(typeof apiKey!=='string'||apiKey.length<12)
  throw new MurekaProviderError('MUREKA_API_KEY_NOT_CONFIGURED');
 if(typeof fetcher!=='function'||!Number.isSafeInteger(requestTimeoutMs)
  ||requestTimeoutMs<1000||requestTimeoutMs>120000)
  throw new MurekaProviderError('MUREKA_TRANSPORT_INVALID');
 const headers={Authorization:'Bearer '+apiKey,'Content-Type':'application/json'};
 return Object.freeze({
  async submitSong({order,song}={}){
   if(order?.paymentStatus!=='paid'||!order.paymentKey||!order.paymentVerifiedAt)
    throw new MurekaProviderError('MUREKA_PAID_ORDER_REQUIRED');
   const body=makeMurekaRequest(song);
   let response;
   try{
    response=await fetcher(MUREKA_BASE+'/v1/song/generate',{
     method:'POST',headers,body:JSON.stringify(body),redirect:'error',
     signal:AbortSignal.timeout(requestTimeoutMs)
    });
   }catch(_){throw new MurekaProviderError('MUREKA_SUBMISSION_OUTCOME_UNKNOWN');}
   if(!response?.ok)throw new MurekaProviderError('MUREKA_SUBMISSION_REJECTED');
   const result=await readResponse(response,'MUREKA_SUBMIT');
   return typedStatus(result);
  },
  async querySong(taskId){
   murekaTaskId(taskId);
   let response;
   try{
    response=await fetcher(MUREKA_BASE+'/v1/song/query/'+taskId,{
     method:'GET',headers:{Authorization:'Bearer '+apiKey},
     redirect:'error',signal:AbortSignal.timeout(requestTimeoutMs)
    });
   }catch(_){throw new MurekaProviderError('MUREKA_QUERY_RETRYABLE');}
   if(!response?.ok)throw new MurekaProviderError('MUREKA_QUERY_RETRYABLE');
   const result=await readResponse(response,'MUREKA_QUERY');
   return typedStatus(result,{taskId});
  },
  async downloadSong({audioUrl,allowedAudioHosts}={}){
   const url=allowedMurekaAudioUrl(audioUrl,allowedAudioHosts);
   let response;
   try{
    // Never send provider key to signed audio CDN.
    response=await fetcher(url,{method:'GET',redirect:'error',
     signal:AbortSignal.timeout(requestTimeoutMs)});
   }catch(_){throw new MurekaProviderError('MUREKA_AUDIO_FETCH_FAILED');}
   if(!response?.ok)throw new MurekaProviderError('MUREKA_AUDIO_FETCH_FAILED');
   const bytesText=response.headers?.get?.('content-length');
   if(bytesText&&Number(bytesText)>MUREKA_MAX_AUDIO_BYTES)
    throw new MurekaProviderError('MUREKA_AUDIO_TOO_LARGE');
   const type=response.headers?.get?.('content-type');
   if(type&&!(type.toLowerCase().startsWith('audio/')
    ||type.toLowerCase().startsWith('application/octet-stream')))
    throw new MurekaProviderError('MUREKA_AUDIO_NOT_AUDIO');
   let bytes;
   try{
    if(response.body?.getReader){
     const reader=response.body.getReader();
     const chunks=[];let total=0;
     try{
      for(;;){
       const {done,value}=await reader.read();
       if(done)break;
       total+=value.byteLength;
       if(total>MUREKA_MAX_AUDIO_BYTES)
        throw new MurekaProviderError('MUREKA_AUDIO_TOO_LARGE');
       chunks.push(Buffer.from(value));
      }
     }finally{reader.releaseLock();}
     bytes=Buffer.concat(chunks,total);
    }else bytes=Buffer.from(await response.arrayBuffer());
   }catch(error){
    if(error?.code==='MUREKA_AUDIO_TOO_LARGE')throw error;
    throw new MurekaProviderError('MUREKA_AUDIO_READ_FAILED');
   }
   if(bytes.byteLength<1024||bytes.byteLength>MUREKA_MAX_AUDIO_BYTES||!mp3Header(bytes))
    throw new MurekaProviderError('MUREKA_AUDIO_INVALID_MP3');
   return Object.freeze({bytes,sizeBytes:bytes.byteLength,
    contentType:'audio/mpeg',ext:'mp3'});
  }
 });
}
