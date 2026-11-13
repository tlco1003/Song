/**
 * WITHU Business OS read-only audit.
 * No remote calls, provider generation, payment, customer-data reads or mutations.
 * Run: node scripts/business-ops-audit.mjs [--json]
 */
import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ALLOWED=new Set(['verified_repository','assisted_external','designed_only','blocked','unknown']);
const REQUIRED=new Set(['landing_ui','checkout_ui','price_catalog','payment_contract','public_checkout',
  'higgsfield_chatgpt_plugin','reel_effects_sandbox','commercial_ad_offer']);

function withinRoot(root,relative){
  if(typeof relative!=='string'||!relative.trim()||path.isAbsolute(relative))return null;
  const target=path.resolve(root,relative);
  return target.startsWith(root+path.sep)?target:null;
}

export function validateCapabilityRecord(record){
  if(!record||typeof record!=='object'||typeof record.id!=='string'
      ||!/^[a-z][a-z0-9_]*$/.test(record.id)||!ALLOWED.has(record.status))return false;
  if(typeof record.customerFacingAutomationReady!=='boolean'
     ||typeof record.evidence?.kind!=='string'||typeof record.evidence?.ref!=='string'
     ||!record.evidence.ref.trim())return false;
  if(record.status==='verified_repository'&&record.evidence.kind!=='repo_path')return false;
  if(record.status==='assisted_external'&&record.evidence.kind!=='review_note')return false;
  if(record.customerFacingAutomationReady===true
     &&record.status!=='verified_repository')return false;
  return true;
}

export async function auditBusinessOps(root=ROOT){
  const checks=[];
  const check=(id,ok,detail)=>checks.push({id,ok:ok===true,detail});
  const files=['AGENTS.md','CLAUDE.md','docs/business/OPERATING_PLAN.md',
    'docs/business/VIDEO_AGENT_CONTRACT.md','docs/business/PROGRESS.md',
    'docs/business/capabilities.json','docs/prices.json','src/commerce.mjs',
    'src/production-contract.mjs','src/paid-order-pipeline.mjs'];
  for(const rel of files){
    try{await access(path.join(root,rel));check('file:'+rel,true,'file exists');}
    catch(e){check('file:'+rel,false,'file missing: '+e.code);}
  }
  let snapshot;
  try{
    snapshot=JSON.parse(await readFile(path.join(root,'docs/business/capabilities.json'),'utf8'));
    check('capabilities:format',snapshot.schemaVersion===1&&snapshot.project==='WITHU'
      &&snapshot.repositoryVisibility==='public'
      &&typeof snapshot.reviewedOn==='string'
      &&/^\d{4}-\d{2}-\d{2}$/.test(snapshot.reviewedOn)
      &&Array.isArray(snapshot.capabilities),'version, scope, reviewed date and list');
  }catch(e){check('capabilities:format',false,String(e.message));}
  if(snapshot&&Array.isArray(snapshot.capabilities)){
    const seen=new Set();
    for(const item of snapshot.capabilities){
      const valid=validateCapabilityRecord(item);
      check('capability:'+String(item?.id),valid&&!seen.has(item.id),
        valid?'valid structure and nonduplicate id':'invalid status/proof/readiness');
      if(!valid)continue;
      seen.add(item.id);
      if(item.evidence.kind==='repo_path'){
        const target=withinRoot(root,item.evidence.ref);
        let exists=false;
        if(target)try{await access(target);exists=true;}catch(_){}
        check('evidence:'+item.id,exists,'repository evidence file exists and stays inside root');
      }
    }
    for(const id of REQUIRED)check('required:'+id,seen.has(id),'required audited capability');
  }
  try{
    const catalog=JSON.parse(await readFile(path.join(root,'docs/prices.json'),'utf8'));
    const ids=new Set(catalog.products?.map(p=>p.id));
    check('prices:ssot',catalog.version===1&&catalog.currency==='KRW'
      &&catalog.pricingStatus==='display_only_until_commercial_readiness'
      &&['audio','audio_duo','audio_video'].every(id=>ids.has(id))
      &&catalog.products.every(p=>Number.isSafeInteger(p.amountKrw)&&p.amountKrw>0),
      'original WITHU product catalog exists; no ad pilot price is mixed in');
  }catch(e){check('prices:ssot',false,String(e.message));}
  try{
    const {publicCommerceReadiness,publicPriceCatalog}=await import(
      pathToFileURL(path.join(root,'src/commerce.mjs')).href);
    const ready=publicCommerceReadiness();
    const catalog=publicPriceCatalog();
    check('commerce:fail_closed',ready.canCharge===false&&ready.status==='integration_pending'
      &&ready.licenseVerified===false&&ready.paymentVerified===false
      &&ready.musicVerified===false&&ready.emailVerified===false,
      'no unverified public payments or licensed fulfillment');
    check('commerce:catalog',Array.isArray(catalog.products)&&catalog.products.length===3,
      'existing exported catalog is readable');
  }catch(e){check('commerce:modules',false,String(e.message));}
  return {ok:checks.every(c=>c.ok),reviewedOn:snapshot?.reviewedOn||null,
    checkedAt:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,
    failed:checks.filter(c=>!c.ok).length,checks};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditBusinessOps();
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    console.log('WITHU business contract audit: '+(report.ok?'PASS':'FAIL')+
      ' ('+report.passed+' passed, '+report.failed+' failed)');
    for(const check of report.checks)
      console.log((check.ok?'PASS':'FAIL')+' '+check.id+' :: '+check.detail);
    console.log('This audit does NOT verify live payments, external APIs, sales or model training.');
  }
  process.exitCode=report.ok?0:1;
}