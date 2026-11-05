/**
 * WITHU genre selection -> one or two independent music-production instructions.
 * Shared catalog powers frontend choices and server validation.
 *
 * This does not invoke Suno. It only creates immutable, validated requests
 * from a server-persisted, customer-approved draft.
 */
import {readFileSync} from 'node:fs';

const catalog=JSON.parse(readFileSync(new URL('../docs/music-genres.json',import.meta.url),'utf8'));
if(catalog.version!==1||!Array.isArray(catalog.genres)||catalog.genres.length===0
  ||catalog.genres.some(x=>typeof x.id!=='string'||!x.id||typeof x.style!=='string'||!x.style)
  ||new Set(catalog.genres.map(x=>x.id)).size!==catalog.genres.length)
  throw new Error('Invalid music genres catalog');
const presets=new Map(catalog.genres.map(x=>[x.id,x.style]));
const productCounts=Object.freeze({audio:1,audio_duo:2,audio_video:1});
const moodPresets=Object.freeze({
 '따뜻한':'Tender and comforting.',
 '감동적인':'An emotional journey with a heartfelt final chorus.',
 '설레는':'Hopeful and gently uplifting.',
 '애절한':'Wistful and expressive.',
 '희망찬':'Hopeful with a luminous ending.',
 '신나는':'Bright rhythmic energy with a memorable hook.'
});
export function publicMusicGenres(){
 return catalog.genres.map(x=>({id:x.id,style:x.style}));
}
/**
 * Exactly ONE genre may be selected for a two-song same-genre package;
 * TWO DISTINCT genres are required for a different-genre package.
 * Never interpret a missing selection as permission to choose genres at random.
 */
export function normalizeGenreSelection(productId,genreSelection){
 const songCount=productCounts[productId];
 if(!songCount)throw new Error('Unknown song product');
 const mode=genreSelection?.mode;
 const genres=genreSelection?.genres;
 if(!Array.isArray(genres)||genres.some(x=>typeof x!=='string'||!presets.has(x)))
   throw new Error('Invalid selected music genre');
 if(songCount===1){
   if(mode!=='single'||genres.length!==1)throw new Error('Single-song product requires exactly one genre');
 }else if(mode==='same'){
   if(genres.length!==1)throw new Error('Two songs in one genre require exactly one selected genre');
 }else if(mode==='different'){
   if(genres.length!==2||genres[0]===genres[1])
     throw new Error('Two distinct genres are required for two-genre package');
 }else throw new Error('Invalid two-song genre mode');
 return Object.freeze({mode,genres:Object.freeze([...genres])});
}
export function buildSongProductionPlan(order){
 const {productId,genreSelection}=order||{};
 const selected=normalizeGenreSelection(productId,genreSelection);
 const count=productCounts[productId];
 if(typeof order.songTitle!=='string'||!order.songTitle.trim()||order.songTitle.length>100)
   throw new Error('Song title missing or too long');
 if(typeof order.confirmedLyrics!=='string'||!order.confirmedLyrics.trim()
   ||order.confirmedLyrics.length>5500)
   throw new Error('Approved song lyrics required');
 if(order.mood!=null&&!Object.hasOwn(moodPresets,order.mood))
   throw new Error('Unknown song mood');
 if(order.sharedStyleNotes!=null&&(typeof order.sharedStyleNotes!=='string'
   ||order.sharedStyleNotes.length>500))throw new Error('Invalid shared music notes');
 const genres=selected.mode==='same'?[selected.genres[0],selected.genres[0]]:selected.genres;
 const title=order.songTitle.trim();
 const common=[
   moodPresets[order.mood]||'Warm, heartfelt mood.',
   'Natural Korean pronunciation, nuanced dynamics, clear words.',
   'Follow the approved lyrics and natural sentence pauses.',
   order.sharedStyleNotes?.trim()||''
 ].filter(Boolean).join(' ');
 return Object.freeze({
   version:1,
   productId,mode:selected.mode,
   songs:Object.freeze(genres.map((genre,index)=>Object.freeze({
     index:index+1,
     genre,
     title,
     lyrics:order.confirmedLyrics,
     stylePrompt:[
       presets.get(genre),
       common,
       count===2&&selected.mode==='same'&&index===1
         ?'Create an independent second musical interpretation within the same genre; vary melody and arrangement while retaining this genre.'
         :''
     ].filter(Boolean).join(' ')
   })))
 });
}
export function verifyPaidSongPlan(order){
 if(!order?.paidSongPlan||order.paidSongPlan.version!==1)
   throw new Error('Persisted paid song plan missing');
 const expected=buildSongProductionPlan(order);
 if(JSON.stringify(order.paidSongPlan)!==JSON.stringify(expected))
   throw new Error('Persisted paid song plan differs from approved order');
 return expected;
}
