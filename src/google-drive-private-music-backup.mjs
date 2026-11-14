/**
 * Optional server-only backup to a restricted Google Workspace Shared Drive.
 * No public permission or share-link creation. Firebase Storage is the source
 * of truth and existing customer delivery continues via authorized GCS URLs.
 * Google Drive resumable upload: https://developers.google.com/workspace/drive/api/guides/manage-uploads
 */
export const DRIVE_UPLOAD_INIT='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,parents&supportsAllDrives=true';

export class DriveBackupError extends Error {
 constructor(code){super(code);this.name='DriveBackupError';this.code=code;}
}
const VALID_ID=/^[A-Za-z0-9_-]{8,150}$/;
export function driveBackupEnabled(env={}){
 return env.WITHU_DRIVE_BACKUP_ENABLED==='true';
}
async function driveAccessToken(env,tokenProvider){
 if(typeof tokenProvider==='function'){
  const value=await tokenProvider();
  if(typeof value!=='string'||value.length<12)throw new DriveBackupError('INVALID_OAUTH_TOKEN');
  return value;
 }
 let credentials;
 try{credentials=JSON.parse(env.WITHU_DRIVE_SERVICE_ACCOUNT_JSON||'');}
 catch(_){throw new DriveBackupError('DRIVE_CREDENTIALS_NOT_CONFIGURED');}
 if(credentials?.type!=='service_account'
  ||typeof credentials.client_email!=='string'
  ||typeof credentials.private_key!=='string')
  throw new DriveBackupError('INVALID_SERVICE_ACCOUNT');
 const {GoogleAuth}=await import('google-auth-library');
 const auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/drive.file']});
 const client=await auth.getClient();
 const access=await client.getAccessToken();
 const token=typeof access==='string'?access:access?.token;
 if(typeof token!=='string'||!token)throw new DriveBackupError('OAUTH_TOKEN_UNAVAILABLE');
 return token;
}
export async function backupMusicToPrivateDrive({
 env={},bytes,orderId,index,fetcher=globalThis.fetch,tokenProvider
}={}){
 if(!driveBackupEnabled(env))return Object.freeze({status:'disabled'});
 if(!VALID_ID.test(env.WITHU_DRIVE_FOLDER_ID||''))
  throw new DriveBackupError('PRIVATE_DRIVE_FOLDER_MISSING');
 if(typeof orderId!=='string'||!/^withu_[a-f0-9]{32}$/.test(orderId)
  ||!Number.isSafeInteger(index)||index<1||index>2
  ||!Buffer.isBuffer(bytes)||bytes.length<1024||bytes.length>25*1024*1024)
  throw new DriveBackupError('INVALID_MUSIC_ASSET');
 const token=await driveAccessToken(env,tokenProvider);
 const filename='withu-'+orderId+'-'+index+'.mp3';
 const headers={
  Authorization:'Bearer '+token,
  'Content-Type':'application/json; charset=UTF-8',
  'X-Upload-Content-Type':'audio/mpeg',
  'X-Upload-Content-Length':String(bytes.length)
 };
 let init;
 try{
  init=await fetcher(DRIVE_UPLOAD_INIT,{
   method:'POST',headers,
   body:JSON.stringify({name:filename,mimeType:'audio/mpeg',
    parents:[env.WITHU_DRIVE_FOLDER_ID]}),
   signal:AbortSignal.timeout(30000)
  });
 }catch(_){throw new DriveBackupError('DRIVE_UPLOAD_INIT_UNKNOWN');}
 if(!init?.ok)throw new DriveBackupError('DRIVE_UPLOAD_INIT_REJECTED');
 const location=init.headers?.get?.('location');
 let target;
 try{target=new URL(location);}catch(_){throw new DriveBackupError('DRIVE_SESSION_URL_MISSING');}
 if(target.protocol!=='https:'||target.hostname!=='www.googleapis.com'
  ||!target.pathname.startsWith('/upload/drive/v3/files'))
  throw new DriveBackupError('DRIVE_SESSION_URL_UNTRUSTED');
 let uploaded;
 try{
  uploaded=await fetcher(target.href,{
   method:'PUT',
   headers:{Authorization:'Bearer '+token,'Content-Type':'audio/mpeg',
    'Content-Length':String(bytes.length)},
   body:bytes,
   signal:AbortSignal.timeout(120000)
  });
 }catch(_){throw new DriveBackupError('DRIVE_UPLOAD_OUTCOME_UNKNOWN');}
 if(!uploaded?.ok)throw new DriveBackupError('DRIVE_UPLOAD_REJECTED');
 let info;
 try{info=await uploaded.json();}
 catch(_){throw new DriveBackupError('DRIVE_METADATA_MISSING');}
 if(!VALID_ID.test(info?.id||''))
  throw new DriveBackupError('DRIVE_FILE_ID_MISSING');
 return Object.freeze({status:'stored_private',fileId:info.id});
}
