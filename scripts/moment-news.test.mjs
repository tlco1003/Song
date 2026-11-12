import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRss,decodeXml,makeNewsData,fetchSource,CATEGORIES,SOURCES} from './moment-news.mjs';
const source={category:'headlines',name:'검증언론',links:['example.com'],url:'https://example.com/rss.xml'};
const now=new Date('2026-11-12T11:00:00Z');
const good=`<?xml version="1.0"?><rss version="2.0"><channel><item><title><![CDATA[테스트 &amp; 기사]]></title><link>https://news.example.com/a?x=1&amp;y=2</link><pubDate>Thu, 12 Nov 2026 10:30:00 GMT</pubDate></item></channel></rss>`;
test('RSS headlines decode, source and published time',()=>{
 const a=parseRss(good,source,now);assert.equal(a.length,1);assert.equal(a[0].title,'테스트 & 기사');assert.equal(a[0].link,'https://news.example.com/a?x=1&y=2');assert.equal(a[0].publishedAt,'2026-11-12T10:30:00.000Z');
});
test('unsafe and stale URLs fail closed',()=>{
 const bad=good.replace('https://news.example.com/a?x=1&amp;y=2','javascript:alert(1)');assert.equal(parseRss(bad,source,now).length,0);
 const nonPublisher=good.replace('https://news.example.com','https://attacker.test');assert.equal(parseRss(nonPublisher,source,now).length,0);
 assert.equal(parseRss(good,source,new Date('2026-11-16T10:30:00Z')).length,0);
});
test('XML parser tolerates CDATA and strips tags',()=>{assert.equal(decodeXml('<![CDATA[<b>Hello</b> &amp; world]]>'),'Hello & world');});
test('category dedupe and no invented headline',()=>{
 const a=parseRss(good,source,now);const d=makeNewsData([{source:source.name,category:'headlines',ok:true,count:2,items:[...a,...a]}],now);
 assert.equal(d.categories.headlines.length,1);assert.equal(d.categories.technology.length,0);assert.equal(d.kind,'RECENT_PUBLISHER_RSS_NOT_POPULARITY_RANKING');
});
test('HTTP errors report unavailable, do not supply demo headline',async()=>{
 const bad=await fetchSource(source,{now,fetcher:async()=>({ok:false,status:403})});assert.equal(bad.items.length,0);
 const d=makeNewsData([bad],now);assert.equal(d.status,'unavailable');
});
test('category list and feeds are fixed HTTPS sources',()=>{assert.deepEqual(CATEGORIES,['headlines','technology','culture','economy']);assert(SOURCES.every(x=>x.url.startsWith('https://')));});