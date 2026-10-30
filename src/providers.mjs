import {AppError,buildMusicPrompt,buildLyricPrompt,extractAudio} from './lib.mjs';

const GOOGLE_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';
const MODEL = 'lyria-3-clip-preview';

export function requireKey(env, name) {
  if (!env[name]) throw new AppError(503, `${name} 환경변수가 설정되지 않았습니다. 실제 AI 생성 기능을 사용할 수 없습니다.`);
  return env[name];
}

async function apiFetch(url, opts, timeout = 180_000) {
  let resp;
  try { resp = await fetch(url, { ...opts, signal:AbortSignal.timeout(timeout) }); }
  catch (e) { throw new AppError(502,`외부 AI 서비스 연결 실패 또는 시간 초과: ${e.name ?? 'network'}`); }
  if (!resp.ok) {
    // Do not leak provider body (which may contain user material) into client logs.
    throw new AppError(502,`외부 AI 서비스 오류 (${new URL(url).hostname}, HTTP ${resp.status}). API 키·권한·요금제·요청 규격을 확인하세요.`);
  }
  return resp;
}

export async function makeLyrics(input,env=process.env) {
  const key=requireKey(env,'GEMINI_API_KEY');
  const model=env.GEMINI_LYRICS_MODEL || 'gemini-2.5-flash';
  if(!/^[a-zA-Z0-9_.-]{3,80}$/.test(model)) throw new AppError(500,'잘못된 가사 모델 이름입니다.');
  const response=await apiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
    method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents:[{parts:[{text:buildLyricPrompt(input)}]}],generationConfig:{temperature:0.65,maxOutputTokens:1300}})
  },60_000);
  const result=await response.json();
  const text=(result?.candidates?.[0]?.content?.parts ?? []).map(p=>p.text??'').join('\n').trim()
    .replace(/^```(?:text|markdown)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(text.length<12 || text.length>1400 || !/\[Verse\]|\[Chorus\]/i.test(text))
    throw new AppError(502,'가사 생성 결과가 예상 형식과 다릅니다. 다시 생성하거나 직접 작성해 주세요.');
  return text;
}

export async function makeMusic(input, env=process.env) {
  const key = requireKey(env,'GEMINI_API_KEY');
  const response = await apiFetch(GOOGLE_URL, {
    method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({model:MODEL,input:buildMusicPrompt(input)})
  }, 210_000);
  const result = extractAudio(await response.json());
  if (result.bytes.length < 1024 || result.bytes.length > 35_000_000) throw new AppError(502,'음악 API의 응답 크기가 비정상적입니다.');
  return result;
}

export async function cloneVoice({buffer,mime,ext,name}, env=process.env) {
  const key = requireKey(env,'ELEVENLABS_API_KEY');
  const body = new FormData();
  body.append('name',name);
  body.append('files',new Blob([buffer],{type:mime}),`voice.${ext}`);
  const resp = await apiFetch(`${ELEVEN_BASE}/voices/add`, {method:'POST',headers:{'xi-api-key':key},body});
  const payload = await resp.json();
  if (!payload?.voice_id) throw new AppError(502,'음색 등록 API가 음성 ID를 반환하지 않았습니다.');
  return {voiceId:payload.voice_id,requiresVerification:payload.requires_verification===true};
}

export async function removeVoice(voiceId,env=process.env) {
  const key = requireKey(env,'ELEVENLABS_API_KEY');
  await apiFetch(`${ELEVEN_BASE}/voices/${encodeURIComponent(voiceId)}`,{method:'DELETE',headers:{'xi-api-key':key}});
}

export async function separateStems(audio,env=process.env) {
  const key = requireKey(env,'ELEVENLABS_API_KEY');
  const body = new FormData();
  body.append('file',new Blob([audio],{type:'audio/mpeg'}),'generated.mp3');
  body.append('stem_variation_id','two_stems_v1');
  const resp = await apiFetch(`${ELEVEN_BASE}/music/stem-separation`,{
    method:'POST',headers:{'xi-api-key':key},body
  },240_000);
  const zip = Buffer.from(await resp.arrayBuffer());
  if (zip.length < 100 || zip.length > 100_000_000 || zip.subarray(0,2).toString()!=='PK') throw new AppError(502,'스템 분리 결과 ZIP이 올바르지 않습니다.');
  return zip;
}

export async function convertVoice(audio,voiceId,env=process.env) {
  const key = requireKey(env,'ELEVENLABS_API_KEY');
  const body = new FormData();
  body.append('audio',new Blob([audio],{type:'audio/mpeg'}),'vocals.mp3');
  body.append('model_id','eleven_multilingual_sts_v2');
  const resp = await apiFetch(`${ELEVEN_BASE}/voice-changer/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,{
    method:'POST',headers:{'xi-api-key':key},body
  },240_000);
  const result=Buffer.from(await resp.arrayBuffer());
  if (result.length < 1024 || result.length > 50_000_000) throw new AppError(502,'목소리 변환 응답 오디오가 비정상적입니다.');
  return result;
}
