import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {AppError,validateSong,validateLyricInput,validateRecording,validateVoiceId,newId,publicJob,buildSunoPackage} from './lib.mjs';
import {cloneVoice,removeVoice,makeLyrics,makeMusic,separateStems,convertVoice} from './providers.mjs';
import {unzipStems,mixVocals} from './audio.mjs';

// Local-first prototype: no sign-up, database, or hosted multi-tenant identity.
// Production deployment requires proper auth, isolation, billing control and legal review.
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataRoot=path.join(appRoot,'.song-data');
const host=process.env.HOST || '127.0.0.1';
const port=Number(process.env.PORT || 3000);
const accessToken=process.env.APP_ACCESS_TOKEN || '';
if (!['127.0.0.1','localhost','::1'].includes(host) && !accessToken) {
  throw new Error('Non-loopback HOST requires APP_ACCESS_TOKEN; this prototype is not production-ready.');
}
const ttlMin=Math.min(1440,Math.max(5,Number(process.env.ASSET_TTL_MINUTES || 60)));
const jobs=new Map();
const requests=new Map();
let running=0;

const mime={'/':'text/html; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
function respond(res,status,data,headers={}) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
function harden(res) {res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");res.setHeader('Permissions-Policy','camera=(), microphone=(self)');}
async function jsonBody(req,limit=14_500_000) {let size=0; const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError(413,'요청 본문이 너무 큽니다.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch {throw new AppError(400,'올바른 JSON이 아닙니다.');}}
function limited(ip) {const t=Date.now();let r=requests.get(ip);if(!r || t-r.start>3600000)r={start:t,count:0};r.count++;requests.set(ip,r);if(r.count>15)throw new AppError(429,'시간당 유료 API 요청 한도를 초과했습니다.');}
function auth(req) {if(accessToken && req.headers['x-app-token']!==accessToken)throw new AppError(401,'앱 접근 토큰이 필요합니다.');}
async function clearJob(job) { jobs.delete(job.id);await rm(path.join(dataRoot,job.id),{recursive:true,force:true}).catch(()=>{}); }
async function purgeOld() {for(const j of jobs.values())if(j.status!=='running' && Date.now()-j.createdAt>ttlMin*60000)await clearJob(j);for(const [ip,r] of requests)if(Date.now()-r.start>3600000)requests.delete(ip);}

async function saveAudio(job,name,data) {const folder=path.join(dataRoot,job.id);await mkdir(folder,{recursive:true,mode:0o700});await writeFile(path.join(folder,`${name}.mp3`),data,{mode:0o600});job.assets[name]=true;}
async function runJob(job,input) {
  running++;job.status='running';
  try {
    job.stage='작곡·가창 생성 중';
    const song=await makeMusic(input);await saveAudio(job,'original',song.bytes);job.lyrics=typeof song.lyrics==='string'?song.lyrics.slice(0,4000):'';
    job.stage='리드 보컬과 반주 분리 중';
    const zip=await separateStems(song.bytes);const stems=await unzipStems(zip);
    await saveAudio(job,'vocals',stems.vocals);await saveAudio(job,'instrumental',stems.instrumental);
    job.stage='내 목소리로 변환 중';
    const converted=await convertVoice(stems.vocals,input.voiceId);await saveAudio(job,'converted',converted);
    job.stage='반주와 보컬 믹싱 중';
    const final=await mixVocals(stems.instrumental,stems.vocals,converted);await saveAudio(job,'final',final);
    job.stage='완료 · 실제 가창 품질은 청취 검증 필요';job.status='completed';
  }catch(error){job.status='failed';job.stage='실패';job.error=error instanceof AppError?error.message:'처리 중 오류가 발생했습니다. 서버에서 상태를 확인하세요.';console.error(`[job:${job.id}] ${error.name}: ${error.message}`);}
  finally{running--;}
}

async function handle(req,res) {
  harden(res);
  const u=new URL(req.url,`http://${host}:${port}`);const pathname=u.pathname;
  if(pathname.startsWith('/api/')) {
    auth(req);
    if(req.method==='GET' && pathname==='/api/config')return respond(res,200,{musicReady:!!process.env.GEMINI_API_KEY,voiceReady:!!process.env.ELEVENLABS_API_KEY,ffmpegRequired:true,localOnly:['127.0.0.1','localhost','::1'].includes(host),ttlMinutes:ttlMin,sunoHandoffReady:true,sunoAutomatedGenerationReady:false,musicTarget:'Suno (Custom Mode)'});
    if(req.method==='POST' && pathname==='/api/lyrics') {
      limited(req.socket.remoteAddress??'local');
      const input=validateLyricInput(await jsonBody(req,10_000));
      return respond(res,200,{lyrics:await makeLyrics(input)});
    }
    if(req.method==='POST' && pathname==='/api/suno-package') {
      const input=await jsonBody(req,30_000);
      return respond(res,200,buildSunoPackage(input));
    }
    if(req.method==='POST' && pathname==='/api/voices') {
      limited(req.socket.remoteAddress??'local');const sample=validateRecording(await jsonBody(req));
      const created=await cloneVoice(sample);return respond(res,201,created);
    }
    if(req.method==='DELETE' && /^\/api\/voices\/[a-zA-Z0-9_-]+$/.test(pathname)) {
      limited(req.socket.remoteAddress??'local');await removeVoice(validateVoiceId(pathname.split('/')[3]));return respond(res,200,{deleted:true});
    }
    if(req.method==='POST' && pathname==='/api/jobs') {
      if(process.env.LEGACY_LYRIA_ENABLED!=='true')throw new AppError(410,'음악 제작 대상을 Suno로 변경했습니다. 이 엔드포인트의 기존 Lyria 실험은 기본 비활성화입니다. Suno 공식 API 계약 전에는 /api/suno-package로 가사와 스타일을 준비하세요.');
      limited(req.socket.remoteAddress??'local');
      if(!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY)throw new AppError(503,'GEMINI_API_KEY 및 ELEVENLABS_API_KEY가 모두 필요합니다.');
      if(running>=2)throw new AppError(429,'동시 생성 작업이 많습니다. 이전 작업이 끝난 후 다시 시도해 주세요.');
      const input=validateSong(await jsonBody(req,10_000));
      const job={id:newId(),createdAt:Date.now(),status:'queued',stage:'준비 중',error:null,assets:{},lyrics:'',requestedLyrics:input.lyrics};jobs.set(job.id,job);
      void runJob(job,input);
      return respond(res,202,publicJob(job));
    }
    const info=pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(?:\/audio\/(original|vocals|instrumental|converted|final))?$/);
    if(info){const job=jobs.get(info[1]);if(!job)throw new AppError(404,'작업을 찾지 못했습니다. 저장 기한이 지났을 수 있습니다.');
      if(req.method==='DELETE'&&!info[2]){if(job.status==='running')throw new AppError(409,'실행 중에는 삭제할 수 없습니다. 완료 후 삭제해 주세요.');await clearJob(job);return respond(res,200,{deleted:true});}
      if(req.method==='GET'&&!info[2])return respond(res,200,publicJob(job));
      if(req.method==='GET'&&info[2]&&job.assets[info[2]]){
        const location=path.join(dataRoot,job.id,`${info[2]}.mp3`);
        const bytes=await readFile(location);res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store','Content-Disposition':`inline; filename="${info[2]}.mp3"`});return res.end(bytes);
      }
    }
    throw new AppError(404,'해당 API가 없습니다.');
  }
  if(req.method!=='GET' && req.method!=='HEAD')throw new AppError(405,'허용되지 않은 요청입니다.');
  const filename=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js','styles.css','favicon.svg'].includes(filename))throw new AppError(404,'파일을 찾지 못했습니다.');
  const full=path.join(appRoot,'public',filename);const content=await readFile(full);const type=mime[path.extname(full)]??'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Content-Length':content.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
}

export function createApp() {return http.createServer((req,res)=>{void handle(req,res).catch(e=>{const status=e instanceof AppError?e.status:500;if(!(e instanceof AppError))console.error(e);if(!res.headersSent)respond(res,status,{error:e instanceof AppError?e.message:'서버 오류가 발생했습니다.'});else res.destroy();});});}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await mkdir(dataRoot,{recursive:true,mode:0o700});
  const server=createApp();server.listen(port,host,()=>console.log(`SONG local prototype: http://${host}:${port}`));
  setInterval(()=>{void purgeOld()},15*60*1000).unref();
}
