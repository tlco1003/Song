import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicPriceCatalog,publicCommerceReadiness} from '../src/commerce.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const page=read('docs/checkout.html');
const script=read('docs/checkout-media.js');
const styles=read('docs/checkout.css');
const payment=read('docs/payment.html');
const server=read('src/server.mjs');

test('three unchanged prices and a non-chargeable payment page',()=>{
 assert.deepEqual(publicPriceCatalog().products.map(x=>[x.id,x.amountKrw]),[
  ['audio',29000],['audio_duo',39000],['audio_video',300000]
 ]);
 assert.equal(publicPriceCatalog().products[2].quoteRequired,true);
 assert.equal(publicCommerceReadiness().canCharge,false);
 assert.match(payment,/id="confirm-checkout"[^>]*disabled/);
 assert.match(page,/href="payment.html"/);
});

test('all pre-purchase listening widgets and their audio script were removed',()=>{
 for(const id of ['prepay-demo','audio-example','audio-file-choice','audio-preview-play',
  'audio-preview-reset','audio-preview-time','audio-preview-fill',
  'audio-preview-element','audio-preview-message','checkout-cover-image']){
  assert.ok(!page.includes('id="'+id+'"'),id);
 }
 assert.doesNotMatch(script,/loadExamples|setAudio\(|audio\.play\(|audio\.currentTime|audio-preview|audio-example/);
 assert.ok(!page.includes('LISTEN FIRST'));
 assert.ok(!page.includes('30초 먼저 들어보세요'));
});

test('video package retains device-only photo, video, and native camera controls',()=>{
 const ids=['video-media-section','media-consent','face-photo','face-video','native-camera-capture',
  'photo-preview','video-preview','stage-portrait-image','camera-live','open-camera',
  'start-camera-record','stop-camera-record','close-camera','record-timer','camera-feedback','clear-media-preview'];
 for(const id of ids)assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(page,/data-checkout-step="video"[^>]*hidden/);
 assert.match(page,/capture="user"/);
 assert.match(page,/playsinline/);
 assert.match(script,/selectedProduct\(\)==='audio_video'/);
 assert.match(script,/navigator\.mediaDevices\.getUserMedia/);
 assert.match(script,/new MediaRecorder/);
 assert.match(script,/MediaRecorder\.isTypeSupported/);
 assert.match(script,/state\.recordStart=Date\.now\(\)/);
 assert.match(script,/if\(seconds>=LIMIT/);
 assert.match(script,/getTracks\(\)/);
 assert.match(script,/requireConsent\(\)/);
 assert.match(styles,/\.media-preview-grid/);
 assert.match(styles,/\.stage-concept/);
});

test('video capture is a dedicated optional stage, not part of the payment form',()=>{
 assert.ok(page.includes('data-checkout-step="video"'));
 assert.ok(!payment.includes('id="face-photo"'));
 assert.match(script,/\$\('video-media-section'\)\.hidden=!show/);
 assert.match(script,/withu:checkout-stage/);
 for(const id of ['photo-filename','video-filename','clear-face-photo','clear-face-video']){
  assert.ok(page.includes('id="'+id+'"'),id);
 }
 assert.match(page,/id="video-preview"[^>]*controls[^>]*playsinline/);
 assert.match(styles,/\.video-media-section \.compact-preview\{height:156px/);
});

test('user photo/video previews can be independently removed',()=>{
 assert.match(script,/function showPhoto\(file\)/);
 assert.match(script,/function showVideoBlob\(file\)/);
 assert.doesNotMatch(script,/function showPhoto\(file\)\s*\{\s*if\(!requireConsent\(\)\)return/);
 assert.match(script,/URL\.createObjectURL\(file\)/);
 assert.match(script,/\$\('photo-preview'\)/);
 assert.match(script,/\$\('video-preview'\)/);
 assert.match(script,/function clearPhoto\(\)/);
 assert.match(script,/function clearVideo\(\)/);
 assert.match(script,/\$\('clear-face-photo'\)\.addEventListener\('click',clearPhoto\)/);
 assert.match(script,/\$\('clear-face-video'\)\.addEventListener\('click',clearVideo\)/);
 assert.match(script,/if\(!show\)clearMedia\(\)/);
 assert.match(page,/주문 서버로 전송되지 않습니다/);
});

test('camera and photo previews cannot upload files or synthesize a fake video',()=>{
 assert.doesNotMatch(script,/fetch\([\s\S]*method\s*:\s*['"]POST/);
 assert.doesNotMatch(script,/localStorage|sessionStorage|indexedDB/);
 assert.match(script,/URL\.revokeObjectURL/);
 assert.match(script,/window\.addEventListener\('pagehide'/);
 assert.match(page,/사진의 얼굴을 움직이는 가수 영상에 자동으로 교체한 결과는 아닙니다/);
 assert.match(page,/기기에서만 보이고/);
 assert.match(server,/camera=\(self\), microphone=\(self\)/);
 assert.match(server,/img-src 'self' data: blob:/);
 assert.ok(server.includes("'/checkout-media.js':'docs/checkout-media.js'"));
});
