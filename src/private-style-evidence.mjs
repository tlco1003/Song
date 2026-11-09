/**
 * Schema-validated private genre × decade observations.
 * This module NEVER creates fabricated statistics or emits a copyrighted tune.
 * Real analysis data stays outside the public repository in the protected
 * WITHU_PRIVATE_STYLE_DIR/evidence directory.
 */
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const ALLOWED_METER=new Set(['2/4','3/4','4/4','6/8','12/8']);
const INSTRUMENTS=new Set([
 'piano','acoustic guitar','electric guitar','strings','cello','violin',
 'harp','oboe','flute','drums','brush drums','upright bass','electric bass',
 'synthesizer','brass','woodwinds','choir','percussion','organ'
]);
function validURL(s){
 if(typeof s!=='string')return false;
 try{return new URL(s).protocol==='https:';}catch(_){return false;}
}
export function validatePrivateStyleEvidence(entry){
 if(entry?.schemaVersion!==1||typeof entry.genreSlug!=='string'
   ||!/^[a-z0-9-]+$/.test(entry.genreSlug)||typeof entry.era!=='string'
   ||!/^(19[6-9]0s|20[0-2]0s)$/.test(entry.era))
  throw Error('Invalid private music evidence identity');
 if(!Array.isArray(entry.sources)||entry.sources.length<1||entry.sources.length>8
   ||entry.sources.some(s=>!validURL(s?.url)
    ||!['analysis','research','chart'].includes(s?.type)
    ||typeof s?.title!=='string'||s.title.length<8||s.title.length>180))
  throw Error('Music evidence requires qualified source metadata');
 const feat=entry.features;
 if(!feat||typeof feat!=='object'||Array.isArray(feat))throw Error('Missing genre-era features');
 const bpm=feat.tempoBpm;
 if(bpm!==undefined&&(!Number.isInteger(bpm?.min)||!Number.isInteger(bpm?.max)
   ||bpm.min<35||bpm.max>240||bpm.min>bpm.max||bpm.max-bpm.min>110))
  throw Error('Invalid measured tempo range');
 if(feat.meter!==undefined&&!ALLOWED_METER.has(feat.meter))throw Error('Unsupported meter');
 if(feat.instruments!==undefined&&(!Array.isArray(feat.instruments)
   ||feat.instruments.length<1||feat.instruments.length>5
   ||new Set(feat.instruments).size!==feat.instruments.length
   ||feat.instruments.some(x=>!INSTRUMENTS.has(x))))
  throw Error('Unsupported instrumentation');
 if(!bpm&&!feat.meter&&!feat.instruments)throw Error('No evidenced musical feature');
 // A cue is an arrangement-level observation, not an imitation instruction.
 const cues=[];
 if(bpm)cues.push('Observed tempo band '+bpm.min+'-'+bpm.max+' BPM');
 if(feat.meter)cues.push('meter '+feat.meter);
 if(feat.instruments)cues.push('palette '+feat.instruments.join(', '));
 const cue=cues.join('; ')+'.';
 if(cue.length>240)throw Error('Music evidence cue exceeds bounded style budget');
 return Object.freeze({genreSlug:entry.genreSlug,era:entry.era,cue,sourceCount:entry.sources.length});
}
export function readPrivateStyleEvidence(privateDirectory,{genreSlug,era}={}){
 if(!privateDirectory||era==='none')return null;
 if(!/^[a-z0-9-]+$/.test(genreSlug||'')
   ||!/^(19[6-9]0s|20[0-2]0s)$/.test(era||''))throw Error('Invalid evidence request');
 const path=join(resolve(privateDirectory),'evidence',genreSlug+'__'+era+'.json');
 let raw;
 try{raw=readFileSync(path,'utf8');}
 catch(e){if(e?.code==='ENOENT')return null;throw e;}
 if(raw.length>18000)throw Error('Private evidence record too large');
 let parsed;
 try{parsed=JSON.parse(raw);}catch(_){throw Error('Invalid private music evidence JSON');}
 const result=validatePrivateStyleEvidence(parsed);
 if(result.genreSlug!==genreSlug||result.era!==era)
  throw Error('Private evidence identity mismatch');
 return result;
}
