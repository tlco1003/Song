/**
 * WITHU purchased-song email authentication and authorization contracts.
 * All ports require durable stores. No production adapter is bundled.
 */
import {createHash,createHmac,randomBytes,randomInt} from 'node:crypto';
import {ORDER_STATES} from './commerce.mjs';

const cookieName='__Host-withu-session';
const paidStates=new Set([
 ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,ORDER_STATES.MUSIC_READY,
 ORDER_STATES.GENERATING_VIDEO,ORDER_STATES.READY_TO_DELIVER,
 ORDER_STATES.DELIVERING,ORDER_STATES.DELIVERED
]);
const safePrivateKey=value=>typeof value==='string'&&value.length<=400
 &&/^private\/[A-Za-z0-9/_-]+\.(mp3|m4a|wav|mp4|webp|png|jpg)$/.test(value)
 &&!value.includes('//')&&!value.includes('..');
const safeRoute=value=>typeof value==='string'
 &&/^\/api\/delivery-assets\/[A-Za-z0-9/_-]+$/.test(value)
 &&!value.includes('//')&&!value.includes('..');
const sha256=value=>createHash('sha256').update(value).digest('hex');
export function normalizeCustomerEmail(value){
 if(typeof value!=='string')throw TypeError('Invalid email');
 const result=value.trim().toLowerCase();
 if(result.length>254||!/^([a-z0-9.!#$%&'*+/=?^_{}|~-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.test(result)
  ||result.includes('..'))throw TypeError('Invalid email');
 return result;
}
function isOwnedPaid(order,email){
 return !!order&&normalizeCustomerEmail(order.customerEmail)===email
 &&paidStates.has(order.state)
 &&typeof order.paymentKey==='string'&&order.paymentKey.length>=6
 &&typeof order.paymentVerifiedAt==='string'&&!!Date.parse(order.paymentVerifiedAt)
 &&order.refundedAt==null;
}
function selectedSongs(order){
 if(order.state!==ORDER_STATES.DELIVERED||!order.deliveredAt
  ||!Array.isArray(order.selectedSongs))return [];
 const expected=order.productId==='audio_duo'?2:1;
 if(order.selectedSongs.length!==expected)throw Error('Incomplete selected delivery');
 const indexes=new Set();
 return order.selectedSongs.map(song=>{
  if(!Number.isSafeInteger(song?.index)||song.index<1||song.index>expected
    ||indexes.has(song.index)||!safePrivateKey(song.privateAssetKey))
    throw Error('Unsafe selected delivery');
  indexes.add(song.index);
  return {index:song.index,title:String(song.title||order.songTitle||'나의 노래').slice(0,120),
    genre:String(song.genre||'').slice(0,100)};
 });
}
/**
 * rateLimiter.hit must enforce durable email/IP throttling.
 * challenges.issueAtomic enforces cooldown and persists a hashed OTP.
 * challenges.consumeAtomic validates TTL, attempts<=5, hash, one-time use
 * in ONE transaction. sessions uses SHA256(token), never plaintext tokens.
 * Asset tickets MUST be stored privately. Asset route requests resolve the
 * opaque ticket, verify purchaser session + persisted order ownership +
 * exact selected asset, then call the private-storage streaming adapter.
 */
export function createCustomerPortal({
 secret,rateLimiter,challenges,sessions,orders,loginMailer,assets,
 clock=()=>Date.now(),generateCode=()=>String(randomInt(0,1000000)).padStart(6,'0'),
 generateSession=()=>randomBytes(32).toString('base64url')
}={}){
 if(typeof secret!=='string'||Buffer.byteLength(secret,'utf8')<32)
  throw Error('Strong server-only customer session secret required');
 const ports=[rateLimiter?.hit,challenges?.issueAtomic,challenges?.consumeAtomic,
  sessions?.create,sessions?.retrieve,sessions?.revoke,
  orders?.listByEmail,orders?.getById,loginMailer?.sendLoginCode,
  assets?.issueRoutes,assets?.resolveTicket,assets?.streamAuthorized];
 if(ports.some(port=>typeof port!=='function'))throw Error('Durable customer portal adapters required');
 const codeHash=(email,code)=>createHmac('sha256',secret).update(email+':'+code).digest('hex');
 const owned=async email=>{
  const all=await orders.listByEmail(email);
  if(!Array.isArray(all))throw Error('Invalid order store response');
  return all.filter(order=>isOwnedPaid(order,email));
 };
 async function session(cookie){
  const match=typeof cookie==='string'
   ?cookie.match(/(?:^|;\s*)__Host-withu-session=([A-Za-z0-9_-]{40,100})(?:;|$)/):null;
  if(!match)return null;
  const tokenHash=sha256(match[1]),record=await sessions.retrieve(tokenHash);
  if(!record||record.emailVerified!==true||record.expiresAt<=clock())return null;
  return {authenticated:true,emailVerified:true,email:normalizeCustomerEmail(record.email),tokenHash};
 }
 async function requireSession(cookie){
  const identity=await session(cookie);
  if(!identity)throw Object.assign(Error('Authentication required'),{status:401});
  return identity;
 }
 return Object.freeze({
  async requestCode({email,clientIp}){
   const address=normalizeCustomerEmail(email),now=clock();
   await rateLimiter.hit({emailHash:sha256(address),ipHash:sha256(String(clientIp||'unknown')),now});
   // Constant public response prevents discovery of customer emails.
   if(!(await owned(address)).length)return {accepted:true};
   const code=generateCode();
   if(!/^\d{6}$/.test(code))throw Error('Invalid OTP generator');
   await challenges.issueAtomic({email:address,codeHash:codeHash(address,code),
    expiresAt:now+600000,maxAttempts:5,now});
   await loginMailer.sendLoginCode({email:address,code,expiresMinutes:10});
   return {accepted:true};
  },
  async verifyCode({email,code}){
   const address=normalizeCustomerEmail(email);
   if(typeof code!=='string'||!/^\d{6}$/.test(code))
    throw Object.assign(Error('Invalid code'),{status:401});
   const accepted=await challenges.consumeAtomic({email:address,codeHash:codeHash(address,code),now:clock()});
   if(accepted!==true||!(await owned(address)).length)
    throw Object.assign(Error('Invalid or expired code'),{status:401});
   const token=generateSession();
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{40,100}$/.test(token))
    throw Error('Invalid session generator');
   await sessions.create({tokenHash:sha256(token),email:address,emailVerified:true,expiresAt:clock()+43200000});
   return {cookie:cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200',
    authenticated:true,emailVerified:true};
  },
  session,
  async logout(cookie){
   const identity=await session(cookie);
   if(identity)await sessions.revoke(identity.tokenHash);
   return cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  },
  async listCustomerOrders(cookie){
   const identity=await requireSession(cookie),all=await owned(identity.email);
   return {orders:all.map(order=>{
    const songs=selectedSongs(order);
    return {id:order.id,title:String(order.songTitle||'나의 노래').slice(0,120),
     status:order.state===ORDER_STATES.DELIVERED&&songs.length?'delivered':'processing',songs};
   })};
  },
  async servePrivateAsset({req,res,pathname,cookie}){
   const identity=await requireSession(cookie);
   if(!['GET','HEAD'].includes(req.method)||!safeRoute(pathname))
    throw Object.assign(Error('Not found'),{status:404});
   const ticket=await assets.resolveTicket({pathname,now:clock()});
   if(!ticket||ticket.email!==identity.email||ticket.expiresAt<=clock()
     ||typeof ticket.orderId!=='string'||!Number.isSafeInteger(ticket.index)
     ||!safePrivateKey(ticket.privateAssetKey)
     ||!['play','download','cover'].includes(ticket.disposition))
    throw Object.assign(Error('Not found'),{status:404});
   const order=await orders.getById(ticket.orderId);
   if(!isOwnedPaid(order,identity.email)||order.state!==ORDER_STATES.DELIVERED
     ||!order.deliveredAt)
    throw Object.assign(Error('Not found'),{status:404});
   const chosen=order.selectedSongs?.find(song=>song.index===ticket.index);
   if(!chosen||(ticket.disposition==='cover'
     ?chosen.privateCoverKey!==ticket.privateAssetKey
     :chosen.privateAssetKey!==ticket.privateAssetKey))
    throw Object.assign(Error('Not found'),{status:404});
   res.setHeader('Cache-Control','private, no-store');
   return assets.streamAuthorized({
    req,res,privateAssetKey:ticket.privateAssetKey,disposition:ticket.disposition
   });
  },
  async getCustomerTrack(cookie,orderId,index){
   const identity=await requireSession(cookie);
   if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)
     ||!Number.isSafeInteger(index)||index<1)
    throw Object.assign(Error('Not found'),{status:404});
   const order=await orders.getById(orderId);
   if(!isOwnedPaid(order,identity.email)||order.state!==ORDER_STATES.DELIVERED)
    throw Object.assign(Error('Not found'),{status:404});
   const publicSongs=selectedSongs(order),metadata=publicSongs.find(s=>s.index===index);
   const selected=order.selectedSongs?.find(s=>s.index===index);
   if(!metadata||!selected)throw Object.assign(Error('Not found'),{status:404});
   const routes=await assets.issueRoutes({email:identity.email,orderId,index,
    privateAssetKey:selected.privateAssetKey,ttlSeconds:300});
   if(!safeRoute(routes?.playUrl)||!safeRoute(routes?.downloadUrl)
     ||(routes.coverUrl!=null&&!safeRoute(routes.coverUrl)))
    throw Error('Asset signer returned unprotected route');
   const ext=selected.privateAssetKey.split('.').pop();
   return {status:'delivered',track:{
    id:orderId+'-'+index,file:'WITHU-'+orderId+'-'+index+'.'+ext,
    title:metadata.title,genre:metadata.genre,mediaKind:ext==='mp4'?'video':'audio',
    lyrics:String(order.confirmedLyrics||'').slice(0,24000),
    playUrl:routes.playUrl,downloadUrl:routes.downloadUrl,coverUrl:routes.coverUrl||null
   }};
  }
 });
}
