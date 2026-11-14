/**
 * Copy server-only modules and the pinned SSOT catalogs into Firebase's
 * deployable Cloud Functions source directory. No public audio assets.
 */
import {mkdir,copyFile,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=new URL('../',import.meta.url);
const from=new URL('../src/',import.meta.url);
const to=new URL('../functions/src/',import.meta.url);
await rm(to,{recursive:true,force:true});
await mkdir(to,{recursive:true});
for(const ent of await readdir(from,{withFileTypes:true})){
 if(!ent.isFile()||!ent.name.endsWith('.mjs'))continue;
 await copyFile(new URL(ent.name,from),new URL(ent.name,to));
}
await mkdir(new URL('../functions/docs/',import.meta.url),{recursive:true});
for(const name of ['prices.json','music-genres.json']){
 await copyFile(new URL('../docs/'+name,import.meta.url),
  new URL('../functions/docs/'+name,import.meta.url));
}
await copyFile(new URL('../가사 프롬프트.md',import.meta.url),
 new URL('../functions/가사 프롬프트.md',import.meta.url));
// Publish only the TEST CLIENT key to Firebase Hosting for a real official
// Toss widget UI preview. Never publish a secret or enable payment from this.
// Real payment still requires the separately deployed /api/runtime and /api/orders.
const configPath=new URL('../docs/payment-widget-public.json',import.meta.url);
const envPath=new URL('../functions/.env',import.meta.url);
const localEnv=await readFile(envPath,'utf8').catch(()=>'');
const setting=name=>{
 const line=localEnv.split(String.fromCharCode(10)).find(row=>row.startsWith(name+'='));
 return line?line.slice(name.length+1).trim():'';
};
// Pack validated deployment-time provider flags. These are NOT credentials.
// The Firebase Functions analyzer runs before its runtime .env is guaranteed
// to be loaded, so build the private worker's Secret list from this file.
const lyricsProvider=setting('WITHU_LYRICS_PROVIDER')||'openai';
const musicProvider=setting('WITHU_AUTOMATED_MUSIC_PROVIDER')||'';
if(!['openai','gemini','mureka'].includes(lyricsProvider)
 ||!['','mureka','google_lyria'].includes(musicProvider))
 throw new Error('Unknown deployment music/lyrics provider');
const profile={
 schemaVersion:1,lyricsProvider,musicProvider,
 artistResearch:setting('WITHU_ARTIST_RESEARCH_ENABLED')==='true',
 driveBackup:setting('WITHU_DRIVE_BACKUP_ENABLED')==='true',
 resendWebhook:setting('WITHU_RESEND_WEBHOOK_ENABLED')==='true'
};
await writeFile(new URL('../functions/deployment-profile.json',import.meta.url),
 JSON.stringify(profile,null,2)+String.fromCharCode(10));
console.log('Prepared nonsecret provider-scoped Firebase function deployment profile.');
const publicClientKey=setting('TOSS_CLIENT_KEY');
const safePreview=setting('WITHU_PAYMENT_MODE')==='test'
 &&setting('WITHU_LIVE_PAYMENTS_ENABLED')==='false'
 &&/^test_gck_[A-Za-z0-9_-]{8,}$/.test(publicClientKey);
if(safePreview){
 await writeFile(configPath,JSON.stringify({schemaVersion:1,mode:'test',
  previewOnly:true,tossClientKey:publicClientKey})+String.fromCharCode(10));
 console.log('Prepared safe public TEST widget preview (payment remains server-gated).');
}else{
 await rm(configPath,{force:true});
 console.log('Public TEST widget preview unavailable (no valid local test client key).');
}
console.log('Prepared Firebase server-only modules, price SSOT, private lyric policy.');
