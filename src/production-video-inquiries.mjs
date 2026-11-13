/**
 * WITHU premium-video pilot inquiries.
 * Real Firebase Firestore lead intake, not a payment system or a video generator.
 * Reuses the existing Cloud Functions API, admin identity and origin checks.
 * Fail-closed until actual business/privacy policy and intake operations are approved.
 */
import {createHmac,randomBytes} from 'node:crypto';
import {admin,now,json,checkOrigin,stop,respond} from './production-runtime.mjs';

const INQUIRY_ID=/^vad_[a-f0-9]{32}$/;
const CATEGORIES=new Set(['food','beauty','lifestyle','other']);
const FORMATS=new Set(['vertical_15s','horizontal_15s','both_15s','consult']);
const BUDGETS=new Set(['under_300k','300k_to_600k','over_600k','undecided']);
const STATUS=new Set(['received','reviewing','quote_prepared','awaiting_customer','closed']);
const RETENTION_DAYS=90;
const MS_DAY=86400000;

export function videoAdIntakeEnabled(env={}){
 return env.WITHU_VIDEO_AD_INQUIRIES_ENABLED==='true'
  &&env.WITHU_VIDEO_AD_PRIVACY_REVIEWED==='true'
  &&env.WITHU_VIDEO_AD_OPERATOR_VERIFIED==='true'
  &&typeof env.WITHU_VIDEO_LEAD_HMAC_KEY==='string'
  &&env.WITHU_VIDEO_LEAD_HMAC_KEY.length>=32
  &&/^https:\/\/[^/]+\/?$/.test(env.WITHU_PUBLIC_BASE_URL||'')
  &&typeof env.WITHU_ADMIN_UID==='string'
  &&env.WITHU_ADMIN_UID.length>=10;
}

function clean(value,label,{min=0,max=250}={}){
 if(typeof value!=='string'||value.length>max*2)throw new Error(label+' 형식이 올바르지 않습니다.');
 const s=value.trim().replace(/[ \t]+/g,' ');
 if(s.length<min||s.length>max||/[\u0000-\u001f\u007f<>]/u.test(s))
  throw new Error(label+' 입력 길이 또는 특수문자를 확인해 주세요.');
 return s;
}

export function normalizeVideoAdInquiry(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new Error('상담 요청 형식이 올바르지 않습니다.');
 const allowed=new Set(['brand','email','product','productUrl','category','format','budget','brief',
  'rightsConfirmed','privacyAccepted','replyAccepted','policyVersion','honeypot']);
 if(Object.keys(input).some(key=>!allowed.has(key)))
  throw new Error('지원되지 않는 상담 항목이 포함됐습니다.');
 if(input.honeypot)throw new Error('자동화된 문의 요청을 처리할 수 없습니다.');
 if(input.policyVersion!=='video-ads-pilot-v1'
  ||input.rightsConfirmed!==true||input.privacyAccepted!==true
  ||input.replyAccepted!==true)
  throw new Error('저작권·개인정보 처리·견적 연락에 대한 확인이 필요합니다.');
 if(!CATEGORIES.has(input.category)||!FORMATS.has(input.format)||!BUDGETS.has(input.budget))
  throw new Error('광고 종류 또는 예산 선택이 올바르지 않습니다.');
 const email=clean(input.email,'이메일',{min:6,max:254}).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('이메일 주소를 확인해 주세요.');
 const productUrl=input.productUrl?clean(input.productUrl,'제품 링크',{max:500}):'';
 if(productUrl){
  let url;
  try{url=new URL(productUrl);}
  catch(_){throw new Error('제품 링크는 https 주소여야 합니다.');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password)
   throw new Error('제품 링크는 안전한 https 주소만 가능합니다.');
 }
 return Object.freeze({
  brand:clean(input.brand,'브랜드명',{min:2,max:100}),
  email,
  product:clean(input.product,'제품명',{min:2,max:120}),
  productUrl,
  category:input.category,format:input.format,budget:input.budget,
  brief:clean(input.brief,'광고 설명',{min:20,max:1500}),
  policyVersion:'video-ads-pilot-v1',
  rightsConfirmed:true,privacyAccepted:true,replyAccepted:true
 });
}

function clientNetworkKey(req,env,day){
 const ip=String(req.ip||req.socket?.remoteAddress||'unknown');
 return createHmac('sha256',env.WITHU_VIDEO_LEAD_HMAC_KEY)
  .update('video-lead/v1|'+day+'|'+ip).digest('hex');
}

export async function handleVideoAdInquiries(req,res,{db,auth,env}){
 const pathname=new URL(req.originalUrl||req.url,'https://invalid.example').pathname;

 if(req.method==='GET'&&pathname==='/api/video-ads/readiness'){
  respond(res,200,{
   status:videoAdIntakeEnabled(env)?'accepting_inquiries':'not_ready',
   canSubmit:videoAdIntakeEnabled(env),
   paymentAvailable:false,
   autoVideoGeneration:false,
   policyVersion:'video-ads-pilot-v1'
  });
  return true;
 }

 if(req.method==='POST'&&pathname==='/api/video-ads/inquiries'){
  checkOrigin(req,env);
  if(!videoAdIntakeEnabled(env))
   stop(503,'상담 접수 운영 정보 및 개인정보 처리 승인이 완료되지 않았습니다.');
  let lead;
  try{lead=normalizeVideoAdInquiry(json(req,6000));}
  catch(error){stop(400,error.message);}
  const id='vad_'+randomBytes(16).toString('hex');
  const date=new Date(now()).toISOString().slice(0,10);
  const limiter=db.collection('withuVideoLeadLimits').doc(clientNetworkKey(req,env,date));
  const destination=db.collection('withuVideoInquiries').doc(id);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(limiter);
   const count=Number(snap.data()?.count)||0;
   if(count>=3)stop(429,'상담 접수 한도를 초과했습니다. 다음 날 다시 이용해 주세요.');
   tx.set(limiter,{count:count+1,day:date,updatedAt:now(),
    deleteAfter:new Date(now()+7*MS_DAY)});
   tx.create(destination,{
    ...lead,id,status:'received',createdAt:now(),updatedAt:now(),
    deleteAfter:new Date(now()+RETENTION_DAYS*MS_DAY),
    delivery:{status:'not_started'},payment:{status:'not_requested'},
    fulfillment:{status:'not_started'}
   });
  });
  respond(res,202,{status:'received',inquiryId:id,
   message:'광고 상담 신청이 접수됐습니다. 견적과 작업 가능 여부는 운영자 검토 후 안내됩니다.'});
  return true;
 }

 if(pathname==='/api/admin/video-ads/inquiries'&&req.method==='GET'){
  await admin(req,auth,env);
  const records=await db.collection('withuVideoInquiries')
   .orderBy('createdAt','desc').limit(50).get();
  respond(res,200,{inquiries:records.docs.map(x=>x.data())});
  return true;
 }

 const update=/^\/api\/admin\/video-ads\/inquiries\/(vad_[a-f0-9]{32})\/status$/.exec(pathname);
 if(update){
  await admin(req,auth,env);
  if(req.method!=='POST')stop(405,'POST 요청만 허용합니다.');
  checkOrigin(req,env);
  const body=json(req,800);
  if(!body||Object.keys(body).length!==1||!STATUS.has(body.status))
   stop(400,'상담 상태가 올바르지 않습니다.');
  const ref=db.collection('withuVideoInquiries').doc(update[1]);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists)stop(404,'상담 기록이 없습니다.');
   tx.update(ref,{status:body.status,updatedAt:now()});
  });
  respond(res,200,{status:body.status,inquiryId:update[1]});
  return true;
 }
 return false;
}
