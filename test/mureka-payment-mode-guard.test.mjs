import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredMurekaAutoMode} from '../src/mureka-paid-automation.mjs';
test('a test Toss approval cannot spend real Mureka credits unless operator explicitly opts in',()=>{
 assert.equal(configuredMurekaAutoMode({
  WITHU_AUTOMATED_MUSIC_PROVIDER:'mureka',WITHU_PAYMENT_MODE:'test'
 }),false);
 assert.equal(configuredMurekaAutoMode({
  WITHU_AUTOMATED_MUSIC_PROVIDER:'mureka',WITHU_PAYMENT_MODE:'test',
  WITHU_TEST_MUREKA_SPEND_APPROVED:'false'
 }),false);
 assert.equal(configuredMurekaAutoMode({
  WITHU_AUTOMATED_MUSIC_PROVIDER:'mureka',WITHU_PAYMENT_MODE:'test',
  WITHU_TEST_MUREKA_SPEND_APPROVED:'true'
 }),true);
 assert.equal(configuredMurekaAutoMode({
  WITHU_AUTOMATED_MUSIC_PROVIDER:'mureka',WITHU_PAYMENT_MODE:'live'
 }),true);
 assert.equal(configuredMurekaAutoMode({
  WITHU_AUTOMATED_MUSIC_PROVIDER:'off',WITHU_PAYMENT_MODE:'live',
  WITHU_TEST_MUREKA_SPEND_APPROVED:'true'
 }),false);
});
