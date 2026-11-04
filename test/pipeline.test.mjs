import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeLyrics,createSunoSong,SUNO_MCP_URL} from '../src/providers.mjs';
import {createApp} from '../src/server.mjs';

const gift={
  recipient:'엄마',memory:'늘 열심히 일하고 따뜻하게 안아 주던 모습',
  message:'엄마의 딸이라서 다행이야',gratitudeApology:'늘 고마워',
  occasion:'감사',genre:'발라드',mood:'따뜻한',lyricLength:'full',
  speechStyle:'casual',recipientAgeGroup:'60s',relativePosition:'older'
};
const sample='[Verse 1]\n엄마, 내가 그때는 몰랐어\n[Chorus]\n엄마 딸이라서 참 다행이야';
const oldFetch=globalThis.fetch;

test('GPT lyric creation uses OpenAI only and retains the original recipient inputs',async()=>{
  let called=0;
  const existing=globalThis.fetch;
  globalThis.fetch=async (url,opts)=>{
    called++;
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(opts.headers.Authorization,'Bearer test-openai');
    const body=JSON.parse(opts.body);
    assert.equal(body.model,'gpt-6-astra');
    assert.match(body.input,/엄마의 딸이라서 다행이야/);
    assert.match(body.input,/"speechStyle":"casual"/);
    return new Response(JSON.stringify({
      status:'completed',
      output:[{type:'message',role:'assistant',content:[{type:'output_text',text:sample}]}]
    }),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const lyric=await makeLyrics({...gift,story:'엄마가 따뜻하게 안아 줬어',brief:gift,
      delivery:{recipientAgeGroup:'60s',relativePosition:'older',speechStyle:'casual'}},{
      OPENAI_API_KEY:'test-openai'
    });
    assert.equal(lyric,sample);
    assert.equal(called,1);
  }finally{globalThis.fetch=existing;}
});

test('Suno official MCP call contains approved lyrics and explicit OAuth authorization',async()=>{
  const existing=globalThis.fetch;
  globalThis.fetch=async (url,opts)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(opts.body);
    assert.equal(body.tools[0].server_url,SUNO_MCP_URL);
    assert.equal(body.tools[0].authorization,'official-oauth-token');
    assert.equal(body.tools[0].require_approval,'never');
    assert.ok(body.input.includes(JSON.stringify(sample)));
    return new Response(JSON.stringify({
      status:'completed',output:[
        {type:'mcp_list_tools',server_label:'suno',tools:[{name:'create_song'}]},
        {type:'mcp_call',name:'create_song',status:'completed',output:'Created successfully: song in Suno library'},
        {type:'message',role:'assistant',content:[{type:'output_text',text:'The song was created with Suno'}]}
      ]
    }),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const out=await createSunoSong({...gift,lyrics:sample},{
      OPENAI_API_KEY:'test-openai',SUNO_MCP_ACCESS_TOKEN:'official-oauth-token'
    });
    assert.equal(out.confirmedMcpCalls,1);
    assert.equal(out.provider,'suno');
    assert.match(out.response,/Suno/);
  }finally{globalThis.fetch=existing;}
});

test('Suno generation refuses missing OAuth token before spending credits',async()=>{
  await assert.rejects(
    ()=>createSunoSong({...gift,lyrics:sample},{OPENAI_API_KEY:'test-openai'}),
    /SUNO_MCP_ACCESS_TOKEN/
  );
});

test('Suno generation fails closed when no actual MCP tool call occurs',async()=>{
  const existing=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({
    status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'I will create a song'}]}]
  }),{status:200});
  try{
    await assert.rejects(
      ()=>createSunoSong({...gift,lyrics:sample},{
        OPENAI_API_KEY:'test-openai',SUNO_MCP_ACCESS_TOKEN:'official-oauth-token'
      }),
      /실제 음악 생성 도구 호출/
    );
  }finally{globalThis.fetch=existing;}
});

test('MCP creation HTTP endpoint requires authentication and explicit credit confirmation',async(t)=>{
  const app=createApp();
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const url='http://127.0.0.1:'+app.address().port+'/api/suno-mcp/create';
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...gift,lyrics:sample})});
  assert.equal(res.status,503);
});
