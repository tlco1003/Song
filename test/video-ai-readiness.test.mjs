import assert from 'node:assert/strict';
import test from 'node:test';
import {songVisionReadiness,assertSongVisionPaidJobReady} from '../src/video-ai/readiness.mjs';

test('self-hosted video model status is explicit and noncommercial',()=>{
 const state=songVisionReadiness();
 assert.equal(state.externalVideoApiRequired,false);
 assert.equal(state.researchCliAvailable,true);
 assert.equal(state.synchronizedVideoVocalTrainingPipeline,true);
 assert.equal(state.faceSurfaceGeometryResearchCliAvailable,true);
 assert.equal(state.koreanVisemeManualTimelineAvailable,true);
 assert.equal(state.operatorAlignmentRequired,true);
 assert.equal(state.acousticForcedAlignmentImplemented,false);
 assert.equal(state.realSingerVisemeQualityValidated,false);
 assert.equal(state.phonemeAccurateLipsyncVerified,false);
 assert.equal(state.actualBoneStructureEstimation,false);
 assert.equal(state.clipDisjointValidationImplemented,true);
 assert.equal(state.realSingerTrainingDataProvided,false);
 assert.equal(state.canAcceptCustomerJobs,false);
 assert.equal(state.customerFaceSwapModelReady,false);
 assert.equal(state.commercialReadiness,'blocked');
 assert.throws(()=>assertSongVisionPaidJobReady(),/no paid customer video jobs/i);
});
