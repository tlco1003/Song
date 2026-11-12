#!/usr/bin/env node
/**
 * MOMENT AI news feed importer. Official publisher RSS links only.
 * IMPORTANT: publisher headlines/URLs/time only; no articles, summaries, images or popularity claims.
 * Designed for GitHub Actions, not browser use. Requires Node 20+.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const SOURCES = Object.freeze([
  {category:'headlines', name:'연합뉴스',url:'https://www.yna.co.kr/rss/news.xml',links:['yna.co.kr']},
  {category:'headlines', name:'뉴시스',url:'https://www.newsis.com/RSS/sokbo.xml',links:['newsis.com']},
  {category:'economy', name:'연합뉴스',url:'https://www.yna.co.kr/rss/economy.xml',links:['yna.co.kr']},
  {category:'economy', name:'뉴시스',url:'https://www.newsis.com/RSS/economy.xml',links:['newsis.com']},
  {category:'culture', name:'뉴시스',url:'https://www.newsis.com/RSS/culture.xml',links:['newsis.com']},
  {category:'culture', name:'동아일보',url:'https://rss.donga.com/culture.xml',links:['donga.com']},
  {category:'technology', name:'뉴시스',url:'https://www.newsis.com/RSS/health.xml',links:['newsis.com']},
  {category:'technology', name:'IT동아',url:'https://it.donga.com/feeds/rss/news/',links:['donga.com']},
]);
export const CATEGORIES=['headlines','technology','culture','economy'];

export function decodeXml(input='') {
  return String(input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp|nbsp|hellip|ndash|mdash);/gi,(_,code)=>{
      const c=code.toLowerCase();
      if(c[0]==='#'){
        const number=c[1]==='x'?parseInt(c.slice(2),16):parseInt(c.slice(1),10);
        return Number.isInteger(number)&&number>0&&number<=0x10ffff?String.fromCodePoint(number):'';
      }
      return {lt:'<',gt:'>',quot:'"',apos:"'",amp:'&',nbsp:' ',hellip:'…',ndash:'–',mdash:'—'}[c]||'';
    })
    .replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim();
}

function readTag(xml,tag){
  const escaped=tag.replace(/[^a-z0-9:_-]/gi,'');
  const m=new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`,'i').exec(xml);
  return m?decodeXml(m[1]):'';
}
function readableUrl(s, allowed){
  try{
    const url=new URL(s);
    if(url.protocol==='http:')url.protocol='https:';
    if(url.protocol!=='https:')return null;
    const host=url.hostname.toLowerCase();
    if(!allowed.some(d=>host===d||host.endsWith('.'+d)))return null;
    url.hash='';
    return url.toString();
  }catch{return null;}
}

export function parseRss(xml, source, now=new Date()){
  if(typeof xml!=='string'||xml.length>3_000_000)throw new Error('Feed size invalid');
  if(!/<rss\b|<rdf:RDF\b|<feed\b/i.test(xml))throw new Error('Not an RSS/Atom feed');
  const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)||[];
  const out=[];
  for(const item of blocks.slice(0,160)){
    const title=readTag(item,'title').slice(0,240);
    let link=readTag(item,'link');
    if(!link){const matched=/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(item);link=matched?decodeXml(matched[1]):'';}
    const uri=readableUrl(link,source.links);
    const rawDate=readTag(item,'pubDate')||readTag(item,'dc:date')||readTag(item,'published')||readTag(item,'updated');
    const published=new Date(rawDate);
    // No undated, future-dated or more-than-48-hour-old headlines; do not imply freshness.
    const age=now.getTime()-published.getTime();
    if(!title||!uri||!Number.isFinite(age)||age < -30*60_000||age>48*3600_000)continue;
    out.push({title,link:uri,source:source.name,publishedAt:published.toISOString(),category:source.category});
  }
  return out;
}

const FETCH_MS=12_000;
export async function fetchSource(source,{fetcher=fetch,now=new Date()}={}) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),FETCH_MS);
  try{
    const r=await fetcher(source.url,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':'MOMENT-AI-Contest-Demo/1.0 (+https://tlco1003.github.io/Song/moment-ai/)',Accept:'application/rss+xml, application/xml, text/xml;q=0.9'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const xml=await r.text();
    const items=parseRss(xml,source,now);
    if(!items.length)throw new Error('No valid dated headline links');
    return {source:source.name,category:source.category,ok:true,count:items.length,items};
  }catch(e){return {source:source.name,category:source.category,ok:false,error:String(e?.message||e).slice(0,100),count:0,items:[]};}
  finally{clearTimeout(timer);}
}
export function makeNewsData(results,now=new Date()){
  const categories=Object.fromEntries(CATEGORIES.map(k=>[k,[]]));
  const seen=new Set();
  const all=results.flatMap(x=>x.items||[]).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  for(const item of all){
    if(!CATEGORIES.includes(item.category))continue;
    const key=item.category+':'+item.title.toLowerCase().replace(/\s|[\W_]/g,'').slice(0,110);
    if(seen.has(key))continue;seen.add(key);
    if(categories[item.category].length<12)categories[item.category].push(item);
  }
  const result={schema:'MOMENT_NEWS_RSS_v1',generatedAt:now.toISOString(),kind:'RECENT_PUBLISHER_RSS_NOT_POPULARITY_RANKING',
    coverage:'연합뉴스·뉴시스·동아일보·IT동아 등 연결된 피드의 최신 헤드라인. 국가 전체 인기 순위가 아닙니다.',
    categories,
    sources:results.map(({source,category,ok,count,error})=>({name:source,category,status:ok?'ok':'failed',count,...(!ok?{error}: {})})),
    status:all.length?'partial_or_ready':'unavailable',
    licensing:'Only title, publisher, publication time and deep link are shown. No article body, images or generated summaries. Commercial feed redistribution requires review.'};
  return result;
}

export async function main({fetcher=fetch,now=new Date(),output}={}){
  const results=await Promise.all(SOURCES.map(source=>fetchSource(source,{fetcher,now})));
  const data=makeNewsData(results,now);
  if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(data,null,2)+'\n','utf8');}
  console.log(JSON.stringify({generatedAt:data.generatedAt,status:data.status,counts:Object.fromEntries(Object.entries(data.categories).map(([k,v])=>[k,v.length])),sources:data.sources},null,2));
  // Publish explicit unavailable status rather than leaving a stale feed in place.
  return data;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=resolve(process.argv[2]||'docs/moment-ai/data/news.json');
  await main({output});
}