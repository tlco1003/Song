import test from 'node:test';
import assert from 'node:assert/strict';
import {auditBusinessOps,validateCapabilityRecord} from '../scripts/business-ops-audit.mjs';

test('baseline source-backed business audit passes',async()=>{
  const r=await auditBusinessOps();
  assert.equal(r.ok,true,JSON.stringify(r.checks.filter(c=>!c.ok)));
  assert.equal(r.failed,0);
  assert.ok(r.passed>=15);
});

test('external plugin assistance cannot be classified as live customer automation',()=>{
  assert.equal(validateCapabilityRecord({
    id:'video_external',status:'assisted_external',
    evidence:{kind:'review_note',ref:'interactive ChatGPT tool only'},
    customerFacingAutomationReady:true
  }),false);
});

test('repository proof needs a real repository path',()=>{
  assert.equal(validateCapabilityRecord({
    id:'fake_ready',status:'verified_repository',
    evidence:{kind:'review_note',ref:'an untested claim'},
    customerFacingAutomationReady:false
  }),false);
});

test('unknown capability cannot silently claim customer production readiness',()=>{
  assert.equal(validateCapabilityRecord({
    id:'unknown_api',status:'unknown',
    evidence:{kind:'review_note',ref:'no approval'},
    customerFacingAutomationReady:true
  }),false);
});

test('reviewed repository source may be recorded without claiming commercial readiness',()=>{
  assert.equal(validateCapabilityRecord({
    id:'checkout_ui',status:'verified_repository',
    evidence:{kind:'repo_path',ref:'docs/checkout.html'},
    customerFacingAutomationReady:false
  }),true);
});

test('existing checkout source alone cannot mark public commerce as automation-ready',()=>{
  assert.equal(validateCapabilityRecord({
    id:'checkout_ui',status:'verified_repository',
    evidence:{kind:'repo_path',ref:'docs/checkout.html'},
    customerFacingAutomationReady:true
  }),false);
});
