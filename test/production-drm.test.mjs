import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {drmConfig,gatewayGrant,handleProductionDrm} from '../src/production-drm.mjs';
import {visibleTracks} from '../src/production-runtime.mjs';
import {handleProductionDelivery} from '../src/production-delivery.mjs';
const id='withu_'+'a'.repeat(32),other='withu_'+'b'.repeat(32);
const config={required:true,packagingVerified:true,assetId:'asset_A',systems:['widevine'],manifestUrl:'https://cdn.example/a.mpd'};
const makeOrder=()=>({id,paymentStatus:'paid',paymentKey:'payment-verified',paymentVerifiedAt:123,
 delivery:{status:'sent'},productId:'audio',upgrade:{paymentStatus:'paid',rightsVerified:true},
 tracks:[{index:1,title:'나의 노래',lyrics:'검증된 가사입니다. 함께 부르는 노래',reviewed:true,
 storagePath:'orders/'+id+'/tracks/original.mp3',drm:{...config}}]});
const env={WITHU_PUBLIC_BASE_URL:'https://song.example',WITHU_DRM_GATEWAY_VERIFIED:'true',
 WITHU_DRM_GATEWAY_URL:'https://gateway.example/license',WITHU_DRM_GATEWAY_SIGNING_KEY:'s'.repeat(40)};
function db(order){return {
 collection(name){return {doc(){return {get:async()=>({exists:true,data:()=>name==='withuSessions'?{orderId:id,expiresAt:Date.now()+60000}:order})}}}},
 async runTransaction(fn){return fn({get:async()=>({data:()=>({count:0})}),set(){}})}
};}
function req(action='config',orderId=id){return {method:action==='config'?'GET':'POST',url:'/api/delivery-drm/'+orderId+'_1/'+action,
 headers:{cookie:'withu_session='+'a'.repeat(43),origin:'https://song.example'},rawBody:Buffer.from('challenge'),get(name){return this.headers[name.toLowerCase()]}};}
function res(){return {headers:{},set(k,v){this.headers[k]=v;return this},setHeader(k,v){this.headers[k]=v},status(v){this.statusCode=v;return this},json(v){this.value=v},send(v){this.value=v}};}
test('DRM metadata fails closed and browser receives no storage path, key or gateway secret',()=>{
 const o=makeOrder(),view=visibleTracks(o)[0];
 assert.equal(view.protectedPlayback.required,true);
 assert.match(view.protectedPlayback.configUrl,/delivery-drm/);
 assert.equal(view.privateDownloadUrl,undefined);
 assert.match(visibleTracks(o,{downloadGranted:true})[0].privateDownloadUrl,/delivery-downloads/);
 for(const bad of [{...config,required:false},{...config,packagingVerified:false},{...config,systems:['clearkey']},
 {...config,manifestUrl:'http://cdn.example/a.mpd'},{...config,systems:['fairplay']}])assert.throws(()=>drmConfig({drm:bad}));
});
test('gateway grants cryptographically bind asset, system, order and 60 second expiry',()=>{
 const token=gatewayGrant(config,'widevine',id,env.WITHU_DRM_GATEWAY_SIGNING_KEY,100000);
 const [header,payload,sig]=token.split('.');const p=JSON.parse(Buffer.from(payload,'base64url'));
 assert.equal(p.assetId,'asset_A');assert.equal(p.sub,id);assert.equal(p.system,'widevine');assert.equal(p.exp-p.iat,60);
 assert.equal(sig,createHmac('sha256',env.WITHU_DRM_GATEWAY_SIGNING_KEY).update(header+'.'+payload).digest('base64url'));
});
test('config and binary license route authorize order and do not leak upstream credentials',async()=>{
 const database=db(makeOrder()),r=res();let calls=0;
 const fetcher=async(url,options)=>{
  calls++;assert.equal(url,env.WITHU_DRM_GATEWAY_URL);assert.equal(options.redirect,'error');
  assert.deepEqual(options.body,Buffer.from('challenge'));
  const claims=JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1],'base64url'));
  assert.equal(claims.assetId,'asset_A');
  return new Response(new Uint8Array([1,2,3]));
 };
 const ctx={db:database,env,fetcher};
 await handleProductionDrm(req(),r,ctx);assert.equal(calls,0);
 assert.equal(r.value.servers['com.widevine.alpha'],'/api/delivery-drm/'+id+'_1/widevine');
 assert.ok(!JSON.stringify(r.value).includes('gateway.example'));
 const license=res();await handleProductionDrm(req('widevine'),license,ctx);
 assert.equal(calls,1);assert.deepEqual(license.value,Buffer.from([1,2,3]));
 assert.equal(license.headers['Cache-Control'],'private, no-store');
 for(const request of [req('widevine',other),{...req('widevine'),headers:{...req().headers,origin:'https://evil.example'}},req('fairplay')])
  await assert.rejects(()=>handleProductionDrm(request,res(),ctx));
 assert.equal(calls,1);
});
test('refunded, expired, oversized and unconfigured DRM requests cannot issue licenses',async()=>{
 let calls=0;const ctx={db:db(makeOrder()),env,fetcher:async()=>{calls++;}};
 await assert.rejects(()=>handleProductionDrm(req(),res(),{...ctx,env:{}}),e=>e.status===503);
 const refunded=makeOrder();refunded.state='refunded';
 await assert.rejects(()=>handleProductionDrm(req('widevine'),res(),{...ctx,db:db(refunded)}),e=>e.status===403);
 await assert.rejects(()=>handleProductionDrm({...req('widevine'),rawBody:Buffer.alloc(2097153)},res(),ctx),e=>e.status===413);
 await assert.rejects(()=>handleProductionDrm({...req(),headers:{}},res(),ctx),e=>e.status===401);
 assert.equal(calls,0);
});
test('a DRM track cannot retrieve a clear playback file through the existing range route',async()=>{
 let touched=false;
 const request={method:'GET',url:'/api/delivery-assets/'+id+'_1',headers:req().headers};
 await assert.rejects(()=>handleProductionDelivery(request,res(),{db:db(makeOrder()),env,
  bucket:{file(){touched=true;throw Error('clear data leaked')}}}),e=>e.status===403);
 assert.equal(touched,false);
 const o=makeOrder();delete o.tracks[0].drm;
 assert.equal(visibleTracks(o)[0].protectedPlayback,undefined,'existing clear tracks remain playable');
});
