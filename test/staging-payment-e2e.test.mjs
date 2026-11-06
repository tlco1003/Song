import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/server.mjs';
import {createLocalStagingGateway} from '../src/local-staging-gateway.mjs';

const adminKey='test_admin_only_NOT_FOR_ACTUAL_APPLICATION_2026_11_06_ABC';
const story={
 recipient:'엄마',memory:'밤에 따뜻한 도시락을 건네주셨던 기억이 납니다.',
 message:'늘 감사하고 사랑해요',gratitudeApology:'미안하고 고마웠어요',
 occasion:'감사',recipientAgeGroup:'50s',relativePosition:'family',
 speechStyle:'polite',genre:'발라드',mood:'감동적인',eraPreference:'1980s',lyricLength:'full'
};
const draft={
 selectedProduct:'audio',genreSelection:{mode:'single',genres:['발라드']},
 story
};
const contact=(email)=>({
 customerEmail:email,customerPhone:'010-1234-5678',
 deliveryChannel:'email',deliveryConsent:true
});
function wavFixture(){
 const pcm=Buffer.alloc(800);
 const audio=Buffer.alloc(44+pcm.length);
 audio.write('RIFF',0,4,'ascii');audio.writeUInt32LE(audio.length-8,4);
 audio.write('WAVE',8,4,'ascii');audio.write('fmt ',12,4,'ascii');
 audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);
 audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);
 audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);
 audio.writeUInt16LE(16,34);audio.write('data',36,4,'ascii');
 audio.writeUInt32LE(pcm.length,40);
 pcm.copy(audio,44);return audio;
}
async function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'withu-test-isolation-'));
 const oldFlag=process.env.WITHU_STAGING_ENABLED;
 const oldDir=process.env.WITHU_PRIVATE_MUSIC_DIR;
 process.env.WITHU_STAGING_ENABLED='true';
 process.env.WITHU_PRIVATE_MUSIC_DIR=dir;
 const gateway=createLocalStagingGateway({
  privateMusicDir:dir,adminKey
 });
 const app=createApp({customerAccess:gateway,staging:gateway});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{
  await new Promise(resolve=>app.close(resolve));
  rmSync(dir,{recursive:true,force:true});
  if(oldFlag==null)delete process.env.WITHU_STAGING_ENABLED;
  else process.env.WITHU_STAGING_ENABLED=oldFlag;
  if(oldDir==null)delete process.env.WITHU_PRIVATE_MUSIC_DIR;
  else process.env.WITHU_PRIVATE_MUSIC_DIR=oldDir;
 });
 const base='http://127.0.0.1:'+app.address().port;
 async function call(route,input,allow=true){
  const response=await fetch(base+route,{
   method:'POST',
   headers:{
    'x-withu-test-key':allow?adminKey:'wrong_key',
    'Content-Type':'application/json'
   },
   body:JSON.stringify(input)
  });
  const json=await response.json();
  return {status:response.status,json};
 }
 async function createAndPay(email){
  const created=await call('/api/_staging/orders',{draft,contact:contact(email)});
  assert.equal(created.status,201);
  assert.equal(created.json.amountKrw,29000);
  const pay=await call('/api/_staging/orders/'+created.json.orderId+'/simulate-payment',{});
  assert.equal(pay.status,200);
  assert.equal(pay.json.status,'TEST_PAYMENT_COMPLETE_NO_CHARGE');
  return created.json.orderId;
 }
 async function addAudio(){
  const response=await fetch(base+'/api/_staging/audio',{
   method:'POST',
   headers:{
    'x-withu-test-key':adminKey,'x-withu-audio-name':'customer_recording.wav',
    'Content-Type':'application/octet-stream'
   },body:wavFixture()
  });
  assert.equal(response.status,201);
  return (await response.json()).fileName;
 }
 async function finish(orderId,audio,title){
  const r=await call('/api/_staging/orders/'+orderId+'/finish',{
   songs:[{fileName:audio,title,genre:'발라드',
    lyrics:'[Verse 1]\n좋은 날의 마음\n[Chorus]\n이 노래를 드릴게요'}]
  });
  assert.equal(r.status,200);
  assert.equal(r.json.status,'TEST_DELIVERY_READY');
 }
 async function outbox(){
  const result=await fetch(base+'/api/_staging/outbox',{
   headers:{'x-withu-test-key':adminKey}
  });
  assert.equal(result.status,200);
  return (await result.json()).messages;
 }
 return {base,call,createAndPay,addAudio,finish,outbox};
}

test('a simulated payment is not publicly activated and never charges a real gateway',async(t)=>{
 const {base,call,createAndPay}=await setup(t);
 const inaccessible=await call('/api/_staging/orders',{draft,contact:contact('a@example.test')},false);
 assert.equal(inaccessible.status,403);
 const page=await fetch(base+'/_staging');
 assert.equal(page.status,200);
 assert.match(await page.text(),/실제 결제가 발생하지 않습니다/);
 const orderId=await createAndPay('alpha@example.test');
 const second=await call('/api/_staging/orders/'+orderId+'/simulate-payment',{});
 assert.notEqual(second.status,200);
 const live=await fetch(base+'/api/commerce/orders',{
  method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
 });
 assert.equal(live.status,503);
 const library=await fetch(base+'/api/delivery/library');
 assert.equal(library.status,401);
});
test('operator upload -> mock email -> one-time link -> own private playback only',async(t)=>{
 const {base,createAndPay,addAudio,finish,outbox}=await setup(t);
 const order1=await createAndPay('alpha@example.test');
 const order2=await createAndPay('beta@example.test');
 const wav1=await addAudio(),wav2=await addAudio();
 assert.notEqual(wav1,wav2);
 await finish(order1,wav1,'첫 고객에게');
 await finish(order2,wav2,'두 번째 고객에게');
 const events=await outbox();
 const mails=events.filter(x=>x.type==='TEST_LINK_PREVIEW_NOT_SENT');
 assert.equal(mails.length,2);
 assert.notEqual(mails[0].listeningUrl,mails[1].listeningUrl);
 assert.ok(mails.every(x=>x.listeningUrl.startsWith(base+'/my-music.html#delivery=')));
 assert.ok(mails.every(x=>x.testOnly===true));
 const getToken=url=>new URLSearchParams(new URL(url).hash.slice(1)).get('delivery');
 async function redeem(token){
  return fetch(base+'/api/delivery/resolve',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({token})
  });
 }
 const response1=await redeem(getToken(mails[0].listeningUrl));
 assert.equal(response1.status,200);
 const cookie1=response1.headers.get('set-cookie').split(';')[0];
 const client1=await response1.json();
 assert.equal(client1.track.title,'첫 고객에게');
 assert.equal(client1.tracks.length,1);
 assert.equal(client1.commercialUpgrade.status,'unavailable');
 assert.equal(client1.track.privateDownloadUrl,undefined);
 const tokenReplay=await redeem(getToken(mails[0].listeningUrl));
 assert.equal(tokenReplay.status,403,'Delivery token must be one-time');
 const response2=await redeem(getToken(mails[1].listeningUrl));
 assert.equal(response2.status,200);
 const cookie2=response2.headers.get('set-cookie').split(';')[0];
 const client2=await response2.json();
 assert.equal(client2.track.title,'두 번째 고객에게');
 const customer1=await fetch(base+'/api/delivery/library',{headers:{cookie:cookie1}});
 assert.equal(customer1.status,200);
 assert.equal((await customer1.json()).track.title,'첫 고객에게');
 const customer2=await fetch(base+'/api/delivery/library',{headers:{cookie:cookie2}});
 assert.equal(customer2.status,200);
 assert.equal((await customer2.json()).track.title,'두 번째 고객에게');
 const own=await fetch(base+client1.track.privateMediaUrl,{
  headers:{cookie:cookie1,range:'bytes=0-43'}
 });
 assert.equal(own.status,206);
 assert.equal((await own.arrayBuffer()).byteLength,44);
 const stolen=await fetch(base+client2.track.privateMediaUrl,{headers:{cookie:cookie1}});
 assert.equal(stolen.status,403,'Customer A must not access customer B asset');
 const noLogin=await fetch(base+client1.track.privateMediaUrl);
 assert.equal(noLogin.status,401);
 const download=await fetch(base+'/api/delivery-downloads/'+client1.track.privateMediaUrl.split('/').pop(),{
  headers:{cookie:cookie1}
 });
 assert.equal(download.status,403);
});
test('wrong media format and nonexistent file cannot be delivered as a bought song',async(t)=>{
 const {base,call,createAndPay}=await setup(t);
 const orderId=await createAndPay('customer@example.test');
 const invalidAudio=await fetch(base+'/api/_staging/audio',{
  method:'POST',headers:{
   'x-withu-test-key':adminKey,
   'x-withu-audio-name':'fake.mp3','Content-Type':'application/octet-stream'
  },
  body:Buffer.from('not an mp3'.repeat(10))
 });
 assert.notEqual(invalidAudio.status,201);
 const finish=await call('/api/_staging/orders/'+orderId+'/finish',{
  songs:[{fileName:'../../steal.wav',title:'비공개',genre:'발라드',
   lyrics:'[Verse]\n테스트\n[Chorus]\n노래'}]
 });
 assert.notEqual(finish.status,200);
 const noOutbox=await fetch(base+'/api/_staging/outbox',{headers:{'x-withu-test-key':adminKey}});
 assert.equal((await noOutbox.json()).messages.filter(x=>x.listeningUrl).length,0);
});
