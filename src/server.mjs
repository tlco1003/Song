import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {AppError,validateLyricInput,buildSunoPackage} from './lib.mjs';
import {makeLyrics,createSunoSong,SUNO_MCP_URL} from './providers.mjs';
import {generateCoverImage} from './cover-image.mjs';
import {publicCommerceReadiness,publicPriceCatalog} from './commerce.mjs';
import {prepareServerOrderDraft} from './order-draft-preparation.mjs';
import {storePrivateOrderDraft} from './private-draft-store.mjs';
import {hashPrivateDeliveryToken} from './private-delivery-invitation.mjs';
import {upgradePriceKrw} from './commercial-rights-upgrade.mjs';
import {LOCAL_STAGING_HTML,LOCAL_STAGING_SCRIPT} from './local-staging-ui.mjs';
import {verifyResendDeliveryWebhook,recordResendDeliveryWebhook}
 from './resend-delivery-events.mjs';

// Single-operator local MVP. Public multi-user deployment requires an
// authenticated OAuth PKCE flow and per-user Suno credential vault.
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.HOST||'127.0.0.1';
const port=Number(process.env.PORT||3000);
const accessToken=process.env.APP_ACCESS_TOKEN||'';
const isLocal=['127.0.0.1','localhost','::1'].includes(host);
if(!isLocal&&!accessToken)throw new Error('APP_ACCESS_TOKEN is required for non-localhost deployments');
const requests=new Map();

const PRIVATE_SESSION_COOKIE='withu_delivery_session';
const PRIVATE_SESSION_ID=/^[A-Za-z0-9_-]{43}$/;
const PRIVATE_ASSET_ID=/^[A-Za-z0-9_-]{16,180}$/;
const PRIVATE_STREAM_URL=/^\/api\/delivery-assets\/[A-Za-z0-9_-]{16,180}$/;
const PRIVATE_DOWNLOAD_URL=/^\/api\/delivery-downloads\/[A-Za-z0-9_-]{16,180}$/;

function sameOriginPost(req){
 if(req.headers['sec-fetch-site']==='cross-site')
  throw new AppError(403,'다른 사이트에서는 고객 인증을 요청할 수 없습니다.');
 if(!req.headers.origin)return;
 let origin;
 try{origin=new URL(req.headers.origin);}
 catch(_){throw new AppError(403,'요청 출처가 유효하지 않습니다.');}
 if(!/^https?:$/.test(origin.protocol)||origin.host!==req.headers.host)
  throw new AppError(403,'같은 사이트의 요청만 허용합니다.');
}
function customerSession(req){
 const cookies=typeof req.headers.cookie==='string'?req.headers.cookie.split(';'):[];
 const item=cookies.map(s=>s.trim()).find(x=>x.startsWith(PRIVATE_SESSION_COOKIE+'='));
 const session=item?.slice(PRIVATE_SESSION_COOKIE.length+1)||'';
 if(!PRIVATE_SESSION_ID.test(session))throw new AppError(401,'인증된 고객 전용 링크가 필요합니다.');
 return session;
}
function sanitizeCustomerCommercialStatus(right){
 if(right?.status==='active'&&right.paymentVerified===true&&right.rightsVerified===true
  &&right.amountKrw===upgradePriceKrw())
  return {status:'active',paymentVerified:true,rightsVerified:true,amountKrw:10000};
 if(right?.status==='available'&&right.rightsVerified===true&&right.amountKrw===upgradePriceKrw())
  return {status:'available',rightsVerified:true,amountKrw:10000};
 return {status:'unavailable',amountKrw:10000};
}
function safePrivateTrack(track,commercialActive){
 if(!track||typeof track.title!=='string'||track.title.length>180
  ||typeof track.file!=='string'||!/^[A-Za-z0-9_.-]{1,110}$/.test(track.file)
  ||typeof track.privateMediaUrl!=='string'||!PRIVATE_STREAM_URL.test(track.privateMediaUrl)
  ||typeof track.genre!=='string'||track.genre.length>90)
  throw new AppError(503,'비공개 음원 메타데이터가 올바르지 않습니다.');
 const result={
  index:track.index,title:track.title,genre:track.genre,
  file:track.file,mediaKind:track.mediaKind||'audio',
  productType:track.productType||'audio_with_cover',
  privateMediaUrl:track.privateMediaUrl
 };
 if(typeof track.lyrics==='string'&&track.lyrics.length<=8000)result.lyrics=track.lyrics;
 if(track.privateAudioUrl&&PRIVATE_STREAM_URL.test(track.privateAudioUrl))
  result.privateAudioUrl=track.privateAudioUrl;
 if(commercialActive&&typeof track.privateDownloadUrl==='string'
  &&PRIVATE_DOWNLOAD_URL.test(track.privateDownloadUrl))
  result.privateDownloadUrl=track.privateDownloadUrl;
 if(typeof track.orderRef==='string'&&/^ord_[A-Za-z0-9_-]{16,64}$/.test(track.orderRef))
  result.orderRef=track.orderRef;
 return result;
}
async function streamProtectedCustomerMedia(req,res,adapter,kind,ticket){
 if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError(405,'고객 파일은 읽기 전용입니다.');
 if(!PRIVATE_ASSET_ID.test(ticket))throw new AppError(400,'올바르지 않은 파일 식별자입니다.');
 if(typeof adapter?.authorizePrivateAsset!=='function')
  throw new AppError(503,'비공개 음원 전달 저장소가 연결되지 않았습니다.');
 const sessionId=customerSession(req);
 // This trusted adapter MUST revalidate recipient, paid order, selected asset,
 // session TTL, and (for downloads) separate PG payment and licence proof
 // on EVERY request. A playback session alone cannot authorize download.
 const access=await adapter.authorizePrivateAsset({sessionId,ticket,kind,method:req.method});
 if(access?.authorized!==true||access?.paidOriginalOrderVerified!==true
  ||access?.recipientVerified!==true
  ||(kind==='download'&&(
    access.commercialEntitlementVerified!==true||access.commercialPaymentVerified!==true
    ||access.commercialRightsVerified!==true
  )))throw new AppError(403,'이 파일의 접근 권한이 없습니다.');
 if(typeof process.env.WITHU_PRIVATE_MUSIC_DIR!=='string'
  ||!process.env.WITHU_PRIVATE_MUSIC_DIR.trim()
  ||typeof access.filePath!=='string')
  throw new AppError(503,'비공개 파일 저장 경로가 설정되지 않았습니다.');
 const root=await realpath(path.resolve(process.env.WITHU_PRIVATE_MUSIC_DIR));
 const full=await realpath(path.resolve(access.filePath));
 if(root===appRoot||root.startsWith(appRoot+path.sep)||!full.startsWith(root+path.sep))
  throw new AppError(403,'웹 공개 경로의 음원은 고객 전용으로 제공할 수 없습니다.');
 const ext=path.extname(full).toLowerCase();
 const mime={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.mp4':'video/mp4'};
 if(!mime[ext]||(kind==='download'&&ext==='.mp4'))
  throw new AppError(403,'해당 형식은 접근할 수 없습니다.');
 const file=await stat(full);
 if(!file.isFile()||file.size<=0)throw new AppError(404,'파일을 찾을 수 없습니다.');
 const header={
  'Content-Type':mime[ext],
  'Cache-Control':'private, no-store',
  'Accept-Ranges':'bytes',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'"
 };
 if(kind==='download')header['Content-Disposition']='attachment; filename="withu-commercial-track'+ext+'"';
 const range=typeof req.headers.range==='string'?req.headers.range:'';
 let start=0,end=file.size-1,status=200;
 if(range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||(!match[1]&&!match[2])){
   res.writeHead(416,{'Content-Range':'bytes */'+file.size});return res.end();
  }
  if(match[1]){
   start=Number(match[1]);
   end=match[2]?Number(match[2]):file.size-1;
  }else{
   const suffix=Number(match[2]);start=Math.max(0,file.size-suffix);
  }
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)
    ||start<0||end<start||start>=file.size){
   res.writeHead(416,{'Content-Range':'bytes */'+file.size});return res.end();
  }
  end=Math.min(end,file.size-1);status=206;
  header['Content-Range']='bytes '+start+'-'+end+'/'+file.size;
 }
 header['Content-Length']=end-start+1;
 res.writeHead(status,header);
 if(req.method==='HEAD')return res.end();
 createReadStream(full,{start,end}).on('error',()=>res.destroy()).pipe(res);
}

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
async function binaryBody(req,limit=25*1024*1024){
 let size=0;const chunks=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>limit)throw new AppError(413,'Test audio file exceeds the maximum size');
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
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
async function handle(req,res,customerAccess,staging,notificationEvents){
  const localStagingAvailable=staging!==null&&staging!==undefined
    &&isLocal&&process.env.NODE_ENV!=='production'
    &&process.env.WITHU_STAGING_ENABLED==='true';
  if(localStagingAvailable){
   const remote=req.socket.remoteAddress||'';
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))
    throw new AppError(403,'Local test page is available only on loopback');
  }

  harden(res);
  const u=new URL(req.url,'http://'+host+':'+port);
  const pathname=u.pathname;
  // Local staging has NO live payment authority and no public production route.
  if(localStagingAvailable&&req.method==='GET'&&pathname==='/_staging'){
   res.writeHead(200,{
    'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':'private, no-store'
   });
   return res.end(LOCAL_STAGING_HTML);
  }
  if(localStagingAvailable&&req.method==='GET'&&pathname==='/_staging.js'){
   res.writeHead(200,{
    'Content-Type':'text/javascript; charset=utf-8',
    'Cache-Control':'private, no-store'
   });
   return res.end(LOCAL_STAGING_SCRIPT);
  }
  if(pathname.startsWith('/api/_staging/')){
   if(!localStagingAvailable)throw new AppError(404,'Staging API is disabled');
   if(req.method==='POST')sameOriginPost(req);
   limited(req,120);
   try{staging.verifyAdmin(req.headers['x-withu-test-key']);}
   catch(_){throw new AppError(403,'Local staging operator key required');}
   if(req.method==='GET'&&pathname==='/api/_staging/orders')
    return json(res,200,{orders:staging.listTestOrders({
     adminKey:req.headers['x-withu-test-key']
    })});
   if(req.method==='GET'&&pathname==='/api/_staging/outbox')
    return json(res,200,{messages:staging.listTestOutbox({
     adminKey:req.headers['x-withu-test-key']
    })});
   if(req.method==='POST'&&pathname==='/api/_staging/orders'){
    const data=await jsonBody(req,15000);
    return json(res,201,await staging.createTestOrder({
     draft:data?.draft,contact:data?.contact,
     adminKey:req.headers['x-withu-test-key']
    }));
   }
   if(req.method==='POST'&&pathname==='/api/_staging/audio'){
    const contentType=String(req.headers['content-type']||'');
    if(contentType!=='application/octet-stream')
     throw new AppError(415,'Audio upload requires an octet-stream body');
    const fileName=req.headers['x-withu-audio-name'];
    const buffer=await binaryBody(req,25*1024*1024);
    const result=await staging.uploadTestAudio({
     fileName,data:buffer,adminKey:req.headers['x-withu-test-key']
    });
    return json(res,201,result);
   }
   const license=/^\/api\/_staging\/orders\/(test_[a-f0-9-]{36})\/simulate-upgrade$/.exec(pathname);
   if(req.method==='POST'&&license){
    await jsonBody(req,256);
    return json(res,200,staging.simulateTestCommercialUpgrade({
     orderId:license[1],adminKey:req.headers['x-withu-test-key']
    }));
   }
   const pay=/^\/api\/_staging\/orders\/(test_[a-f0-9-]{36})\/simulate-payment$/.exec(pathname);
   if(req.method==='POST'&&pay){
    await jsonBody(req,256);
    return json(res,200,staging.simulatePayment({
     orderId:pay[1],adminKey:req.headers['x-withu-test-key']
    }));
   }
   const finish=/^\/api\/_staging\/orders\/(test_[a-f0-9-]{36})\/finish$/.exec(pathname);
   if(req.method==='POST'&&finish){
    const body=await jsonBody(req,20000);
    return json(res,200,await staging.finishManualTestOrder({
     orderId:finish[1],songs:body?.songs,
     adminKey:req.headers['x-withu-test-key'],
     localOrigin:'http://127.0.0.1:'+req.socket.localPort+'/'
    }));
   }
   throw new AppError(404,'Unsupported local staging action');
  }
  // Public health check: no user data, credentials, providers, or capability claims.
  if(req.method==='GET'&&pathname==='/healthz')return json(res,200,{status:'ok',service:'withu-api'});
  if(pathname.startsWith('/api/')){
    // Customer payment-related routes must fail closed until a durable,
    // licensed commercial fulfillment implementation passes verification.
    if(req.method==='POST'&&pathname==='/api/webhooks/resend'){
      if(typeof notificationEvents?.recordDeliveryStatusAtomic!=='function'
        ||!process.env.RESEND_WEBHOOK_SIGNING_SECRET)
        throw new AppError(503,'서명된 이메일 수신 상태 추적 기능이 준비되지 않았습니다.');
      const rawBody=await binaryBody(req,64000);
      let verified;
      try{
       verified=verifyResendDeliveryWebhook({
        rawBody,headers:req.headers,signingSecret:process.env.RESEND_WEBHOOK_SIGNING_SECRET
       });
      }catch(_){throw new AppError(403,'유효한 이메일 발송사 서명이 아닙니다.');}
      await recordResendDeliveryWebhook({
       verifiedEvent:verified,deliveryStore:notificationEvents
      });
      return json(res,200,{acknowledged:true});
    }
    if(req.method==='GET'&&pathname==='/api/commerce/readiness')
      return json(res,200,publicCommerceReadiness());
    if(req.method==='GET'&&pathname==='/api/commerce/catalog')
      return json(res,200,publicPriceCatalog());
    if(req.method==='POST'&&pathname==='/api/commerce/drafts'){
      // This does not authorize a charge or expose prompts to the browser.
      // Only private encrypted storage is supported; missing config fails closed.
      let originHost='';
      try{if(req.headers.origin)originHost=new URL(req.headers.origin).host;}
      catch(_){throw new AppError(403,'올바르지 않은 주문 요청 출처입니다.');}
      if((originHost&&originHost!==req.headers.host)
         ||req.headers['sec-fetch-site']==='cross-site')
        throw new AppError(403,'같은 사이트에서 제출한 주문만 받습니다.');
      limited(req,10);
      const prepared=prepareServerOrderDraft(await jsonBody(req,12000));
      const stored=await storePrivateOrderDraft(prepared,{
        rootDir:process.env.WITHU_ORDER_DRAFT_DIR,
        encryptionKey:process.env.WITHU_ORDER_DRAFT_ENCRYPTION_KEY
      });
      return json(res,201,{
        draftId:stored.id,expiresAt:stored.expiresAt,status:'pending_payment'
      });
    }

    if(req.method==='GET'&&pathname==='/api/delivery/library'){
      // The existing HttpOnly cookie may be used to reopen "나의 노래함"
      // without exposing a raw email token in the URL or local storage.
      if(typeof customerAccess?.getPrivateDeliveryLibrary!=='function')
        throw new AppError(503,'고객 노래함 저장소가 아직 연결되지 않았습니다.');
      const sessionId=customerSession(req);
      // Trusted adapter MUST revalidate session expiry, owner identity and
      // EVERY requested song's selected-candidate paid-order authorization.
      const result=await customerAccess.getPrivateDeliveryLibrary({sessionId});
      if(result?.sessionVerified!==true||result?.verifiedCustomerAccount!==true
        ||result?.verifiedOriginalPayment!==true||result?.verifiedRecipient!==true
        ||result?.everyPurchasedTrackAuthorized!==true
        ||result?.status!=='delivered'
        ||!Array.isArray(result.tracks)||result.tracks.length<1||result.tracks.length>60)
        throw new AppError(403,'나의 노래함에 접근할 수 있는 인증이 없습니다.');
      // Each song in this account needs its own verified order entitlement.
      const tracks=result.tracks.map(item=>{
        const right=sanitizeCustomerCommercialStatus(item?.commercialUpgrade);
        const safe=safePrivateTrack(item,right.status==='active');
        safe.commercialUpgrade=right;
        return safe;
      });
      return json(res,200,{
        status:'delivered',track:tracks[0],tracks,
        ...(localStagingAvailable&&result.testOnly===true?{testOnly:true}:{}),
        commercialUpgrade:{status:'unavailable',amountKrw:10000}
      });
    }
    if(req.method==='POST'&&pathname==='/api/delivery/resolve'){
      sameOriginPost(req);limited(req,20);
      if(typeof customerAccess?.resolvePrivateDelivery!=='function')
        throw new AppError(503,'인증된 고객 음원 전달 서버는 아직 연결되지 않았습니다.');
      const input=await jsonBody(req,1024);
      const hash=hashPrivateDeliveryToken(input?.token);
      const result=await customerAccess.resolvePrivateDelivery({tokenHash:hash});
      if(result?.verifiedOriginalPayment!==true||result?.verifiedRecipient!==true
        ||result?.status!=='delivered'||!PRIVATE_SESSION_ID.test(result.sessionId)
        ||!Array.isArray(result.tracks)||result.tracks.length<1||result.tracks.length>2)
        throw new AppError(403,'해당 전용 링크의 주문과 수령자를 확인할 수 없습니다.');
      const right=result.commercialUpgrade||{status:'unavailable'};
      const commercialActive=right.status==='active'&&right.paymentVerified===true
        &&right.rightsVerified===true&&right.amountKrw===upgradePriceKrw();
      const available=right.status==='available'&&right.rightsVerified===true
        &&right.amountKrw===upgradePriceKrw();
      const tracks=result.tracks.map(song=>safePrivateTrack(song,commercialActive));
      res.setHeader('Set-Cookie',PRIVATE_SESSION_COOKIE+'='+result.sessionId+
        '; HttpOnly; Path=/api; Max-Age=1800; SameSite=Strict'+
        (process.env.NODE_ENV==='production'?'; Secure':''));
      return json(res,200,{
        status:'delivered',track:tracks[0],tracks,
        ...(localStagingAvailable&&result.testOnly===true?{testOnly:true}:{}),
        commercialUpgrade:commercialActive?
          {status:'active',rightsVerified:true,paymentVerified:true,amountKrw:10000}:
          available?{status:'available',rightsVerified:true,amountKrw:10000}:
          {status:'unavailable',amountKrw:10000}
      });
    }
    if(req.method==='POST'&&pathname==='/api/commerce/commercial-upgrade/checkout'){
      sameOriginPost(req);limited(req,8);
      if(typeof customerAccess?.beginCommercialCheckout!=='function')
        throw new AppError(503,'상업적 이용권 결제는 아직 연결되지 않았습니다.');
      const sessionId=customerSession(req);
      const body=await jsonBody(req,1024);
      const tokenHash=body?.deliveryToken==null?null:hashPrivateDeliveryToken(body.deliveryToken);
      const orderRef=body?.orderRef;
      if(orderRef!==undefined&&(typeof orderRef!=='string'
        ||!/^ord_[A-Za-z0-9_-]{16,64}$/.test(orderRef)))
        throw new AppError(400,'올바르지 않은 고객 주문 선택입니다.');
      if(!tokenHash&&!orderRef)throw new AppError(400,'인증된 주문 선택이 필요합니다.');
      // The adapter verifies this session, its owner and optional delivery token,
      // recording provenance, licence authority, a separate pending PG intent and fixed price.
      const result=await customerAccess.beginCommercialCheckout({
        sessionId,tokenHash,orderRef:orderRef||null,amountKrw:upgradePriceKrw()
      });
      const target=typeof result?.checkoutUrl==='string'?
        new URL(result.checkoutUrl,'http://'+req.headers.host):null;
      if(result?.verifiedRights!==true||result?.originalPaymentVerified!==true
        ||result?.amountKrw!==10000||result?.status!=='checkout_ready'
        ||!target||target.host!==req.headers.host
        ||!target.pathname.startsWith('/commercial-upgrade/'))
        throw new AppError(503,'비공개 상업적 이용권 결제 검증에 실패했습니다.');
      return json(res,200,{status:'checkout_ready',amountKrw:10000,
        checkoutUrl:target.pathname+target.search});
    }
    if(pathname.startsWith('/api/delivery-assets/')||
       pathname.startsWith('/api/delivery-downloads/')){
      const kind=pathname.startsWith('/api/delivery-downloads/')?'download':'playback';
      const ticket=pathname.slice(kind==='download'?'/api/delivery-downloads/'.length:
        '/api/delivery-assets/'.length);
      return streamProtectedCustomerMedia(req,res,customerAccess,kind,ticket);
    }
    if(pathname==='/api/commerce/orders'||pathname.startsWith('/api/commerce/orders/'))
      throw new AppError(503,'자동 음악 제작·결제·이메일 발송 서비스는 준비 중이며 현재 주문을 받지 않습니다.');
    // Never return customer lyrics or accept edits without a durable,
    // payment-confirmed order and authenticated, CSRF-protected session.
    if(pathname.startsWith('/api/commerce/revisions/'))
      throw new AppError(503,'결제 완료 고객의 가사 수정 서비스가 아직 연결되지 않았습니다.');
    if(pathname.startsWith('/api/delivery/'))throw new AppError(503,'인증된 고객 파일 전달 기능은 아직 준비 중입니다.');
    if(pathname.startsWith('/api/customer/lyrics-revision'))throw new AppError(503,'결제 고객 가사 수정은 본인 인증과 주문 데이터 연결 후 제공됩니다.');
    auth(req);
    if(req.method==='POST'&&pathname==='/api/covers/generate'){
      // This is an owner-authenticated prototype route, not a public customer endpoint.
      if(!accessToken)throw new AppError(503,'이미지 생성 기능은 서버 인증 설정 후 사용할 수 있습니다.');
      if(!process.env.OPENAI_API_KEY)throw new AppError(503,'서버에 이미지 생성 API 키가 연결되지 않았습니다.');
      limited(req,3);
      const input=await jsonBody(req,5000);
      try{return json(res,200,await generateCoverImage(input));}
      catch(error){throw new AppError(502,error instanceof TypeError?error.message:'이미지 생성 서비스 응답을 확인해 주세요.');}
    }
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
    '/payment.html':'docs/payment.html',
    '/payment.js':'docs/payment.js',
    '/revise-lyrics.html':'docs/revise-lyrics.html',
    '/revise-lyrics.js':'docs/revise-lyrics.js',
    '/lyrics-revision.html':'docs/lyrics-revision.html',
    '/lyrics-revision.js':'docs/lyrics-revision.js',
    '/checkout.css':'docs/checkout.css',
    '/checkout.js':'docs/checkout.js',
    '/checkout-media.js':'docs/checkout-media.js',
    '/prices.json':'docs/prices.json',
    '/music-genres.json':'docs/music-genres.json',
    '/player.js':'docs/player.js',
    '/lyric-timing.mjs':'docs/lyric-timing.mjs',
    '/lyric-timer.html':'docs/lyric-timer.html',
    '/lyric-timer.js':'docs/lyric-timer.js',
    '/song.html':'docs/song.html',
    '/my-music.html':'docs/my-music.html',
    '/admin.html':'docs/admin.html',
    '/admin.js':'docs/admin.js',
    '/admin.css':'docs/admin.css',
    '/email-preview.html':'docs/email-preview.html',
    '/my-music-preview.html':'docs/my-music-preview.html',
    '/customer-preview.js':'docs/customer-preview.js',
    '/song.css':'docs/song.css',
    '/song.js':'docs/song.js',
    '/cover-store.js':'docs/cover-store.js',
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
  if(!relative && /^\/covers\/[a-z0-9-]+\.webp$/i.test(pathname))
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
    '.mjs':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.svg':'image/svg+xml',
    '.webp':'image/webp',
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
export function createApp({customerAccess=null,staging=null,notificationEvents=null}={}){
  if(staging&&(process.env.NODE_ENV==='production'||!isLocal
    ||process.env.WITHU_STAGING_ENABLED!=='true'))
   throw new Error('Staging cannot be attached to a production/public server');
  return http.createServer((req,res)=>{void handle(req,res,customerAccess,staging,notificationEvents).catch(error=>{
    if(!res.headersSent)json(res,error instanceof AppError?error.status:500,{
      error:error instanceof AppError?error.message:'서버 처리 오류가 발생했습니다.'
    });else res.destroy();
  });});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createApp().listen(port,host,()=>console.log('SONG GPT + official Suno MCP: http://'+host+':'+port));
}
