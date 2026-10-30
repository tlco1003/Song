import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
test('GET UI and API health without provider keys',async()=>{
  const app=createApp();await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${app.address().port}`;
  try{
    let r=await fetch(url+'/');assert.equal(r.status,200);assert.match(await r.text(),/내 이야기가/);
    r=await fetch(url+'/api/config');assert.equal(r.status,200);const j=await r.json();assert.equal(typeof j.musicReady,'boolean');
    r=await fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({story:'hello'})});assert.equal(r.status,503);
    r=await fetch(url+'/api/unknown');assert.equal(r.status,404);
    r=await fetch(url+'/../package.json');assert.equal(r.status,404);
  }finally{await new Promise(resolve=>app.close(resolve));}
});
