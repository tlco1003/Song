import test from 'node:test';
import assert from 'node:assert/strict';
import {backupMusicToPrivateDrive,DRIVE_UPLOAD_INIT}
 from '../src/google-drive-private-music-backup.mjs';

const ID='withu_'+'e'.repeat(32);
const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(2000)]);
const env={
 WITHU_DRIVE_BACKUP_ENABLED:'true',
 WITHU_DRIVE_FOLDER_ID:'sharedDriveFolderId_123'
};
const uploadUrl='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake-id';
const params=()=>({env,orderId:ID,index:1,bytes,
 tokenProvider:async()=> 'test_oauth_token_restricted_scope'});

test('backup is disabled by default and makes no network request',async()=>{
 let calls=0;
 const result=await backupMusicToPrivateDrive({
  ...params(),env:{},fetcher:async()=>{calls++;throw Error('network unexpectedly used');}
 });
 assert.equal(result.status,'disabled');assert.equal(calls,0);
});
test('restricted Shared Drive resumable upload saves an MP3 without public sharing',async()=>{
 const calls=[];
 const result=await backupMusicToPrivateDrive({
  ...params(),
  fetcher:async(url,options)=>{
   calls.push({url,options});
   if(calls.length===1)return {
    ok:true,headers:{get:name=>name==='location'?uploadUrl:null}
   };
   return {ok:true,json:async()=>({id:'file_0123456789abcdef'})};
  }
 });
 assert.equal(result.status,'stored_private');
 assert.equal(result.fileId,'file_0123456789abcdef');
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,DRIVE_UPLOAD_INIT);
 assert.equal(calls[0].options.method,'POST');
 const metadata=JSON.parse(calls[0].options.body);
 assert.deepEqual(metadata.parents,['sharedDriveFolderId_123']);
 assert.ok(metadata.name.startsWith('withu-'+ID));
 assert.equal(metadata.permissions,undefined);
 assert.equal(calls[1].url,uploadUrl);
 assert.equal(calls[1].options.method,'PUT');
 assert.deepEqual(calls[1].options.body,bytes);
});
test('never send audio bytes to untrusted redirected upload session',async()=>{
 let put=0;
 await assert.rejects(backupMusicToPrivateDrive({
  ...params(),fetcher:async()=>{
   put++;return {ok:true,headers:{get:()=> 'https://attacker.invalid/upload/drive/v3/files'}};
  }
 }),/DRIVE_SESSION_URL_UNTRUSTED/);
 assert.equal(put,1);
});
test('Drive without private approved folder fails before OAuth',async()=>{
 let tokens=0;
 await assert.rejects(backupMusicToPrivateDrive({
  ...params(),env:{WITHU_DRIVE_BACKUP_ENABLED:'true'},
  tokenProvider:async()=>{tokens++;return 'never';}
 }),/PRIVATE_DRIVE_FOLDER_MISSING/);
 assert.equal(tokens,0);
});
test('Drive storage errors are explicit, not a fake successful backup',async()=>{
 await assert.rejects(backupMusicToPrivateDrive({
  ...params(),fetcher:async()=>({ok:false,status:403})
 }),/DRIVE_UPLOAD_INIT_REJECTED/);
});
