import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {enabledFunctionSecrets} from '../src/firebase-secret-config.mjs';
const base={schemaVersion:1,lyricsProvider:'mureka',musicProvider:'mureka',artistResearch:false,driveBackup:false,resendWebhook:false};
test('Mureka-only deployment does not require unrelated unregistered providers',()=>{
 const s=enabledFunctionSecrets(base);
 for(const name of ['MUREKA_API_KEY','RESEND_API_KEY','WITHU_LINK_ENCRYPTION_KEY'])
  assert.ok(s.worker.includes(name),name);
 for(const name of ['OPENAI_API_KEY','GEMINI_API_KEY','WITHU_DRIVE_SERVICE_ACCOUNT_JSON'])
  assert.ok(!s.worker.includes(name),name);
 assert.ok(!s.api.includes('RESEND_WEBHOOK_SIGNING_SECRET'));
});
test('future connected providers attach exactly their original optional credentials',()=>{
 assert.ok(enabledFunctionSecrets({...base,lyricsProvider:'openai'}).worker.includes('OPENAI_API_KEY'));
 assert.ok(enabledFunctionSecrets({...base,lyricsProvider:'gemini'}).worker.includes('GEMINI_API_KEY'));
 assert.ok(enabledFunctionSecrets({...base,artistResearch:true}).worker.includes('GEMINI_API_KEY'));
 assert.ok(enabledFunctionSecrets({...base,musicProvider:'google_lyria'}).worker.includes('GEMINI_API_KEY'));
 assert.ok(enabledFunctionSecrets({...base,driveBackup:true}).worker.includes('WITHU_DRIVE_SERVICE_ACCOUNT_JSON'));
 assert.ok(enabledFunctionSecrets({...base,resendWebhook:true}).api.includes('RESEND_WEBHOOK_SIGNING_SECRET'));
});
test('invalid deployment provider profile fails closed, never silently activates a different provider',()=>{
 for(const profile of [{},null,{...base,lyricsProvider:'unknown'},
  {...base,musicProvider:'unknown'},{...base,artistResearch:'yes'}])
  assert.throws(()=>enabledFunctionSecrets(profile),/Invalid nonsecret|Cannot read/);
});
test('deployment profile generator does not write any server or cloud secret into the profile',()=>{
 const s=readFileSync(new URL('../scripts/prepare-firebase.mjs',import.meta.url),'utf8');
 assert.ok(s.includes("functions/deployment-profile.json"));
 assert.ok(s.includes('const profile={'));
 assert.ok(s.includes('schemaVersion:1,lyricsProvider,musicProvider'));
 assert.ok(!s.includes("profile.secretKey"));
 assert.ok(readFileSync(new URL('../.gitignore',import.meta.url),'utf8').includes('functions/deployment-profile.json'));
});
