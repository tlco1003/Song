/**
 * Explicitly launched local-only end-to-end checkout QA.
 *
 * Run:
 *   WITHU_STAGING_ENABLED=true \
 *   WITHU_STAGING_ADMIN_KEY="$(openssl rand -hex 32)" \
 *   WITHU_PRIVATE_MUSIC_DIR="/tmp/withu-private-audio" \
 *   HOST=127.0.0.1 PORT=3000 npm run staging
 *
 * The admin key is NOT printed, placed in links, or committed.
 * No genuine PG approval, customer message or actual purchase occurs here.
 */
import {createApp} from './server.mjs';
import {createLocalStagingGateway} from './local-staging-gateway.mjs';

if(process.env.NODE_ENV==='production'||process.env.WITHU_STAGING_ENABLED!=='true')
 throw new Error('Local staging must be explicitly enabled outside production');
const host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host))
 throw new Error('Local staging cannot listen on a public network interface');
const port=Number(process.env.PORT||3000);
if(!Number.isSafeInteger(port)||port<1024||port>65535)
 throw new Error('Choose a local TCP port between 1024 and 65535');
if(!process.env.WITHU_PRIVATE_MUSIC_DIR)
 throw new Error('Set WITHU_PRIVATE_MUSIC_DIR outside the GitHub repository');
const stage=createLocalStagingGateway({
 privateMusicDir:process.env.WITHU_PRIVATE_MUSIC_DIR,
 adminKey:process.env.WITHU_STAGING_ADMIN_KEY
});
const app=createApp({customerAccess:stage,staging:stage});
app.listen(port,host,()=>{
 console.log('WITHU LOCAL TEST ONLY (no real payment/email): http://'+host+':'+port+'/_staging');
});
