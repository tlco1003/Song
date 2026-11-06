/**
 * AES-256-GCM encrypted drafts on a private server volume outside the repo.
 * Not a paid order or customer delivery store. Requires deployment secrets.
 */
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from './lib.mjs';
const REPO=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const DRAFT_TTL_MS=30*60*1000;
function config({rootDir,encryptionKey}={}){
 if(typeof rootDir!=='string'||!rootDir.trim()||
   typeof encryptionKey!=='string'||!/^[a-f0-9]{64}$/i.test(encryptionKey))
  throw new AppError(503,'비공개 저장소와 32바이트 암호화 키를 설정해 주세요.');
 const dir=resolve(rootDir);
 if(dir===REPO||dir.startsWith(REPO+sep))
  throw new AppError(503,'주문서는 공개 GitHub 저장소 밖에 보관해야 합니다.');
 return {dir,key:Buffer.from(encryptionKey,'hex')};
}
function pathFor(dir,id){
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))
  throw new AppError(400,'올바르지 않은 주문 초안 ID입니다.');
 return join(dir,id+'.json');
}
export async function storePrivateOrderDraft(data,opts){
 if(data?.status!=='awaiting_verified_payment'||data.verifiedPaid!==false)
  throw new AppError(400,'검증된 비결제 주문 초안만 저장합니다.');
 const {dir,key}=config(opts);
 await mkdir(dir,{recursive:true,mode:0o700});
 const id=randomUUID(),createdAt=Date.now(),expiresAt=createdAt+DRAFT_TTL_MS;
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([
  cipher.update(Buffer.from(JSON.stringify({createdAt,expiresAt,data}))),cipher.final()
 ]);
 const envelope={version:1,iv:iv.toString('base64'),
  tag:cipher.getAuthTag().toString('base64'),body:encrypted.toString('base64')};
 await writeFile(pathFor(dir,id),JSON.stringify(envelope),{flag:'wx',mode:0o600});
 return Object.freeze({id,expiresAt});
}
export async function readPrivateOrderDraft(id,opts){
 const {dir,key}=config(opts);
 let raw;
 try{raw=await readFile(pathFor(dir,id),'utf8');}
 catch(e){if(e?.code==='ENOENT')throw new AppError(404,'주문 초안이 없습니다.');throw e;}
 try{
  const blob=JSON.parse(raw);
  if(blob.version!==1)throw Error('Wrong format');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(blob.iv,'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag,'base64'));
  const contents=Buffer.concat([decipher.update(Buffer.from(blob.body,'base64')),decipher.final()]);
  const record=JSON.parse(contents.toString('utf8'));
  if(Date.now()>record.expiresAt){
   await unlink(pathFor(dir,id)).catch(()=>{});
   throw new AppError(410,'주문 초안이 만료됐습니다.');
  }
  return record.data;
 }catch(e){
  if(e instanceof AppError)throw e;
  throw new AppError(503,'주문 초안 암호화 무결성 검증 실패');
 }
}
