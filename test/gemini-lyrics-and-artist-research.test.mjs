import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiLyricsProvider,GEMINI_TEXT_ENDPOINT}
 from '../src/gemini-lyrics-provider.mjs';
import {researchArtistMusicalTraits,parseGroundedArtistResearch,
 ARTIST_RESEARCH_ENDPOINT,artistSearchEnabled}
 from '../src/artist-research-provider.mjs';

const key='gemini_fake_key_for_node_tests';
const prompt='고객의 이야기만 가지고 감동적인 한국어 가사를 생성해 주세요. '.repeat(5);
const lyrics='[Verse 1]\n엄마 고마워요\n[Chorus]\n언제나 사랑해요';
test('single Google-key Gemini lyrics provider submits private lyric prompt without search cost',async()=>{
 const calls=[];
 const provider=createGeminiLyricsProvider({apiKey:key,fetcher:async(url,options)=>{
  calls.push({url,options});
  return {ok:true,json:async()=>({
   status:'completed',steps:[{type:'model_output',content:[{type:'text',text:lyrics}]}]
  })};
 }});
 const result=await provider.generate({prompt,lyricLength:'full'});
 assert.equal(result,lyrics);
 assert.equal(calls.length,1);assert.equal(calls[0].url,GEMINI_TEXT_ENDPOINT);
 const body=JSON.parse(calls[0].options.body);
 assert.equal(body.model,'gemini-3.6-flash');
 assert.equal(body.store,false);
 assert.equal(body.generation_config.max_output_tokens,4500);
 assert.equal(body.tools,undefined);
});
test('incomplete Gemini lyrics never pass production quality check',async()=>{
 const provider=createGeminiLyricsProvider({apiKey:key,fetcher:async()=>({
  ok:true,json:async()=>({status:'incomplete',output_text:lyrics})
 })});
 await assert.rejects(provider.generate({prompt}),/GEMINI_LYRICS_FAILED/);
});
test('Gemini search must return grounded HTTPS citations; results require human review',async()=>{
 const r=parseGroundedArtistResearch({
  steps:[{type:'model_output',content:[{
   type:'text',text:'관찰 가능한 특징은 재즈 트리오 편곡입니다.',
   annotations:[{
    type:'url_citation',url:'https://example.org/verified-source',
    title:'Verified test source',start_index:0,end_index:24
   },{type:'url_citation',url:'http://example.org/unsafe',
    title:'Unverified',start_index:0,end_index:10}]
  }]}]
 });
 assert.equal(r.status,'sources_found_needs_review');
 assert.equal(r.sources.length,1);
 assert.equal(r.evidenceAutomaticallyApproved,false);
 assert.ok(!r.sources.some(x=>x.url.startsWith('http:')));
 assert.equal(parseGroundedArtistResearch({steps:[{
  type:'model_output',content:[{type:'text',text:'추정일 뿐'}]
 }]}).status,'insufficient_evidence');
});
test('optional live grounded search sends only genre-era-artist data and captures cited report',async()=>{
 const calls=[];
 const result=await researchArtistMusicalTraits({
  artistName:'테스트 가수',genre:'재즈',era:'1990s',apiKey:key,
  fetcher:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,json:async()=>({
    status:'completed',steps:[{type:'model_output',content:[{
     type:'text',text:'확인된 음악적 특징이 제한적입니다.',
     annotations:[{
      type:'url_citation',url:'https://example.org/style-note',
      title:'Music source',start_index:0,end_index:15
     }]
    }]}]
   })};
  }
 });
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,ARTIST_RESEARCH_ENDPOINT);
 const body=JSON.parse(calls[0].options.body);
 assert.deepEqual(body.tools,[{type:'google_search'}]);
 assert.equal(body.store,false);
 assert.match(body.input,/테스트 가수/);
 assert.equal(result.status,'sources_found_needs_review');
 assert.equal(result.evidenceAutomaticallyApproved,false);
 assert.equal(artistSearchEnabled({}),false);
});
