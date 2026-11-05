/* WITHU device-local artwork preview. This module never uploads customer images. */
(function(){
'use strict';
const DB='withu-device-covers-v1',STORE='covers';
let dbPromise=null;
function openDB(){
 if(!('indexedDB' in window))return Promise.reject(new Error('이 브라우저에서는 기기 내 커버 저장을 지원하지 않아요.'));
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error('커버 저장소를 열 수 없어요.'));
 });
 return dbPromise;
}
async function operate(mode,key,value){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode==='read'?'readonly':'readwrite');
  const st=tx.objectStore(STORE);
  const q=mode==='read'?st.get(key):mode==='delete'?st.delete(key):st.put(value,key);
  q.onsuccess=()=>resolve(q.result);
  q.onerror=()=>reject(q.error||new Error('커버 저장에 실패했어요.'));
 });
}
function boundedKey(id){if(typeof id!=='string'||!/^[a-z0-9-]{1,100}$/i.test(id))throw new Error('올바르지 않은 노래 식별자예요.');return id}
function validate(file){
 if(!(file instanceof Blob))throw new Error('이미지 파일을 선택해 주세요.');
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('JPG, PNG 또는 WebP 이미지만 사용할 수 있어요.');
 if(file.size>10*1024*1024||file.size<1)throw new Error('이미지 크기는 최대 10MB까지 지원해요.');
}
async function put(id,file){
 validate(file);
 const bmp=await createImageBitmap(file);
 if(bmp.width<128||bmp.height<128){bmp.close();throw new Error('이미지 크기는 가로세로 128px 이상이어야 해요.')}
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
 const ctx=canvas.getContext('2d');if(!ctx){bmp.close();throw new Error('이미지 처리 기능을 사용할 수 없어요.')}
 const scale=Math.max(1024/bmp.width,1024/bmp.height);
 const w=bmp.width*scale,h=bmp.height*scale;
 ctx.drawImage(bmp,(1024-w)/2,(1024-h)/2,w,h);bmp.close();
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지를 저장할 수 없어요.')),'image/webp',0.86));
 await operate('write',boundedKey(id),{blob,updatedAt:Date.now()});
 return blob;
}
async function get(id){const result=await operate('read',boundedKey(id));return result?.blob instanceof Blob?result.blob:null}
async function remove(id){await operate('delete',boundedKey(id))}
window.WithuCovers=Object.freeze({put,get,remove});
})();