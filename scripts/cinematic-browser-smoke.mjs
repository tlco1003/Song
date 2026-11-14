import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const base=process.env.SONG_SMOKE_URL || 'http://127.0.0.1:8765/';
const browser=await chromium.launch({
  headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']
});
mkdirSync('artifacts',{recursive:true});
try{
  for(const cfg of [
    {name:'desktop',width:1440,height:900,mobile:false},
    {name:'mobile',width:390,height:844,mobile:true}
  ]){
    const context=await browser.newContext({
      viewport:{width:cfg.width,height:cfg.height},
      deviceScaleFactor:cfg.mobile?2:1,
      isMobile:cfg.mobile,
      hasTouch:cfg.mobile,
      reducedMotion:'no-preference'
    });
    const page=await context.newPage();
    const jsErrors=[];
    page.on('pageerror',error=>jsErrors.push('page: '+error.message));
    page.on('console',msg=>{if(msg.type()==='error')jsErrors.push('console: '+msg.text())});
    const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
    assert.equal(response.status(),200,'homepage HTTP 200');
    await page.waitForSelector('#cinematic-intro');
    await page.waitForFunction(
      ()=>document.getElementById('cinematic-intro')?.classList.contains('song-cinematic--ready'),
      null,{timeout:45000}
    ).catch(async error=>{
      throw new Error(error.message+'; errors='+JSON.stringify(jsErrors.slice(0,12)));
    });
    const diagnostic=await page.evaluate(()=>{
      const canvas=document.querySelector('#cinematic-canvas canvas');
      const intro=document.getElementById('cinematic-intro');
      return {
        hasCanvas:!!canvas,
        canvasWidth:canvas?.width||0,
        canvasHeight:canvas?.height||0,
        heroHeight:Math.round(intro?.getBoundingClientRect().height||0),
        musicPlayerPreserved:!!document.getElementById('music-audio'),
        lyricSyncPreserved:!!document.getElementById('lyrics-scroll'),
        priceSectionPreserved:!!document.getElementById('home-commerce-status'),
        createLink:!!intro?.querySelector('a[href="create.html"]')
      };
    });
    assert.equal(diagnostic.hasCanvas,true,'R3F produced actual canvas');
    assert.ok(diagnostic.canvasWidth>0 && diagnostic.canvasHeight>0);
    assert.ok(diagnostic.heroHeight>500,'responsive viewport height');
    assert.equal(diagnostic.musicPlayerPreserved,true);
    assert.equal(diagnostic.lyricSyncPreserved,true);
    assert.equal(diagnostic.priceSectionPreserved,true);
    assert.equal(diagnostic.createLink,true);
    // The scene is scroll-driven: no timer should advance it while the page stays put.
    const getProgress=()=>page.evaluate(()=>({
      offset:window.scrollY,
      bar:parseFloat(document.querySelector('#cinematic-progress')?.style.width||'0'),
      chapter:document.querySelector('#cinematic-counter')?.textContent?.trim()
    }));
    const start=await getProgress();
    await page.waitForTimeout(550);
    const idle=await getProgress();
    assert.ok(Math.abs(idle.bar-start.bar)<.1,'idle page must not auto-play');
    const seek=ratio=>page.evaluate(r=>{
      const node=document.getElementById('cinematic-intro');
      const top=node.getBoundingClientRect().top+scrollY;
      const travel=node.offsetHeight-innerHeight;
      scrollTo({top:top+travel*r,behavior:'instant'});
    },ratio);
    await seek(.42);
    await page.waitForFunction(()=>parseFloat(document.querySelector('#cinematic-progress')?.style.width||'0')>40);
    const middle=await getProgress();
    assert.ok(middle.bar>40&&middle.bar<45,'scroll moves timeline forward');
    await page.screenshot({path:'artifacts/cinematic-'+cfg.name+'-clouds.png'});
    await seek(.14);
    await page.waitForFunction(()=>parseFloat(document.querySelector('#cinematic-progress')?.style.width||'0')<20);
    const rewind=await getProgress();
    assert.ok(rewind.bar<middle.bar,'back scroll reverses timeline');
    await page.screenshot({path:'artifacts/cinematic-'+cfg.name+'-train.png'});
    await page.locator('[data-cinematic-action="skip"]').click();
    await page.waitForFunction(()=>document.querySelector('#cinematic-counter')?.textContent?.includes('04 / 04'));
    await page.waitForTimeout(250);
    await page.screenshot({path:'artifacts/cinematic-'+cfg.name+'-book.png'});
    await page.locator('[data-cinematic-action="replay"]').click();
    await page.waitForFunction(()=>document.querySelector('#cinematic-counter')?.textContent?.includes('01 / 04'));
    await seek(.78);
    await page.waitForTimeout(250);
    await page.screenshot({path:'artifacts/cinematic-'+cfg.name+'-arrival.png'});
    if(jsErrors.length)console.warn(cfg.name+' console errors:',JSON.stringify(jsErrors.slice(0,8)));
    console.log('PASS '+cfg.name+': '+JSON.stringify(diagnostic));
    await context.close();
  }
} finally {
  await browser.close();
}
