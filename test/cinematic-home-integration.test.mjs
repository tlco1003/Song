import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const homepage=readFileSync(new URL('../docs/index.html', import.meta.url),'utf8');
const entry=readFileSync(new URL('../docs/cinematic/intro.js', import.meta.url),'utf8');
const css=readFileSync(new URL('../docs/cinematic/intro.css', import.meta.url),'utf8');

test('new cinematic section is additive to the original music homepage',()=>{
 for(const marker of [
  'id="cinematic-intro"','id="cinematic-canvas"',
  'cinematic/intro.js','cinematic/intro.css',
  'id="track-list"','id="music-audio"',
  'id="lyrics-scroll"','id="home-commerce-status"',
  'id="music-visual"','href="create.html"'
 ])assert.ok(homepage.includes(marker),'missing '+marker);
 assert.equal((homepage.match(/id="cinematic-intro"/g)||[]).length,1);
 assert.ok(homepage.indexOf('id="cinematic-intro"')<homepage.indexOf('<main id="top">'));
});
test('WebGL sequence contains real R3F scene and four GLSL programs',()=>{
 assert.ok(entry.includes("from '@react-three/fiber'"));
 for(const name of ['function Train','function MemoryOrb','function ParticleCloud','function Clouds','function Book','pointVertex','pointFragment','orbVertex','cloudFragment','pageFragment']){
  assert.ok(entry.includes(name),'missing '+name);
 }
 assert.ok(entry.includes('onCreated:'));
 assert.ok(entry.includes('prefers-reduced-motion'));
 assert.ok(entry.includes("data-cinematic-action"));
 assert.ok(css.includes('.song-cinematic'));
});
