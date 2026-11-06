/**
 * LOCAL ONLY. Not a payment gateway, not a real customer database.
 * Use for QA of "simulated paid -> operator manual upload -> one-time email
 * preview link -> customer-isolated player" without charging real money.
 *
 * This instance stores ONLY ephemeral test records in memory; sessions and
 * delivery links vanish on restart. Never enable in production or bind to
 * a public interface. Do not process real customer PII in this lab.
 */
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {realpath,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareServerOrderDraft} from './order-draft-preparation.mjs';
import {AppError} from './lib.mjs';
import {validateCheckoutDeliveryContact} from './customer-notification-contact.mjs';
import {issuePrivateDeliveryInvitation,hashPrivateDeliveryToken}
 from './private-delivery-invitation.mjs';
import {ORDER_STATES} from './commerce.mjs';

const REPO=resolve(fileURLToPath(new URL('..',import.meta.url)));
const STAGING_MAX_AGE_MS=15*60*1000;
const SESSION_MAX_AGE_MS=30*60*1000;
const ID=/^test_[a-f0-9-]{36}$/;
const FILE=/^[A-Za-z0-9_.-]{1,110}\.(?:mp3|m4a|wav)$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const OTP_SESSION=()=>randomBytes(32).toString('base64url');

export function createLocalStagingGateway({
 privateMusicDir,adminKey,now=()=>Date.now(),emailTestSender=null
}={}){
 if(process.env.NODE_ENV==='production'
  ||process.env.HOST&& !['127.0.0.1','localhost','::1'].includes(process.env.HOST)
  ||process.env.WITHU_STAGING_ENABLED!=='true')
  throw new Error('Local staging requires explicit nonproduction loopback-only opt in');
 if(typeof adminKey!=='string'||adminKey.length<32||/^(.)\1+$/.test(adminKey))
  throw new Error('A strong unique local admin staging key of 32+ characters is required');
 if(typeof privateMusicDir!=='string'||!privateMusicDir.trim())
  throw new Error('Local staging requires a private audio volume outside GitHub repo');
 const dir=resolve(privateMusicDir);
 if(dir===REPO||dir.startsWith(REPO+sep))
  throw new Error('Local staging private music must not live in the repo');
 const orders=new Map(),hashes=new Map(),sessions=new Map(),tickets=new Map();
 const outbox=[];
 const constantTime=(supplied)=>{
  if(typeof supplied!=='string')return false;
  const a=Buffer.from(supplied),b=Buffer.from(adminKey);
  return a.length===b.length&&timingSafeEqual(a,b);
 };
 const requireAdmin=(supplied)=>{
  if(!constantTime(supplied))throw new Error('Staging operator authentication required');
 };
 const lookup=(orderId)=>{
  if(!ID.test(orderId))throw new Error('Unknown staging order');
  const order=orders.get(orderId);
  if(!order)throw new Error('Unknown staging order');
  return order;
 };
 const checkSession=(sessionId)=>{
  if(!TOKEN.test(sessionId))throw new AppError(401,'Customer session is missing');
  const s=sessions.get(sessionId);
  if(!s||s.expiresAt<=now())throw new AppError(401,'Customer session expired');
  const order=lookup(s.orderId);
  if(order.status!=='delivered')throw new AppError(403,'Order not delivered');
  return {session:s,order};
 };
 async function validatePrivateAsset(fileName){
  if(typeof fileName!=='string'||!FILE.test(fileName)||fileName.includes('..'))
   throw new Error('Only a named private audio file is allowed');
  const root=await realpath(dir),file=await realpath(resolve(dir,fileName));
  if(file===root||!file.startsWith(root+sep))
   throw new Error('Private file path escaped the configured music volume');
  const info=await stat(file);
  if(!info.isFile()||info.size<10)throw new Error('Private audio file is not ready');
  return file;
 }
 function trackResponse(song,orderId){
  const ticket=OTP_SESSION().slice(0,32);
  tickets.set(ticket,{orderId,assetIndex:song.index,expiresAt:now()+SESSION_MAX_AGE_MS});
  return {
   index:song.index,title:song.title,file:song.fileName,genre:song.genre,
   productType:'audio_with_cover',mediaKind:'audio',
   privateMediaUrl:'/api/delivery-assets/'+ticket,
   lyrics:song.lyrics,
   orderRef:'ord_'+orderId.slice(5).replace(/-/g,'').slice(0,32),
   commercialUpgrade:{status:'unavailable',amountKrw:10000}
  };
 }
 function privateResponse(order,sessionId){
  const tracks=order.songs.map(song=>trackResponse(song,order.id));
  return {
   status:'delivered',tracks,sessionId,
   verifiedOriginalPayment:true,verifiedRecipient:true,
   verifiedCustomerAccount:true,sessionVerified:true,
   everyPurchasedTrackAuthorized:true,
   commercialUpgrade:{status:'unavailable',amountKrw:10000}
  };
 }
 return Object.freeze({
  verifyAdmin:requireAdmin,
  async uploadTestAudio({adminKey:admin,fileName,data}={}){
   requireAdmin(admin);
   if(typeof fileName!=='string'||!FILE.test(fileName)
     ||!Buffer.isBuffer(data)||data.length<44||data.length>25*1024*1024)
    throw new Error('Only an uploaded MP3, M4A or WAV under 25 MB is accepted');
   const ext=extname(fileName).toLowerCase();
   const signature=ext==='.wav'?
    data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WAVE':
    ext==='.m4a'?data.toString('ascii',4,8)==='ftyp':
    data.toString('ascii',0,3)==='ID3'||(
      data[0]===255&&(data[1]&224)===224
    );
   if(!signature)throw new Error('Uploaded audio does not match its file extension');
   await mkdir(dir,{recursive:true,mode:0o700});
   const storedFile='staging_'+randomUUID()+ext;
   await writeFile(resolve(dir,storedFile),data,{flag:'wx',mode:0o600});
   return {fileName:storedFile,status:'STAGING_AUDIO_STORED_PRIVATELY',
     originalFileExcludedFromPublicRepo:true};
  },
  async createTestOrder({draft,contact,adminKey:admin}={}){
   requireAdmin(admin);
   const prepared=prepareServerOrderDraft(draft);
   const validatedContact=validateCheckoutDeliveryContact(contact);
   const id='test_'+randomUUID();
   const record={
    id,productId:prepared.productId,amountKrw:prepared.amountBreakdown.amountKrw,
    draft:prepared,contact:validatedContact,status:'payment_pending',
    paymentIsTest:true,createdAt:now(),songs:[]
   };
   orders.set(id,record);
   return {orderId:id,status:'TEST_ONLY_UNPAID',amountKrw:record.amountKrw,currency:'KRW'};
  },
  simulatePayment({orderId,adminKey:admin}={}){
   requireAdmin(admin);
   const o=lookup(orderId);
   if(o.status!=='payment_pending')throw new Error('Test payment was already handled');
   o.status='paid_test_only';
   o.testPaymentAt=new Date(now()).toISOString();
   outbox.push({type:'OPERATOR_ORDER_TEST',orderId:o.id,
    status:'manual_music_required',testOnly:true,amountKrw:o.amountKrw});
   return {orderId:o.id,status:'TEST_PAYMENT_COMPLETE_NO_CHARGE',
    fulfillmentRoute:'manual_operator',testOnly:true};
  },
  async finishManualTestOrder({orderId,adminKey:admin,songs,localOrigin}={}){
   requireAdmin(admin);
   const o=lookup(orderId);
   if(o.status!=='paid_test_only')throw new Error('Manual completion requires a simulated test payment');
   const needed=o.productId==='audio_duo'?2:1;
   if(!Array.isArray(songs)||songs.length!==needed)
    throw new Error('Exactly one final approved track per purchased song is required');
   const seen=new Set(),checked=[];
   for(let i=0;i<songs.length;i++){
    const song=songs[i];
    if(!song||typeof song.title!=='string'||!song.title.trim()||song.title.length>100
     ||typeof song.genre!=='string'||song.genre.length>90
     ||song.genre!==o.draft.songStyles[i]?.genre
     ||typeof song.lyrics!=='string'||song.lyrics.length<12||song.lyrics.length>8000
     ||!/[\p{L}\p{N}]/u.test(song.lyrics))
     throw new Error('Complete and reviewed lyrics and title are required');
    if(seen.has(song.fileName))throw new Error('No duplicate audio file across purchased song slots');
    seen.add(song.fileName);
    const absolute=await validatePrivateAsset(song.fileName);
    checked.push({index:i+1,title:song.title.trim(),
     genre:song.genre,fileName:song.fileName,lyrics:song.lyrics,filePath:absolute});
   }
   if(typeof localOrigin!=='string'||!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(localOrigin))
    throw new Error('Only loopback site links are allowed in staging');
   // The invitation issuer still validates original purchase and contact
   // requirements. Simulated verification is NEVER accepted by production.
   const grant={
    id:o.id,productId:o.productId,state:ORDER_STATES.READY_TO_DELIVER,
    paymentVerifiedAt:o.testPaymentAt,paymentKey:'TEST_ONLY_NO_PG_CHARGE',
    recipientVerified:true,customerEmail:o.contact.customerEmail,
    customerPhone:o.contact.customerPhone,
    deliveryChannel:o.contact.deliveryChannel,
    phoneVerified:true,deliveryConsent:true
   };
   const invitation=issuePrivateDeliveryInvitation({
    order:grant,selectedSongs:checked,origin:'https://localhost/'
   });
   const url=new URL(invitation.deliveryUrl);
   url.protocol='http:';url.host=new URL(localOrigin).host;
   o.songs=checked;o.status='delivered';o.inviteHash=invitation.tokenHash;
   hashes.set(invitation.tokenHash,{orderId:o.id,expiresAt:now()+STAGING_MAX_AGE_MS,
    used:false});
   const event={type:'TEST_LINK_PREVIEW_NOT_SENT',channel:o.contact.deliveryChannel,
    orderId:o.id,recipient:o.contact.deliveryChannel==='email'?
      o.contact.customerEmail:o.contact.customerPhone,
    listeningUrl:url.href,createdAt:now(),testOnly:true};
   outbox.push(event);
   // A real email may only be sent using an explicitly configured,
   // allowlisted test recipient; never send to arbitrary submitted addresses.
   if(typeof emailTestSender==='function'
     &&o.contact.deliveryChannel==='email'){
    const receipt=await emailTestSender({
     email:o.contact.customerEmail,subject:'[WITHU TEST] 나의 노래함 링크',
     listeningUrl:url.href,orderId:o.id
    });
    if(receipt?.accepted===true&&typeof receipt.messageId==='string'){
     event.type='TEST_EMAIL_ACCEPTED_NOT_DELIVERED';
     event.messageId=receipt.messageId;
    }
   }
   return {
    orderId:o.id,status:'TEST_DELIVERY_READY',
    notificationStatus:event.type,
    songCount:checked.length,publiclyPaid:false
   };
  },
  listTestOutbox({adminKey:admin}={}){
   requireAdmin(admin);
   return outbox.map(x=>({...x}));
  },
  resolvePrivateDelivery({tokenHash}={}){
   const record=hashes.get(tokenHash);
   if(!record||record.used||record.expiresAt<=now())
    throw new AppError(403,'Delivery access link is invalid, expired or already used');
   const o=lookup(record.orderId);
   if(o.status!=='delivered')throw new AppError(403,'Order delivery not ready');
   // One-time bearer URL. Leakage before first redemption remains a threat;
   // production MUST also bind recipient identity to a verified login/OTP.
   record.used=true;
   const sessionId=OTP_SESSION();
   sessions.set(sessionId,{orderId:o.id,expiresAt:now()+SESSION_MAX_AGE_MS});
   return privateResponse(o,sessionId);
  },
  getPrivateDeliveryLibrary({sessionId}={}){
   const {order}=checkSession(sessionId);
   return privateResponse(order,sessionId);
  },
  authorizePrivateAsset({sessionId,ticket,kind}={}){
   const {order}=checkSession(sessionId);
   const asset=tickets.get(ticket);
   if(kind!=='playback'||!asset||asset.expiresAt<=now()
     ||asset.orderId!==order.id)
    throw new AppError(403,'Only the paying staging customer can play this private asset');
   const file=order.songs.find(x=>x.index===asset.assetIndex);
   if(!file)throw new AppError(404,'Private song not found');
   return {
    authorized:true,paidOriginalOrderVerified:true,recipientVerified:true,
    filePath:file.filePath,
    commercialEntitlementVerified:false,commercialPaymentVerified:false,
    commercialRightsVerified:false
   };
  }
 });
}
