import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
const exec=promisify(execFile);

test('mocked paid providers: voice create -> 30s generation -> stem split -> conversion -> mix -> delete', {timeout:30000},async()=>{
  const oldFetch=globalThis.fetch;
  const oldGoogle=process.env.GEMINI_API_KEY;
  const oldEleven=process.env.ELEVENLABS_API_KEY;
  process.env.GEMINI_API_KEY='test-key';process.env.ELEVENLABS_API_KEY='test-key';
  const temp=await mkdtemp(path.join(os.tmpdir(),'song-pipeline-test-'));
  const mockMp3=path.join(temp,'voice.mp3');
  const zipfile=path.join(temp,'stems.zip');
  await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2.5','-codec:a','libmp3lame',mockMp3]);
  const source=await readFile(mockMp3);
  await writeFile(path.join(temp,'vocals.mp3'),source);await writeFile(path.join(temp,'no_vocals.mp3'),source);
  await exec('zip',['-q',zipfile,'vocals.mp3','no_vocals.mp3'],{cwd:temp});
  const zip=await readFile(zipfile);
  const providerCalls=[];
  globalThis.fetch=(input, opts={})=>{
    const url=String(input);
    if(!url.startsWith('https://'))return oldFetch(input,opts);
    providerCalls.push(url);
    if(url.includes('generativelanguage.googleapis.com'))return Promise.resolve(new Response(JSON.stringify({steps:[{type:'model_output',content:[{type:'audio',data:source.toString('base64')},{type:'text',text:'가사'}]}]}),{status:200,headers:{'Content-Type':'application/json'}}));
    if(url.endsWith('/voices/add'))return Promise.resolve(new Response(JSON.stringify({voice_id:'abcdefghijkl1234567890',requires_verification:false}),{status:200,headers:{'Content-Type':'application/json'}}));
    if(url.includes('stem-separation'))return Promise.resolve(new Response(zip,{status:200,headers:{'Content-Type':'application/zip'}}));
    if(url.includes('voice-changer'))return Promise.resolve(new Response(source,{status:200,headers:{'Content-Type':'audio/mpeg'}}));
    if(url.includes('/voices/') && opts.method==='DELETE')return Promise.resolve(new Response(null,{status:204}));
    throw new Error(`Unexpected provider call: ${url}`);
  };
  const app=createApp();await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${app.address().port}`;
  try{
    let res=await fetch(url+'/api/voices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'test',mimeType:'audio/mpeg',audioBase64:source.toString('base64'),consent:true})});assert.equal(res.status,201);const voice=await res.json();assert.equal(voice.voiceId,'abcdefghijkl1234567890');
    res=await fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({story:'함께 걷던 날에 대한 따뜻한 우리의 추억',genre:'발라드',mood:'따뜻한',voiceId:voice.voiceId})});assert.equal(res.status,202);const initial=await res.json();let job;
    for(let i=0;i<80;i++) {await new Promise(r=>setTimeout(r,100));job=await (await fetch(url+`/api/jobs/${initial.id}`)).json();if(job.status==='completed'||job.status==='failed')break;}
    assert.equal(job.status,'completed',JSON.stringify(job));assert.ok(job.assets.original);assert.ok(job.assets.final);assert.equal(job.lyrics,'가사');
    res=await fetch(url+job.assets.final);assert.equal(res.status,200);assert.ok((await res.arrayBuffer()).byteLength>1000);
    res=await fetch(url+`/api/jobs/${initial.id}`,{method:'DELETE'});assert.equal(res.status,200);
    res=await fetch(url+`/api/voices/${voice.voiceId}`,{method:'DELETE'});assert.equal(res.status,200);
    assert.equal(providerCalls.length,5);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldGoogle===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldGoogle;
    if(oldEleven===undefined)delete process.env.ELEVENLABS_API_KEY;else process.env.ELEVENLABS_API_KEY=oldEleven;
    await new Promise(resolve=>app.close(resolve));await rm(temp,{recursive:true,force:true});
  }
});
