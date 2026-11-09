/**
 * WITHU server-side genre / era / mood / instrumentation composer.
 *
 * Public browser receives ONLY choice IDs. Music recipe text is NOT sent to
 * public webpages, draft JSON, payment summaries, or customer emails.
 *
 * To protect proprietary orchestrations, deploy private Markdown recipes
 * outside GitHub Pages / the public git checkout. Set WITHU_PRIVATE_STYLE_DIR
 * to a protected server directory. The generic fallback below is non-secret.
 */
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {AppError} from './lib.mjs';
import {readPrivateStyleEvidence} from './private-style-evidence.mjs';

export const GENRE_KEYS=Object.freeze(['발라드','어쿠스틱','재즈','트로트','R&B','K-POP','인디팝']);
export const ERA_KEYS=Object.freeze(['auto','none','1960s','1970s','1980s','1990s','2000s','2010s','2020s']);
const GENERIC_GENRES=Object.freeze({
 '발라드':'Korean narrative ballad; expressive lead vocal; piano foundation; strings introduced with gradual dramatic development.',
 '어쿠스틱':'Intimate acoustic-oriented arrangement; organic plucked strings and warm unforced lead vocal.',
 '재즈':'Vocal jazz; subtle piano harmony, acoustic bass, restrained drums, room for expressive phrasing.',
 '트로트':'Korean trot language and rhythm; clear lyric enunciation, phrasing with tasteful ornament, responsive rhythmic backing.',
 'R&B':'Expressive R&B; syncopated pocket, warm keyboard harmony, bass movement, soulful vocal articulation.',
 'K-POP':'Korean melodic pop; clear hooks, modern layering, differentiated sections and controlled dynamic contrast.',
 '인디팝':'Small-scale indie pop; organic guitar and keys, intimate verse and textured chorus.'
});
const GENERIC_ERAS=Object.freeze({
 '1960s':'Historic Korean popular-song era context; use restrained analog ensemble textures when compatible with the chosen genre.',
 '1970s':'Historic Korean folk and band music context; organic instrumentation and melodic narrative when compatible with the chosen genre.',
 '1980s':'Historic Korean ballad and band music context; piano-led and acoustic/electric band interplay only when genre appropriate.',
 '1990s':'Historic Korean pop, dance and ballad context; expressive melody and distinctive section contrast where appropriate.',
 '2000s':'Historic Korean mainstream pop and R&B context; polished recording aesthetics with singable melodic lines where appropriate.',
 '2010s':'Melodic pop and modern electronic arrangement options; dynamic contrast and clear refrain where appropriate.',
 '2020s':'Contemporary production vocabulary; natural lead vocal prominence and modern section dynamics when genre appropriate.'
});
const MOODS=Object.freeze({
 '따뜻한':'Comforting, close and warm.',
 '감동적인':'Narrative emotion growing naturally into a moving climax.',
 '설레는':'Luminous and expectant.',
 '애절한':'Wistful and emotionally restrained, with meaningful pauses.',
 '희망찬':'Slowly opening into hopeful resolution.',
 '신나는':'Buoyant and lively rhythm without hiding Korean lyric clarity.'
});
const AGE_ERAS=Object.freeze({
 under20:'2020s','20s':'2010s','30s':'2000s','40s':'1990s',
 '50s':'1980s','60s':'1970s','70plus':'1960s',unknown:'none'
});
const SAFE_SLUGS=Object.freeze({
 '발라드':'ballad','어쿠스틱':'acoustic','재즈':'jazz',
 '트로트':'trot','R&B':'rnb','K-POP':'kpop','인디팝':'indiepop'
});
function privateRecipe(type,key,dir){
 if(!dir)return null;
 const moodSlugs={'따뜻한':'warm','감동적인':'moving','설레는':'hopeful-excited','애절한':'wistful','희망찬':'uplifting','신나는':'energetic'};
 const name=type==='genre'?SAFE_SLUGS[key]:type==='mood'?moodSlugs[key]:key;
 if(!name||!/^[a-z0-9-]+$/.test(name))throw new AppError(500,'Invalid private music recipe key');
 const root=resolve(dir);
 const file=join(root,type,name+'.md');
 // An explicitly configured private collection is mandatory: missing files
 // never silently fall back to an unintended public genre recipe.
 let content;
 try{content=readFileSync(file,'utf8').trim();}
 catch(_){throw new AppError(503,'Private style recipe is not configured: '+type);}
 if(content.length<20||content.length>8000)throw new AppError(503,'Private style recipe has invalid length');
 return content;
}
export function resolveEraChoice({eraPreference='auto',recipientAgeGroup='unknown'}={}){
 if(!ERA_KEYS.includes(eraPreference))throw new AppError(400,'Unsupported era choice');
 if(eraPreference!=='auto')return eraPreference;
 return AGE_ERAS[recipientAgeGroup]||'none';
}
export function composeServerMusicStyle({
 genre,mood='따뜻한',eraPreference='auto',recipientAgeGroup='unknown',
 speechStyle='auto',songIndex=1,mode='single',blendGenre=null,
 thirdVerse=false,dedicationOutro=false
}={}, {privateDirectory=process.env.WITHU_PRIVATE_STYLE_DIR||null}={}){
 if(!GENRE_KEYS.includes(genre)||!Object.hasOwn(MOODS,mood)
  ||(blendGenre!==null&&(!GENRE_KEYS.includes(blendGenre)||blendGenre===genre)))
  throw new AppError(400,'Invalid genre or mood');
 if(!Number.isSafeInteger(songIndex)||songIndex<1||songIndex>2)
  throw new AppError(400,'Invalid song index');
 const era=resolveEraChoice({eraPreference,recipientAgeGroup});
 const genreText=privateRecipe('genre',genre,privateDirectory)||GENERIC_GENRES[genre];
 const blendText=blendGenre?(privateRecipe('genre',blendGenre,privateDirectory)||GENERIC_GENRES[blendGenre]):'';
 const eraText=era==='none'?'':privateRecipe('era',era,privateDirectory)||GENERIC_ERAS[era];
 const moodText=privateRecipe('mood',mood,privateDirectory)||MOODS[mood];
 // Evidence is optional until an operator has supplied sourced private records.
 // Missing records never invent music statistics or replace customer choice.
 const evidenced=era==='none'?null:readPrivateStyleEvidence(privateDirectory,{
  genreSlug:SAFE_SLUGS[genre],era
 });
 const phrasing=Object.freeze({
  auto:'Natural Korean syllable stress and spoken rhythm.',
  casual:'Respect informal Korean lyric sentence endings.',
  polite:'Respect polite Korean sentence endings.',
  mixed:'Respect the mixed speech style in the approved lyric.'
 })[speechStyle]||'Natural Korean syllable stress and spoken rhythm.';
 if(typeof thirdVerse!=='boolean'||typeof dedicationOutro!=='boolean')
  throw new AppError(400,'Invalid customer-selected emotional arc');
 const emotionalArc=thirdVerse&&dedicationOutro?
  'Arc: intimate Verse 1, rising Verse 2, pivotal Verse 3, expressive Final Chorus peak. Reduce the arrangement afterwards; leave a spacious Outro for the exact final phrase. Keep dynamics genre-true.':
  thirdVerse?
  'Arc: intimate Verse 1, rising Verse 2, pivotal Verse 3, emotional Final Chorus peak. Vary vocal intensity, instrument density and rests to suit the chosen genre, not loudness alone.':
  dedicationOutro?
  'After the main emotional peak, thin the instrumentation and leave a quiet, spacious Outro for the exact customer-supplied final phrase; allow the ending to breathe.':
  'Use original, lyrics-led melodic contour, intentional pauses, and a coherent opening/build/climax/resolution.';
 const second=['same','blend'].includes(mode)&&songIndex===2?
  'Create an independently composed melody and arrangement for track two, never a duplicate of track one.':'';
 const parts={
  opening:'Begin with a dramatic, emotionally engaging, clear Korean vocal opening. Original song only: never copy known melodies, voices or recordings.',
  genre:'Chosen genre: '+genre+'. '+genreText,
  blend:blendGenre?'Blend in '+blendGenre+' while retaining the primary identity: '+blendText:'',
  era:eraText?'Era '+era+' (inspired, not copied): '+eraText:'',
  evidence:evidenced?evidenced.cue:'',
  mood:moodText,
  phrasing,arc:emotionalArc,
  preserve:'Preserve the selected genre and customer story over era assumptions.',
  second
 };
 // Keep all genre/era/mood materials, including any private recipes. If paid
 // arc options make the full scaffold exceed Suno's 1000-char Style limit,
 // compact ONLY generic scaffolding. Never silently drop a purchased arc.
 const assemble=p=>[
  p.opening,p.genre,p.blend,p.era,p.evidence,p.mood,p.phrasing,
  p.arc,p.preserve,p.second
 ].filter(Boolean).join('\n');
 let stylePreset=assemble(parts);
 if(stylePreset.length>1000){
  const compactArc=thirdVerse&&dedicationOutro?
   'Verse 1 intimate; Verse 2 rising; Verse 3 pivotal; Final Chorus peak. Finish with a quiet, spacious Outro for the exact last phrase.':
   thirdVerse?
   'Verse 1 intimate; Verse 2 rising; Verse 3 pivotal; Final Chorus peak with genre-true dynamics.':
   dedicationOutro?
   'After climax, leave a quiet, spacious Outro for the exact customer final phrase.':
   'Original melody; lyric-led build, contrast, rests and resolution.';
  stylePreset=assemble({
   ...parts,
   opening:'Dramatic, clear Korean vocal entrance. Original song; never copy melodies, voices or recordings.',
   phrasing:'Use the approved Korean speech style.',
   arc:compactArc,
   preserve:'Keep selected genre and real customer story.',
   second:second?'Track 2: distinct melody and arrangement.':''
  });
 }
 if(stylePreset.length>1000){
  // Even the compact generic scaffold may not fit an excessively long
  // operator-supplied private MD preset. Fail closed rather than truncating
  // genre identity, the user's selected emotional arc, or rights instructions.
  throw new AppError(503,'Music style preset must be within 1000 characters');
 }
 return stylePreset;
}
