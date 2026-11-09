import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeFunnelEvent,PUBLIC_EVENTS} from '../src/production-analytics.mjs';
test('funnel only accepts anonymous allow-listed events',()=>{
 assert.equal(safeFunnelEvent({event:'home_view'}),'home_view');
 assert.ok(PUBLIC_EVENTS.includes('payment_attempted'));
 for(const payload of [
  {event:'purchase_verified'},{event:'home_view',email:'buyer@example.test'},
  {event:'home_view',story:'my private story'},{event:'unknown'}
 ])assert.throws(()=>safeFunnelEvent(payload));
});
