import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {AppError,validateLyricInput,buildSunoPackage} from './lib.mjs';
import {makeLyrics,createSunoSong,SUNO_MCP_URL} from './providers.mjs';

// Single-operator local MVP. Public multi-user deployment requires an
// authenticated OAuth PKCE flow and per-user Suno credential vault.
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.HOST||'127.0.0.1';
const port=Number(process.env.PORT||3000);
const accessToken=process.env.APP_ACCESS_TOKEN||'';
const isLocal=['127.0.0.1','localhost','::1'].includes(host);
if(!isLocal&&!accessToken)throw new Error('APP_ACCESS_TOKEN is required for non-localhost deployments');
const requests=new Map();
function json(res,status,body){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function harden(res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(self)');
}
async function jsonBody(req,limit=50000){
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError(413,'입력 내용이 너무 큽니다.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch(_){throw new AppError(400,'올바른 JSON을 입력해 주세요.');}
}
function auth(req){
  if(accessToken&&req.headers['x-app-token']!==accessToken)throw new AppError(401,'개발용 접근 토큰이 필요합니다.');
}
function limited(req,max=15){
  const ip=req.socket.remoteAddress||'local',now=Date.now();
  let item=requests.get(ip);
  if(!item||now-item.start>3600000)item={start:now,count:0};
  if(++item.count>max)throw new AppError(429,'시간당 생성 요청 한도를 초과했습니다.');
  requests.set(ip,item);
}
async function handle(req,res){
  harden(res);
  const u=new URL(req.url,'http://'+host+':'+port);
  const pathname=u.pathname;
  // Public health check: no user data, credentials, providers, or capability claims.
  if(req.method==='GET'&&pathname==='/healthz')return json(res,200,{status:'ok',service:'withu-api'});
  if(pathname.startsWith('/api/')){
    auth(req);
    if(req.method==='GET'&&pathname==='/api/config')
      return json(res,200,{
        lyricsProvider:'openai',lyricsReady:!!process.env.OPENAI_API_KEY,
        musicProvider:'suno-mcp',sunoMcpUrl:SUNO_MCP_URL,
        sunoHandoffReady:true,
        sunoAutomatedGenerationReady:!!(process.env.OPENAI_API_KEY&&process.env.SUNO_MCP_ACCESS_TOKEN&&accessToken),
        sunoOAuthRequired:!process.env.SUNO_MCP_ACCESS_TOKEN,
        localOnly:isLocal
      });
    if(req.method==='POST'&&pathname==='/api/lyrics'){
      limited(req);const input=validateLyricInput(await jsonBody(req));
      return json(res,200,{lyrics:await makeLyrics(input)});
    }
    if(req.method==='POST'&&pathname==='/api/suno-package'){
      return json(res,200,buildSunoPackage(await jsonBody(req)));
    }
    if(req.method==='POST'&&pathname==='/api/suno-mcp/create'){
      // Never issue a credit-spending tool call from an unauthenticated web UI.
      if(!accessToken)throw new AppError(503,'Suno 자동 생성에는 서버 접근 토큰과 인증된 Suno OAuth 연결이 필요합니다.');
      limited(req,6);
      const input=await jsonBody(req);
      if(input.confirmedCreditSpend!==true||input.consentMcpDataTransfer!==true)
        throw new AppError(400,'Suno 크레딧 사용 및 입력 정보 전송에 대한 명시적 확인이 필요합니다.');
      return json(res,200,await createSunoSong(input));
    }
    if(pathname==='/api/jobs'||pathname==='/api/voices'||pathname.startsWith('/api/jobs/')||pathname.startsWith('/api/voices/'))
      throw new AppError(410,'이전 Lyria/ElevenLabs 경로는 비활성화되었습니다. GPT 작사와 Suno 공식 MCP를 사용하세요.');
    throw new AppError(404,'해당 API가 없습니다.');
  }
  if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError(405,'허용되지 않은 요청입니다.');
  const filename=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js','styles.css','favicon.svg'].includes(filename))
    throw new AppError(404,'파일을 찾지 못했습니다.');
  const full=path.join(appRoot,'public',filename);
  const bytes=await readFile(full);
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-cache'});
  return res.end(req.method==='HEAD'?undefined:bytes);
}
export function createApp(){
  return http.createServer((req,res)=>{void handle(req,res).catch(error=>{
    if(!res.headersSent)json(res,error instanceof AppError?error.status:500,{
      error:error instanceof AppError?error.message:'서버 처리 오류가 발생했습니다.'
    });else res.destroy();
  });});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createApp().listen(port,host,()=>console.log('SONG GPT + official Suno MCP: http://'+host+':'+port));
}
