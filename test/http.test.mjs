import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
test('GET UI and GPT/Suno config without provider credentials',async()=>{
  const app=createApp();
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+app.address().port;
  try{
    let health=await fetch(url+'/healthz');
    assert.equal(health.status,200);
    assert.deepEqual(await health.json(),{status:'ok',service:'withu-api'});
    let res=await fetch(url+'/');
    assert.equal(res.status,200);
    assert.match(await res.text(),/내 이야기가/);
    res=await fetch(url+'/api/config');
    assert.equal(res.status,200);
    const config=await res.json();
    assert.equal(config.lyricsProvider,'openai');
    assert.equal(config.musicProvider,'suno-mcp');
    assert.equal(typeof config.lyricsReady,'boolean');
    assert.equal(config.sunoMcpUrl,'https://api.suno.com/mcp');
    res=await fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({story:'hello'})});
    assert.equal(res.status,410);
    res=await fetch(url+'/api/unknown');
    assert.equal(res.status,404);
    res=await fetch(url+'/../package.json');
    assert.equal(res.status,404);
  }finally{await new Promise(resolve=>app.close(resolve));}
});
