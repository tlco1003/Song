import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {requireProductionId,tokenHash,makeOpaqueToken,authorizeOrderMedia} from './production-contract.mjs';
export const UPGRADE_PRICE=10000;
export const LINK_TTL=90*86400000;
export const SESSION_TTL=7*86400000;
export const now=()=>Date.now();
export function stop(status,message){const e=new Error(message);e.status=status;throw e;}
export function respond(res,status,value){
 res.set('Cache-Control','private, no-store');
 res.status(status).json(value);
}
export function json(req,limit=20000){
 if(!req.is('application/json'))stop(415,'JSON 요청만 가능합니다.');
 if(!Buffer.isBuffer(req.rawBody)||req.rawBody.length>limit
   ||!req.body||typeof req.body!=='object'||Array.isArray(req.body))
  stop(400,'요청 데이터가 올바르지 않습니다.');
 return req.body;
}
export function checkOrigin(req,env){
 const configured=new URL(env.WITHU_PUBLIC_BASE_URL||'https://invalid.example');
 if(req.get('origin')!==configured.origin)
  stop(403,'같은 사이트에서만 요청할 수 있습니다.');
}
export function hash(value){return createHash('sha256').update(value).digest('hex');}
export function encodeSecret(token,keyHex){
 if(!/^[a-f0-9]{64}$/i.test(keyHex||''))stop(503,'링크 비밀 암호화 키가 누락됐습니다.');
 const iv=randomBytes(12),aes=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);
 const encrypted=Buffer.concat([aes.update(token,'utf8'),aes.final()]);
 return {iv:iv.toString('base64url'),tag:aes.getAuthTag().toString('base64url'),
  data:encrypted.toString('base64url')};
}
export function decodeSecret(item,keyHex){
 if(!/^[a-f0-9]{64}$/i.test(keyHex||''))stop(503,'링크 비밀 암호화 키가 누락됐습니다.');
 const aes=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),
  Buffer.from(item.iv,'base64url'));
 aes.setAuthTag(Buffer.from(item.tag,'base64url'));
 return Buffer.concat([aes.update(Buffer.from(item.data,'base64url')),aes.final()]).toString('utf8');
}
export async function admin(req,auth,env){
 const match=/^Bearer ([A-Za-z0-9._-]{50,6000})$/.exec(req.get('authorization')||'');
 if(!match)stop(401,'관리자 로그인이 필요합니다.');
 let user;try{user=await auth.verifyIdToken(match[1],true);}catch(_){stop(403,'관리자 인증 실패');}
 if(!env.WITHU_ADMIN_UID||user.uid!==env.WITHU_ADMIN_UID||user.email_verified!==true)
  stop(403,'해당 관리자는 접근 권한이 없습니다.');
 return user;
}
function sessionValue(req){
 const cookies=String(req.headers.cookie||'');
 return (cookies.match(/(?:^|;\s*)withu_session=([A-Za-z0-9_-]{43})(?=;|$)/)||[])[1]||null;
}
export async function currentSession(req,db){
 const value=sessionValue(req);
 if(!value)stop(401,'고객 전용 감상 링크가 필요합니다.');
 const s=await db.collection('withuSessions').doc(tokenHash(value)).get();
 if(!s.exists||s.data()?.expiresAt<=now())stop(401,'감상 세션이 만료됐습니다.');
 return {orderId:s.data().orderId};
}
export function countTracks(o){return o.productId==='audio_duo'?2:1;}
export function paid(o){
 if(o?.paymentStatus!=='paid'||!o.paymentKey||!o.paymentVerifiedAt
  ||o.state==='refunded')stop(403,'실제 결제가 확인된 주문이 아닙니다.');
 return o;
}
export function approvedTracks(o){
 const n=countTracks(o);
 if(!Array.isArray(o.tracks)||o.tracks.length!==n||o.tracks.some((t,i)=>
  !t||t.index!==i+1||!t.storagePath?.startsWith('orders/'+o.id+'/')
  ||typeof t.lyrics!=='string'||t.lyrics.length<12
  ||!t.title||t.reviewed!==true))
  stop(409,'구매곡의 최종 음원·가사·검수가 완료되지 않았습니다.');
 return o.tracks;
}
export function visibleTracks(o,{downloadGranted=false}={}){
 const upgraded=downloadGranted===true&&o.upgrade?.paymentStatus==='paid'&&o.upgrade?.rightsVerified===true;
 return approvedTracks(o).map((t,i)=>({
  index:i+1,title:t.title,genre:t.genre,
  file:'withu_song_'+(i+1)+'.'+(t.ext||'mp3'),
  productType:'audio_with_cover',mediaKind:'audio',
  privateMediaUrl:'/api/delivery-assets/'+o.id+'_'+(i+1),
  lyrics:t.lyrics,orderRef:'ord_'+o.id.slice(6),
  commercialUpgrade:upgraded?{
   status:'active',paymentVerified:true,rightsVerified:true,amountKrw:UPGRADE_PRICE
  }:o.upgrade?.rightsVerified===true?{
   status:'available',rightsVerified:true,amountKrw:UPGRADE_PRICE
  }:{status:'unavailable',amountKrw:UPGRADE_PRICE},
  ...(upgraded?{privateDownloadUrl:'/api/delivery-downloads/'+o.id+'_'+(i+1)}:{})
 }));
}
export function customerResponse(o,{downloadGranted=false}={}){
 const tracks=visibleTracks(o,{downloadGranted});
 return {status:'delivered',tracks,track:tracks[0],
  commercialUpgrade:tracks[0].commercialUpgrade};
}
export async function customerOrder(req,db){
 const s=await currentSession(req,db);
 const snap=await db.collection('withuOrders').doc(s.orderId).get();
 if(!snap.exists)stop(404,'주문이 존재하지 않습니다.');
 const o=snap.data();
 paid(o);
 if(o.delivery?.status!=='sent')stop(403,'전달되지 않은 주문입니다.');
 return o;
}
export function adminSummary(o){
 return {id:o.id,createdAt:o.createdAt,productId:o.productId,
  customerEmail:o.contact?.customerEmail,customerPhone:o.contact?.customerPhone,
  deliveryChannel:o.contact?.deliveryChannel,genreSelection:o.genreSelection,
  amountKrw:o.amountKrw,paymentStatus:o.paymentStatus,
  production:o.production||null,delivery:{status:o.delivery?.status||'not_sent',
   messageId:o.delivery?.messageId||null},
  upgrade:{paymentStatus:o.upgrade?.paymentStatus||'none',
   rightsVerified:o.upgrade?.rightsVerified===true},
  tracks:o.tracks||[],story:o.draft?.story||null,
  songStyles:o.draft?.songStyles||null,
  trackPreferences:o.draft?.trackPreferences||null,
  privateProductionPlan:o.privateProductionPlan?.songs?.map(s=>({index:s.index,
   genre:s.genre,mood:s.mood,eraPreference:s.eraPreference,
   stylePrompt:s.stylePrompt}))||null,
  confirmedLyrics:o.confirmedLyrics||null,songTitle:o.draft?.title||null
 };
}
export function linkUrl(env,token){
 return new URL('gift.html#delivery='+token,env.WITHU_PUBLIC_BASE_URL).href;
}
export function requireOrderPath(id){return requireProductionId(id);}
