/**
 * Optional paid image-creation provider for the admin/prototype environment.
 * OpenAI key stays on the server. Public static GitHub Pages never calls this
 * provider directly. Do not activate multi-customer use without authentication,
 * limits, pricing, privacy controls and commercial authorization.
 */
export function buildCoverPrompt(input){
 if(!input||typeof input!=='object')throw new TypeError('입력값이 없습니다.');
 const trim=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';
 const title=trim(input.title,100),genre=trim(input.genre,70),mood=trim(input.prompt,700);
 if(mood.length<5)throw new TypeError('이미지에 담을 장면을 5자 이상 작성해 주세요.');
 return [
  'Create a premium SQUARE 1:1 album cover illustration for a heartfelt Korean song gift.',
  'The result should look like carefully art-directed music cover photography or painterly fine art, not a UI screenshot.',
  'No artist impersonation, no logos, no watermarks, no legible typography or song title text.',
  title?'Song title as context: '+title+'.':'',
  genre?'Music genre/mood: '+genre+'.':'',
  'Customer scene description: '+mood+'.',
  'One coherent subject, elegant cinematic lighting, refined composition, emotionally resonant color palette.',
  'Suitable for a 1024x1024 music cover.'
 ].filter(Boolean).join(' ');
}
export async function generateCoverImage(input,{apiKey=process.env.OPENAI_API_KEY,fetchImpl=fetch}={}){
 if(!apiKey)throw new Error('이미지 생성 API 설정이 없습니다.');
 const prompt=buildCoverPrompt(input);
 const model=['gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(process.env.OPENAI_IMAGE_MODEL)
  ?process.env.OPENAI_IMAGE_MODEL:'gpt-image-2.5-flare';
 const response=await fetchImpl('https://api.openai.com/v1/images/generations',{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
  body:JSON.stringify({model,prompt,n:1,size:'1024x1024',quality:'medium',output_format:'webp',output_compression:80}),
  signal:AbortSignal.timeout(120000)
 });
 if(!response.ok)throw new Error('이미지 생성 요청에 실패했습니다. 모델 권한이나 API 사용량을 확인해 주세요.');
 const output=await response.json();
 const base64=output.data?.[0]?.b64_json;
 if(typeof base64!=='string'||!base64||base64.length>12_000_000||!/^[A-Za-z0-9+/=]+$/.test(base64))
  throw new Error('생성된 커버 이미지 데이터가 올바르지 않습니다.');
 return {image:'data:image/webp;base64,'+base64,model};
}
