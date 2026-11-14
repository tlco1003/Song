/**
 * Verified artist preference evidence only. A customer's artist name is a
 * discovery key, NEVER a voice imitation target or a provider style prompt.
 * Admin-curated source-bearing profiles live OUTSIDE public git.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {validatePrivateStyleEvidence} from './private-style-evidence.mjs';

export function normalizeFavoriteArtist(value=''){
 if(typeof value!=='string')throw Error('Favorite artist must be text');
 if(/[\x00-\x1f\x7f<>]/u.test(value))throw Error('Invalid favorite artist preference');
 const name=value.normalize('NFC').trim().replace(/\s+/g,' ');
 if(name.length>80)
  throw Error('Invalid favorite artist preference');
 return name;
}
export function artistEvidenceKey(artistName){
 const name=normalizeFavoriteArtist(artistName);
 if(!name)throw Error('Favorite artist is required for evidence lookup');
 return createHash('sha256').update(name.toLocaleLowerCase('und'),'utf8')
  .digest('hex').slice(0,32);
}
export function validatePrivateArtistEvidence(entry,{artistName,genreSlug,era}={}){
 const name=normalizeFavoriteArtist(artistName);
 if(!name||entry?.schemaVersion!==1||entry?.approved!==true
  ||entry?.artistName!==name||typeof entry?.approvedBy!=='string'
  ||entry.approvedBy.length<4||entry.approvedBy.length>100
  ||!Number.isSafeInteger(entry?.approvedAt)||entry.approvedAt<=0
  ||entry.approvedAt>Date.now())throw Error('Artist evidence not approved or mismatched');
 const evidence=validatePrivateStyleEvidence(entry.observation);
 if(evidence.genreSlug!==genreSlug||evidence.era!==era)
  throw Error('Artist evidence is for a different era/genre');
 return Object.freeze({
  cue:'Source-reviewed arrangement-level reference (not a singer imitation): '+evidence.cue,
  sourceCount:evidence.sourceCount,
  approvedAt:entry.approvedAt
 });
}
export function readPrivateArtistEvidence(dir,{artistName,genreSlug,era}={}){
 const name=normalizeFavoriteArtist(artistName||'');
 if(!name||!dir||era==='none')return null;
 if(!/^[a-z0-9-]+$/.test(genreSlug||'')
  ||!/^(19[6-9]0s|20[0-2]0s)$/.test(era||''))
  throw Error('Invalid private artist evidence lookup');
 const path=join(resolve(dir),'artist-references',
  artistEvidenceKey(name)+'__'+genreSlug+'__'+era+'.json');
 let raw;
 try{raw=readFileSync(path,'utf8');}
 catch(error){if(error?.code==='ENOENT')return null;throw error;}
 if(raw.length>18000)throw Error('Private artist reference evidence too large');
 let entry;
 try{entry=JSON.parse(raw);}catch(_){throw Error('Invalid private artist evidence JSON');}
 return validatePrivateArtistEvidence(entry,{artistName:name,genreSlug,era});
}
