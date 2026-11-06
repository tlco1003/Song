import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

test('self-hosted video status route is connected but customer generation stays blocked',async()=>{
 const app=createApp();
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.address().port;
 try{
   const status=await fetch(base+'/api/video-ai/readiness');
   assert.equal(status.status,200);
   const body=await status.json();
   assert.equal(body.engine,'song-vision-self-hosted');
   assert.equal(body.externalVideoApiRequired,false);
   assert.equal(body.canAcceptCustomerJobs,false);
   const post=await fetch(base+'/api/video-ai/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   assert.equal(post.status,404);
   const commerce=await fetch(base+'/api/commerce/readiness');
   assert.equal((await commerce.json()).canCharge,false);
 }finally{
   await new Promise(resolve=>app.close(resolve));
 }
});
