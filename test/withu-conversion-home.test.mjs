import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('docs/index.html'),css=read('docs/style.css'),prices=read('docs/home-story.js');
test('personalized hero is visible before existing video and links to working creation page',()=>{
 assert.ok(html.indexOf('class="hero-actions"')<html.indexOf('id="music-visual-stage"'));
 assert.match(html,/class="main-cta-link hero-primary" href="create\.html"/);
 assert.match(html,/두 사람만 아는 진짜 이야기를 음악 편지에 담아보세요/);
 for(const id of ['music-visual-stage','current-cover','music-audio','album-art','track-list','review-gallery'])
  assert.ok(html.includes('id="'+id+'"'));
});
test('three peer-reviewed original sources appear with explicit scope caveat',()=>{
 for(const doi of ['10.1093/cercor/bhp008','10.1093/jcr/ucw067','10.1016/j.jcps.2017.06.002'])
  assert.ok(html.includes('https://doi.org/'+doi));
 assert.match(html,/WITHU 제품의 구매율·감동·관계 개선 효과를 직접 검증한 것은 아닙니다/);
});
test('gift value, production steps and prices precede archived vision research',()=>{
 const order=['id="why-a-song"','id="how-it-works"','id="home-packages"',
  'id="gifts"','id="reviews"','id="vision-lab-preview"'].map(x=>html.indexOf(x));
 assert.ok(order.every(x=>x>=0));
 assert.ok(order.every((x,i)=>i===0||x>order[i-1]));
 assert.match(html,/id="mother-featured-video"/);
});
test('displayed prices come from public SSOT and payment readiness is described accurately',()=>{
 assert.match(html,/src="home-story\.js\?v=/);
 assert.match(prices,/fetch\('prices\.json',\{cache:'no-store'\}\)/);
 assert.match(prices,/data\.pricingStatus==='commercial_ready'/);
 for(const kind of ['audio','audio_duo','audio_video'])
  assert.ok(html.includes('data-home-price="'+kind+'"'));
 assert.match(html,/원본 음원 다운로드와 상업적 이용은 별도 권리 확인과 결제가 필요합니다/);
 assert.match(css,/\.home-package-grid/);
 assert.match(css,/@media\(max-width:690px\)/);
});
