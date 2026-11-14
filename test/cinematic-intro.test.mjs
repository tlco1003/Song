import test from 'node:test';
import assert from 'node:assert/strict';
import {INTRO_DURATION, clamp, smoothstep, journeyAt} from '../docs/cinematic/timeline.mjs';
test('timeline bounds and endpoint state', () => {
  assert.equal(journeyAt(-50).time, 0);
  assert.equal(journeyAt(1e6).time, INTRO_DURATION);
  assert.equal(journeyAt(INTRO_DURATION).stage, 3);
  assert.equal(journeyAt(0).stage, 0);
  assert.ok(journeyAt(INTRO_DURATION).bookOpen > 0.99);
});
test('train gives way to traveling orb and clouds then open page', () => {
  assert.ok(journeyAt(1).train > journeyAt(6).train);
  assert.ok(journeyAt(6.8).clouds > journeyAt(2).clouds);
  assert.ok(journeyAt(12).bookOpen > journeyAt(7).bookOpen);
  assert.ok(journeyAt(13).landing > journeyAt(7).landing);
  assert.ok(journeyAt(13.5).ripple >= 0);
});
test('coordinates and transitions are finite throughout all 16 seconds', () => {
  for(let t=0;t<=INTRO_DURATION;t+=0.05){
    const s=journeyAt(t);
    for (const key of ['train','gather','clouds','page','bookOpen','landing','orbFlight','orbScale','ripple','cameraZ']){
      assert.ok(Number.isFinite(s[key]),key+' finite at '+t);
    }
    assert.equal(s.orb.length,3);
    assert.ok(s.orb.every(Number.isFinite));
    assert.ok(s.bookOpen>=0 && s.bookOpen<=1);
    assert.ok(s.landing>=0 && s.landing<=1);
  }
});
test('math primitives clamp out of range', () => {
  assert.equal(clamp(-1),0);
  assert.equal(clamp(2),1);
  assert.equal(smoothstep(2,3,1),0);
  assert.equal(smoothstep(2,3,4),1);
});
