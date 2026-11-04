import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {AppError,validateLyricInput,buildSunoPackage} from './lib.mjs';
import {makeLyrics,createSunoSong,SUNO_MCP_URL} from './providers.mjs';
import {publicCommerceReadiness,publicPriceCatalog} from './commerce.mjs';

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
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; frame-src https://suno.com https://*.suno.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self)');
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
    // Customer payment-related routes must fail closed until a durable,
    // licensed commercial fulfillment implementation passes verification.
    if(req.method==='GET'&&pathname==='/api/commerce/readiness')
      return json(res,200,publicCommerceReadiness());
    if(req.method==='GET'&&pathname==='/api/commerce/catalog')
      return json(res,200,publicPriceCatalog());
    if(pathname==='/api/commerce/orders'||pathname.startsWith('/api/commerce/orders/'))
      throw new AppError(503,'자동 음악 제작·결제·이메일 발송 서비스는 준비 중이며 현재 주문을 받지 않습니다.');
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
      // Consumer assistant MCP must never power a public commercial website.
      if(process.env.NODE_ENV==='production'||!isLocal)throw new AppError(403,'공개 서비스의 음악 생성은 별도 승인된 사업용 API가 연결될 때 제공됩니다.');
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
  // Only explicitly approved customer-facing assets may be served by the HTTPS API.
  // Never expose docs/*.md, the proprietary lyric prompt, source files or .env.
  const routes={
    '/':'docs/index.html',
    '/index.html':'docs/index.html',
    '/style.css':'docs/style.css',
    '/create.html':'docs/create.html',
    '/create.css':'docs/create.css',
    '/create.js':'docs/create.js',
    '/checkout.html':'docs/checkout.html',
    '/checkout.css':'docs/checkout.css',
    '/checkout.js':'docs/checkout.js',
    '/checkout-media.js':'docs/checkout-media.js',
    '/prices.json':'docs/prices.json',
    '/player.js':'docs/player.js',
    '/media/tracks.json':'docs/media/tracks.json',
    '/reviews/reviews.json':'docs/reviews/reviews.json',
    '/studio':'public/index.html',
    '/studio/':'public/index.html',
    '/app.js':'public/app.js',
    '/styles.css':'public/styles.css',
    '/favicon.svg':'public/favicon.svg'
  };
  let relative=routes[pathname];
  if(!relative && /^\/media\/[a-zA-Z0-9가-힣_.-]+\.(?:mp3|m4a|wav|ogg|txt|mp4)$/i.test(pathname))
    relative='docs'+pathname;
  if(!relative && /^\/reviews\/[a-zA-Z0-9가-힣_.-]+\.(?:mp4|webm)$/i.test(pathname))
    relative='docs'+pathname;
  if(!relative)throw new AppError(404,'파일을 찾지 못했습니다.');
  const full=path.join(appRoot,relative);
  let fileInfo;
  try{fileInfo=await stat(full);}
  catch(error){if(error?.code==='ENOENT')throw new AppError(404,'파일을 찾지 못했습니다.');throw error;}
  if(!fileInfo.isFile())throw new AppError(404,'파일을 찾지 못했습니다.');
  const mime={
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.svg':'image/svg+xml',
    '.json':'application/json; charset=utf-8',
    '.txt':'text/plain; charset=utf-8',
    '.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg',
    '.mp4':'video/mp4','.webm':'video/webm'
  };
  const size=fileInfo.size;
  const contentType=mime[path.extname(full).toLowerCase()]||'application/octet-stream';
  const basic={'Content-Type':contentType,'Accept-Ranges':'bytes','Cache-Control':'public, max-age=120'};
  const range=typeof req.headers.range==='string'?req.headers.range:'';
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match || (!match[1]&&!match[2])) {
      res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end();
    }
    let start=match[1]?Number(match[1]):null;
    let finish=match[2]?Number(match[2]):null;
    if(start===null){
      const suffix=finish;
      start=Math.max(0,size-suffix);finish=size-1;
    }else if(finish===null)finish=size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(finish)||start<0||finish<start||start>=size){
      res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end();
    }
    finish=Math.min(finish,size-1);
    res.writeHead(206,{...basic,'Content-Range':'bytes '+start+'-'+finish+'/'+size,'Content-Length':finish-start+1});
    if(req.method==='HEAD')return res.end();
    createReadStream(full,{start,end:finish}).on('error',()=>res.destroy()).pipe(res);
    return;
  }
  res.writeHead(200,{...basic,'Content-Length':size});
  if(req.method==='HEAD')return res.end();
  createReadStream(full).on('error',()=>res.destroy()).pipe(res);
  return;
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
