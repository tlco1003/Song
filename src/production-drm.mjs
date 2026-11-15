/** DRM gateway boundary. No content keys or provider credentials reach the browser. */
import {createHmac,randomUUID} from 'node:crypto';
import {stop,respond,checkOrigin,currentSession,paid,approvedTracks} from './production-runtime.mjs';
import {authorizeOrderMedia} from './production-contract.mjs';
export const DRM_SYSTEMS={widevine:'com.widevine.alpha',fairplay:'com.apple.fps',playready:'com.microsoft.playready'};
const MAX_BYTES=2*1024*1024;
function https(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash)return u.href;}catch{}
 stop(503,'DRM HTTPS 설정이 올바르지 않습니다.');
}
export function drmConfig(track){
 const d=track?.drm;
 if(d===undefined||d===null)return null;
 if(d.required!==true||d.packagingVerified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(d.assetId||'')
  ||!Array.isArray(d.systems)||!d.systems.length||d.systems.some(s=>!Object.hasOwn(DRM_SYSTEMS,s)))
  stop(503,'DRM 암호화 음원 검증이 필요합니다.');
 const manifestUrl=https(d.manifestUrl);
 const certificate=d.fairplayCertificateBase64;
 if(d.systems.includes('fairplay')&&(!certificate||typeof certificate!=='string'
  ||certificate.length>32768||!/^[A-Za-z0-9+/]+={0,2}$/.test(certificate)))
  stop(503,'FairPlay 공개 인증서가 필요합니다.');
 return {required:true,assetId:d.assetId,manifestUrl,systems:[...new Set(d.systems)],
  ...(d.systems.includes('fairplay')?{fairplayCertificateBase64:certificate}:{})};
}
export function drmPlayback(track,orderId,index){
 const d=drmConfig(track);if(!d)return undefined;
 return {required:true,configUrl:'/api/delivery-drm/'+orderId+'_'+index+'/config'};
}
function gateway(env){
 if(env.WITHU_DRM_GATEWAY_VERIFIED!=='true'||!/^.{32,}$/.test(env.WITHU_DRM_GATEWAY_SIGNING_KEY||''))
  stop(503,'DRM 공급자 연결 검증이 필요합니다.');
 return https(env.WITHU_DRM_GATEWAY_URL);
}
export function gatewayGrant(d,system,orderId,secret,at=Date.now()){
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const head=encode({alg:'HS256',typ:'JWT'});
 const payload=encode({iss:'withu',aud:'withu-drm-gateway',sub:orderId,
  assetId:d.assetId,system,iat:Math.floor(at/1000),exp:Math.floor(at/1000)+60,jti:randomUUID()});
 const input=head+'.'+payload;
 return input+'.'+createHmac('sha256',secret).update(input).digest('base64url');
}
async function boundedBody(response){
 if(!response.body?.getReader)stop(502,'DRM 공급자 응답이 올바르지 않습니다.');
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;
  total+=value.length;if(total>MAX_BYTES){await reader.cancel();stop(502,'DRM 응답 크기 초과');}chunks.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 if(!total)stop(502,'DRM 라이선스가 비어 있습니다.');
 return Buffer.concat(chunks);
}
export async function handleProductionDrm(req,res,{db,env,fetcher}){
 const path=new URL(req.originalUrl||req.url,'https://placeholder.invalid').pathname;
 const match=/^\/api\/delivery-drm\/(withu_[a-f0-9]{32})_([12])\/(config|widevine|fairplay|playready)$/.exec(path);
 if(!match)return false;
 const action=match[3];
 if(req.method!==(action==='config'?'GET':'POST'))stop(405,'지원하지 않는 DRM 요청입니다.');
 if(action!=='config')checkOrigin(req,env);
 const session=await currentSession(req,db);
 const snap=await db.collection('withuOrders').doc(session.orderId).get();
 if(!snap.exists)stop(404,'주문을 찾을 수 없습니다.');
 const order=snap.data();paid(order);
 try{authorizeOrderMedia({sessionOrderId:session.orderId,assetOrderId:match[1],kind:'playback',order});}
 catch{stop(403,'이 주문의 DRM 접근 권한이 없습니다.');}
 const d=drmConfig(approvedTracks(order)[Number(match[2])-1]);
 if(!d)stop(404,'DRM 음원이 아닙니다.');
 const upstream=gateway(env);
 if(action==='config'){
  const base='/api/delivery-drm/'+match[1]+'_'+match[2]+'/';
  const servers=Object.fromEntries(d.systems.map(s=>[DRM_SYSTEMS[s],base+s]));
  respond(res,200,{required:true,manifestUrl:d.manifestUrl,servers,
   ...(d.fairplayCertificateBase64?{fairplayCertificateBase64:d.fairplayCertificateBase64}:{})});
  return true;
 }
 if(!d.systems.includes(action))stop(403,'허용되지 않은 DRM 시스템입니다.');
 if(!Buffer.isBuffer(req.rawBody)||!req.rawBody.length||req.rawBody.length>MAX_BYTES)
  stop(413,'DRM 요청 크기가 올바르지 않습니다.');
 // Bound paid license requests per order, across server instances.
 await db.runTransaction(async tx=>{
  const ref=db.collection('withuDrmLimits').doc(order.id+'_'+Math.floor(Date.now()/600000));
  const snap=await tx.get(ref);const count=Number(snap.data()?.count||0);
  if(count>=120)stop(429,'잠시 후 보호 음원을 다시 재생해 주세요.');
  tx.set(ref,{count:count+1,deleteAfter:new Date(Date.now()+86400000)});
 });
 // The verified gateway MUST bind every KID in this opaque CDM challenge to
 // assetId in the signed JWT, reject mismatches and return a raw CDM license.
 let response,bytes;
 try{
  const signal=AbortSignal.timeout(15000);
  response=await fetcher(upstream,{method:'POST',redirect:'error',signal,
   headers:{'Content-Type':'application/octet-stream',Authorization:'Bearer '+
    gatewayGrant(d,action,order.id,env.WITHU_DRM_GATEWAY_SIGNING_KEY)},body:req.rawBody});
  if(!response.ok)stop(502,'DRM 라이선스 발급에 실패했습니다.');
  bytes=await boundedBody(response);
 }catch{stop(502,'DRM 라이선스 발급에 실패했습니다.');}
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Type','application/octet-stream');
 res.status(200).send(bytes);return true;
}
