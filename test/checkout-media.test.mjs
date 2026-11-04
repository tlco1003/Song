import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicPriceCatalog,publicCommerceReadiness} from '../src/commerce.mjs';

const read=filename=>readFileSync(new URL('../'+filename,import.meta.url),'utf8');
const page=read('docs/checkout.html');
const script=read('docs/checkout-media.js');
const styles=read('docs/checkout.css');
const server=read('src/server.mjs');

test('three documented prices and no unexpected charge',()=>{
 const products=publicPriceCatalog().products;
 assert.deepEqual(products.map(x=>[x.id,x.amountKrw]),[
  ['audio',29000],['audio_duo',39000],['audio_video',300000]
 ]);
 assert.equal(products[2].priceKind,'starting_at');
 assert.equal(products[2].quoteRequired,true);
 assert.equal(publicCommerceReadiness().canCharge,false);
 assert.match(page,/id="confirm-checkout"[^>]*disabled/);
});

test('published audio examples and device audio preview are capped at thirty seconds in the UI',()=>{
 const ids=['prepay-demo','audio-example','audio-file-choice','audio-preview-play','audio-preview-reset',
  'audio-preview-time','audio-preview-fill','audio-preview-element','audio-preview-message'];
 for(const id of ids)assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(script,/const LIMIT = 30/);
 assert.match(script,/audio\.currentTime>=LIMIT/);
 assert.match(script,/audio\.currentTime>LIMIT/);
 assert.match(script,/audio\.pause\(\)/);
 assert.match(script,/audio\.addEventListener\('timeupdate',refreshAudioClock\)/);
 assert.match(script,/media\/tracks\.json/);
 assert.match(script,/URL\.createObjectURL/);
 assert.match(page,/기존 예시곡/);
 assert.match(page,/고객 맞춤곡을 미리 생성하는 기능은 아닙니다/);
});

test('video package includes photo, video, iPhone native camera fallback and self camera recorder',()=>{
 const ids=['video-media-section','media-consent','face-photo','face-video','native-camera-capture',
  'photo-preview','video-preview','stage-portrait-image','camera-live','open-camera',
  'start-camera-record','stop-camera-record','close-camera','record-timer','camera-feedback','clear-media-preview'];
 for(const id of ids)assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(page,/id="video-media-section"[^>]*hidden/);
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

test('camera and photo previews stay on device without a client upload or fake face-swap result',()=>{
 assert.doesNotMatch(script,/fetch\([^\n]*method\s*:\s*['"]POST/);
 assert.doesNotMatch(script,/localStorage|sessionStorage|indexedDB/);
 assert.match(script,/URL\.revokeObjectURL/);
 assert.match(script,/window\.addEventListener\('pagehide'/);
 assert.match(page,/실제 얼굴 교체와 립싱크 생성은 아직 연결 전/);
 assert.match(page,/서버로 전송되지 않고/);
 assert.match(server,/camera=\(self\), microphone=\(self\)/);
 assert.match(server,/img-src 'self' data: blob:/);
 assert.ok(server.includes("'/checkout-media.js':'docs/checkout-media.js'"));
});
