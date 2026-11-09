import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validatePrivateStyleEvidence,readPrivateStyleEvidence} from '../src/private-style-evidence.mjs';
import {composeServerMusicStyle} from '../src/music-style-library.mjs';
const fixture={schemaVersion:1,genreSlug:'ballad',era:'1990s',
 sources:[{type:'analysis',title:'Synthetic test fixture, not empirical findings',
  url:'https://example.org/test-fixture'}],
 features:{tempoBpm:{min:65,max:85},meter:'4/4',instruments:['piano','cello']}};
test('unverified or malformed style evidence cannot enter private music prompt',()=>{
 assert.throws(()=>validatePrivateStyleEvidence({...fixture,sources:[]}));
 assert.throws(()=>validatePrivateStyleEvidence({...fixture,features:{tempoBpm:{min:190,max:40}}}));
 assert.throws(()=>validatePrivateStyleEvidence({...fixture,features:{instruments:['unknown']}}));
});
test('evidence is read only from explicit operator private directory and identity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'withu-evidence-test-'));
 try{
  mkdirSync(join(dir,'evidence'));
  writeFileSync(join(dir,'evidence','ballad__1990s.json'),JSON.stringify(fixture));
  const entry=readPrivateStyleEvidence(dir,{genreSlug:'ballad',era:'1990s'});
  assert.match(entry.cue,/65-85 BPM/);
  assert.match(entry.cue,/piano, cello/);
  assert.equal(readPrivateStyleEvidence(dir,{genreSlug:'jazz',era:'1990s'}),null);
  assert.throws(()=>readPrivateStyleEvidence(dir,{genreSlug:'../etc',era:'1990s'}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('private observations augment style only for a matching selection',()=>{
 const dir=mkdtempSync(join(tmpdir(),'withu-style-evidence-'));
 try{
  for(const name of ['genre','era','mood','evidence'])mkdirSync(join(dir,name));
  writeFileSync(join(dir,'genre','ballad.md'),'Private lyrical ballad prompt with Korean articulation and original movement.');
  writeFileSync(join(dir,'era','1990s.md'),'Private era context constrained to original arrangement decisions.');
  writeFileSync(join(dir,'mood','warm.md'),'Private warm mood anchored to the customer narrative.');
  writeFileSync(join(dir,'evidence','ballad__1990s.json'),JSON.stringify(fixture));
  const style=composeServerMusicStyle({
   genre:'발라드',mood:'따뜻한',eraPreference:'1990s'
  },{privateDirectory:dir});
  assert.match(style,/Observed tempo band 65-85 BPM/);
  assert.ok(style.length<=1000);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
