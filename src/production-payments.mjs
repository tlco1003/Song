/** Server-owned PG amount, paid status and 10,000 KRW upgrade. */
import {randomUUID} from 'node:crypto';
import {prepareServerOrderDraft} from './order-draft-preparation.mjs';
import {validateCheckoutDeliveryContact} from './customer-notification-contact.mjs';
import {makeTossPaymentAdapter} from './toss-payment-adapter.mjs';
import {commercialMode,makeProductionId,requireProductionId,
 assertExactTossPayment} from './production-contract.mjs';
import {ensurePaidDownloadGrant,sendRecoveryEmail,hasDownloadGrant}
 from './production-download-grants.mjs';
import {UPGRADE_PRICE,now,json,checkOrigin,stop,respond,customerOrder,
 currentSession,hash} from './production-runtime.mjs';

function ready(env){
 const settings=commercialMode(env);
 if(!settings)stop(503,'사업자 결제·운영 도메인·발신자 설정이 완료되지 않았습니다.');
 return settings;
}
async function confirmPayment(req,db,env,fetcher,upgrade=false){
 const input=json(req,1800);
 const id=requireProductionId(input.orderId,{upgrade});
 const key=input.paymentKey;
 if(typeof key!=='string'||key.length<6||key.length>200
  ||!Number.isSafeInteger(input.amount))
  stop(400,'결제승인 요청이 올바르지 않습니다.');
 const doc=db.collection(upgrade?'withuUpgradeIntents':'withuOrders').doc(id);
 let original;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(doc);
  if(!snap.exists)stop(404,'결제 대기 주문을 찾을 수 없습니다.');
  const current=snap.data();
  const total=upgrade?UPGRADE_PRICE:current.amountKrw;
  if(input.amount!==total)stop(409,'주문서와 결제 금액이 일치하지 않습니다.');
  if(current.paymentStatus==='paid'){
   if(current.paymentKey!==key)stop(409,'다른 결제키로 승인된 주문입니다.');
   original=current;return;
  }
  if(current.paymentStatus!=='pending')stop(409,'결제 대기 주문이 아닙니다.');
  if(current.confirmLockUntil>now())stop(409,'이미 승인 처리 중인 주문입니다.');
  tx.update(doc,{confirmLockUntil:now()+120000});
  original=current;
 });
 if(upgrade){
  const session=await currentSession(req,db);
  if(session.orderId!==original.originalOrderId)
   stop(403,'해당 노래의 추가 결제만 승인할 수 있습니다.');
 }
 if(original.paymentStatus==='paid')
  return {status:'paid_verified',orderId:id,upgrade,already:true};
 if(upgrade){
  const session=await currentSession(req,db);
  if(session.orderId!==original.originalOrderId)
   stop(403,'구매자 주문의 추가 결제만 허용합니다.');
 }
 const provider=makeTossPaymentAdapter({
  secretKey:env.TOSS_SECRET_KEY,fetchImpl:fetcher
 });
 let receipt;
 try{
  receipt=await provider.confirm({
   paymentKey:key,orderId:id,amountKrw:upgrade?UPGRADE_PRICE:original.amountKrw,
   idempotencyKey:original.confirmationKey
  });
 }catch(err){
  // A timeout may occur after a real charge. Recover by querying the
  // exact paymentKey, never by fabricating a paid browser status.
  try{receipt=await provider.retrieve({paymentKey:key});}
  catch(_){throw err;}
 }
 try{
  assertExactTossPayment({orderId:id,paymentKey:key,
   amountKrw:upgrade?UPGRADE_PRICE:original.amountKrw,
   kind:upgrade?'upgrade':'order'},receipt);
 }catch(err){
  await doc.update({paymentReviewRequired:true,confirmLockUntil:0});
  throw err;
 }
 await db.runTransaction(async tx=>{
  const snap=await tx.get(doc);
  if(!snap.exists)stop(404,'결제 기록이 사라졌습니다.');
  const latest=snap.data();
  if(latest.paymentStatus==='paid'){
   if(latest.paymentKey!==key)stop(409,'다른 결제로 이미 승인됨');
   return;
  }
  if(upgrade){
   const root=db.collection('withuOrders').doc(latest.originalOrderId);
   const orig=await tx.get(root);
   if(!orig.exists||orig.data().paymentStatus!=='paid'
    ||orig.data().delivery?.status!=='sent'
    ||orig.data().upgrade?.rightsVerified!==true)
    stop(409,'상업적 이용 권리 또는 원래 주문이 확인되지 않았습니다.');
   tx.update(doc,{paymentStatus:'paid',paymentKey:key,
    paymentVerifiedAt:now(),confirmLockUntil:0});
   tx.update(root,{'upgrade.paymentStatus':'paid',
    'upgrade.paymentKey':key,'upgrade.paymentVerifiedAt':now()});
  }else{
   tx.update(doc,{paymentStatus:'paid',state:'paid',
    paymentKey:key,paymentVerifiedAt:now(),confirmLockUntil:0,
    production:{status:'pending',attempts:0,updatedAt:now()}});
  }
 });
 return {status:'paid_verified',orderId:id,upgrade};
}
export async function handleProductionPayments(req,res,{db,env,fetcher}){
 const url=new URL(req.originalUrl||req.url,'https://invalid.example');
 const path=url.pathname;
 if(req.method==='GET'&&path==='/api/runtime'){
  const settings=commercialMode(env);
  respond(res,200,{canCharge:!!settings,mode:settings?.mode||null,
   tossClientKey:settings?.clientKey||null,
   publicBaseUrl:env.WITHU_PUBLIC_BASE_URL||null,
   firebaseWebConfig:env.WITHU_FIREBASE_WEB_API_KEY?{
    apiKey:env.WITHU_FIREBASE_WEB_API_KEY,
    authDomain:env.WITHU_FIREBASE_AUTH_DOMAIN,
    projectId:env.WITHU_FIREBASE_PROJECT_ID
   }:null,
   deliveryChannels:['email'],upgradeKrw:UPGRADE_PRICE});
  return true;
 }
 if(req.method==='POST'&&path==='/api/orders'){
  checkOrigin(req,env);const settings=ready(env);
  const input=json(req,15000);
  if(input.termsAccepted!==true||input.privacyAccepted!==true)
   stop(400,'이용약관과 개인정보 처리 동의를 완료해 주세요.');
  const draft=prepareServerOrderDraft(input.draft);
  const contact=validateCheckoutDeliveryContact(input.contact);
  // Until a contracted Bizgo account and approved Alimtalk template are
  // deployed, no customer may choose an SMS/Kakao channel and receive
  // only email without explicit consent.
  if(contact.deliveryChannel!=='email')
   stop(422,'현재 이메일 발송만 지원합니다. 이메일을 선택해 주세요.');
  const quote=draft.amountBreakdown;
  if(quote.quoteRequired||input.clientAmount!==quote.amountKrw)
   stop(409,'서버 기준 주문 가격을 다시 확인해 주세요.');
  // Bounded per-network public order creation; all prices remain server-owned.
  const ipHash=hash(String(req.ip||req.socket?.remoteAddress||'unknown'));
  const limiter=db.collection('withuOrderLimits').doc(ipHash+'_'+Math.floor(now()/3600000));
  await db.runTransaction(async tx=>{
   const snap=await tx.get(limiter);
   if((snap.data()?.count||0)>=12)stop(429,'주문 요청이 많습니다. 잠시 후 재시도하세요.');
   tx.set(limiter,{count:(snap.data()?.count||0)+1,expiresAt:now()+7200000});
  });
  const id=makeProductionId();
  await db.collection('withuOrders').doc(id).create({
   id,createdAt:now(),productId:draft.productId,
   genreSelection:draft.genreSelection,
   trackPreferences:draft.trackPreferences,
   draft,contact,thirdVerse:draft.thirdVerse===true,
   dedicationOutro:draft.dedicationOutro===true,
   dedicationText:draft.dedicationText||'',
   amountKrw:quote.amountKrw,currency:'KRW',
   state:'payment_pending',paymentStatus:'pending',
   confirmationKey:randomUUID(),
   paymentVerifiedAt:null,confirmLockUntil:0,
   production:{status:'not_started',attempts:0},
   tracks:[],delivery:{status:'not_sent'},
   upgrade:{paymentStatus:'none',rightsVerified:false}
  });
  respond(res,201,{orderId:id,amountKrw:quote.amountKrw,currency:'KRW',
   orderName:draft.productId==='audio_duo'?'WITHU 맞춤 노래 2곡':'WITHU 맞춤 노래 1곡',
   customerKey:'ANONYMOUS',clientKey:settings.clientKey});
  return true;
 }
 if(req.method==='POST'&&path==='/api/payments/confirm'){
  checkOrigin(req,env);ready(env);
  respond(res,200,await confirmPayment(req,db,env,fetcher));return true;
 }
 if(req.method==='POST'&&path==='/api/upgrades/confirm'){
  checkOrigin(req,env);ready(env);
  const result=await confirmPayment(req,db,env,fetcher,true);
  const grant=await ensurePaidDownloadGrant({
   db,env,res,intentId:result.orderId
  });
  const delivery=await sendRecoveryEmail({
   db,env,fetcher,intentId:result.orderId,grant
  });
  respond(res,200,{...result,downloadGrant:'owner_only',
   downloadRecoveryEmailStatus:delivery.status});return true;
 }
 if(req.method==='POST'&&path==='/api/commerce/commercial-upgrade/checkout'){
  checkOrigin(req,env);ready(env);
  const input=json(req,1024);
  const email=typeof input.customerEmail==='string'?input.customerEmail.trim():'';
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
   stop(400,'원본 음원 복구 링크를 받을 이메일을 입력해 주세요.');
  const order=await customerOrder(req,db);
  if(order.upgrade?.rightsVerified!==true)
   stop(403,'원본 음원 상업적 이용권 제공이 승인되지 않았습니다.');
  if(await hasDownloadGrant(req,db,order.id))
   stop(409,'이미 이 기기에 원본 음원 이용권이 있습니다.');
  const id=makeProductionId('upg');
  await db.collection('withuUpgradeIntents').doc(id).create({
   id,originalOrderId:order.id,customerEmail:email,amountKrw:UPGRADE_PRICE,
   currency:'KRW',paymentStatus:'pending',createdAt:now(),confirmLockUntil:0,
   confirmationKey:randomUUID()
  });
  respond(res,200,{status:'checkout_ready',amountKrw:UPGRADE_PRICE,
   checkoutUrl:'/commercial-upgrade/start?intent='+id});
  return true;
 }
 const intent=/^\/api\/upgrade-intents\/(upg_[a-f0-9]{32})$/.exec(path);
 if(req.method==='GET'&&intent){
  ready(env);
  const session=await currentSession(req,db);
  const snap=await db.collection('withuUpgradeIntents').doc(intent[1]).get();
  if(!snap.exists||snap.data().originalOrderId!==session.orderId
   ||snap.data().paymentStatus!=='pending')
   stop(403,'이 추가 결제에 접근할 수 없습니다.');
  respond(res,200,{orderId:intent[1],amountKrw:UPGRADE_PRICE,
   orderName:'WITHU 원본 음원 및 상업적 이용',
   customerEmail:snap.data().customerEmail,
   clientKey:commercialMode(env).clientKey});
  return true;
 }
 return false;
}
