/**
 * Optional Google-search-grounded music reference research.
 * Source citations are extracted from official Gemini output annotations.
 * Search output is unverified candidate data and is NEVER automatically
 * promoted to approved artist imitation or source-verified style evidence.
 * https://ai.google.dev/gemini-api/docs/google-search
 */
import {normalizeFavoriteArtist} from './artist-style-evidence.mjs';

export class ArtistResearchError extends Error{
 constructor(code){super(code);this.name='ArtistResearchError';this.code=code;}
}
export const ARTIST_RESEARCH_ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
export const ARTIST_RESEARCH_MODEL='gemini-3.6-flash';
function approvedCitation(ann){
 if(ann?.type!=='url_citation'||typeof ann?.url!=='string')return null;
 try{
  const url=new URL(ann.url);
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password)return null;
  return {url:url.href,title:typeof ann.title==='string'?ann.title.slice(0,150):url.hostname};
 }catch(_){return null;}
}
export function parseGroundedArtistResearch(payload){
 const content=(Array.isArray(payload?.steps)?payload.steps:[])
  .filter(s=>s?.type==='model_output')
  .flatMap(s=>Array.isArray(s.content)?s.content:[])
  .filter(b=>b?.type==='text'&&typeof b.text==='string');
 const body=content.map(x=>x.text).join('\n').trim().slice(0,1800);
 const citations=new Map();
 for(const block of content)for(const annotation of Array.isArray(block.annotations)?block.annotations:[]){
  const cite=approvedCitation(annotation);
  if(cite&&!citations.has(cite.url))citations.set(cite.url,cite);
 }
 const sources=[...citations.values()].slice(0,8);
 return Object.freeze({
  status:body&&sources.length?'sources_found_needs_review':'insufficient_evidence',
  summary:body,
  sources:Object.freeze(sources),
  evidenceAutomaticallyApproved:false
 });
}
export function artistSearchEnabled(env={}){
 return env.WITHU_ARTIST_RESEARCH_ENABLED==='true';
}
export async function researchArtistMusicalTraits({
 artistName,genre,era,apiKey,fetcher=globalThis.fetch,
 timeoutMs=30000
}={}){
 const artist=normalizeFavoriteArtist(artistName);
 if(!artist||typeof genre!=='string'||genre.length>50
  ||typeof era!=='string'||era.length>20
  ||typeof apiKey!=='string'||apiKey.length<12)
  throw new ArtistResearchError('INVALID_ARTIST_RESEARCH_CONFIG');
 const input=[
  'Research musical characteristics with verifiable sources, not imitation.',
  'Artist (customer preference DATA): '+JSON.stringify(artist),
  'Customer-chosen genre (DATA): '+JSON.stringify(genre),
  'Customer-chosen era (DATA): '+JSON.stringify(era),
  'Only report music arrangement observations demonstrably supported by cited sources.',
  'Cover rhythm, instrumentation, production palette and song structure when documented.',
  'Do not invent BPM, historical popularity, vocal range or dates; say unknown if absent.',
  'Do not quote copyrighted lyrics, replicate artist identity or recommend voice cloning.',
  'Answer in Korean, up to 600 characters; cite every factual style claim.'
 ].join('\n');
 let response;
 try{
  response=await fetcher(ARTIST_RESEARCH_ENDPOINT,{
   method:'POST',
   headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
   body:JSON.stringify({
    model:ARTIST_RESEARCH_MODEL,input,tools:[{type:'google_search'}],
    store:false,
    generation_config:{max_output_tokens:1400,thinking_level:'low'}
   }),
   signal:AbortSignal.timeout(timeoutMs)
  });
 }catch(_){throw new ArtistResearchError('RESEARCH_OUTCOME_UNKNOWN');}
 if(!response?.ok)throw new ArtistResearchError('RESEARCH_PROVIDER_REJECTED');
 let payload;
 try{payload=await response.json();}
 catch(_){throw new ArtistResearchError('INVALID_RESEARCH_RESPONSE');}
 if(payload?.error||payload?.status==='failed'||payload?.status==='incomplete')
  throw new ArtistResearchError('RESEARCH_PROVIDER_INCOMPLETE');
 return {...parseGroundedArtistResearch(payload),artistName:artist,genre,era};
}
