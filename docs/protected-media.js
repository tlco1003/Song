/* Encrypted playback only. No clear MP3 fallback or recording-detection claims. */
(()=>{
'use strict';
let active=null;
function localUrl(value){
 const url=new URL(value,location.href);
 if(url.origin!==location.origin||!/^\/api\/delivery-drm\/withu_[a-f0-9]{32}_[12]\/(config|widevine|fairplay|playready)$/.test(url.pathname)||url.search||url.hash)
  throw Error('보호 음원 인증 경로가 올바르지 않습니다.');
 return url.href;
}
window.WithuProtectedMedia={
 async reset(){if(active){const old=active;active=null;await old.destroy();}},
 async attach(element,descriptor,onError){
  if(!window.isSecureContext||!window.shaka)throw Error('보호 음원 재생에는 지원되는 HTTPS 브라우저가 필요합니다.');
  shaka.polyfill.installAll();
  if(!shaka.Player.isBrowserSupported())throw Error('이 브라우저는 보호 음원을 지원하지 않습니다.');
  const response=await fetch(localUrl(descriptor.configUrl),{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('보호 음원 연결이 준비되지 않았습니다.');
  const config=await response.json();
  if(config.required!==true||new URL(config.manifestUrl).protocol!=='https:')throw Error('보호 음원 정보 오류');
  const allowed=['com.widevine.alpha','com.apple.fps','com.microsoft.playready'];
  if(!config.servers||!Object.keys(config.servers).length||Object.keys(config.servers).some(k=>!allowed.includes(k)))throw Error('보호 음원 시스템 오류');
  const servers=Object.fromEntries(Object.entries(config.servers).map(([key,value])=>[key,localUrl(value)]));
  const p=new shaka.Player();active=p;
  try{
   await p.attach(element);
   p.addEventListener('error',()=>{element.pause();onError('보호 음원 재생에 실패했습니다. 지원 브라우저와 감상 권한을 확인해 주세요.');});
   const advanced={};
   if(servers['com.apple.fps'])advanced['com.apple.fps']={serverCertificate:Uint8Array.from(atob(config.fairplayCertificateBase64),c=>c.charCodeAt(0))};
   p.configure({drm:{servers,advanced},streaming:{useNativeHlsForFairPlay:true}});
   p.getNetworkingEngine().registerRequestFilter((type,request)=>{
    if(type===shaka.net.NetworkingEngine.RequestType.LICENSE){
     request.uris=request.uris.map(localUrl);
     request.allowCrossSiteCredentials=true;
    }
   });
   await p.load(config.manifestUrl);
   // A mistakenly clear packaged asset must not be accepted as protected.
   if(!p.drmInfo())throw Error('암호화되지 않은 음원은 보호 모드로 재생할 수 없습니다.');
  }catch(error){await p.destroy();if(active===p)active=null;throw error;}
 }
};
})();
