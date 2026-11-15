import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../docs/protected-media.js',import.meta.url),'utf8');
const url='/api/delivery-drm/withu_'+'a'.repeat(32)+'_1/';
function setup({clear=false,ok=true}={}){
 const record={destroyed:0,paused:0};
 class Player{
  static isBrowserSupported(){return true}
  async attach(el){record.element=el}
  addEventListener(_type,fn){record.onError=fn}
  configure(config){record.config=config}
  getNetworkingEngine(){return {registerRequestFilter(fn){record.filter=fn}}}
  async load(value){record.manifest=value}
  drmInfo(){return clear?null:{keySystem:'com.widevine.alpha'}}
  async destroy(){record.destroyed++}
 }
 const context={window:{isSecureContext:true},location:{origin:'https://song.example',href:'https://song.example/my-music.html'},
  URL,Uint8Array,atob,shaka:{polyfill:{installAll(){}},Player,net:{NetworkingEngine:{RequestType:{LICENSE:2}}}},
  fetch:async()=>({ok,json:async()=>({required:true,manifestUrl:'https://cdn.example/encrypted.mpd',servers:{'com.widevine.alpha':url+'widevine'}})})};
 context.window.shaka=context.shaka;vm.runInNewContext(source,context);
 return {record,api:context.window.WithuProtectedMedia,element:{pause(){record.paused++}}};
}
test('protected player configures same-origin license proxy and releases CDM on reset',async()=>{
 const {api,record,element}=setup();
 await api.attach(element,{configUrl:url+'config'},()=>{});
 assert.equal(record.manifest,'https://cdn.example/encrypted.mpd');
 assert.equal(record.config.drm.servers['com.widevine.alpha'],'https://song.example'+url+'widevine');
 const request={uris:[url+'widevine']};record.filter(2,request);
 assert.equal(request.allowCrossSiteCredentials,true);
 assert.throws(()=>record.filter(2,{uris:['https://evil.example/license']}));
 await api.reset();assert.equal(record.destroyed,1);
});
test('clear packaging and failed configuration never fall back to an MP3 source',async()=>{
 for(const options of [{clear:true},{ok:false}]){
  const {api,record,element}=setup(options);
  await assert.rejects(()=>api.attach(element,{configUrl:url+'config'},()=>{}));
  assert.equal(element.src,undefined);
  if(options.clear)assert.equal(record.destroyed,1);
 }
});
