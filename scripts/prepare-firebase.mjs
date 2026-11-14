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
