/**
 * Copy server-only modules and the pinned SSOT catalogs into Firebase's
 * deployable Cloud Functions source directory. No public audio assets.
 */
import {mkdir,copyFile,rm,readdir} from 'node:fs/promises';
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
console.log('Prepared Firebase server-only modules, price SSOT, private lyric policy.');
