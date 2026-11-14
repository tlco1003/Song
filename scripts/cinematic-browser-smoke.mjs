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
    await page.locator('[data-cinematic-action="skip"]').click();
    await page.waitForFunction(()=>document.querySelector('#cinematic-counter')?.textContent?.includes('04 / 04'));
    await page.locator('[data-cinematic-action="replay"]').click();
    await page.waitForFunction(()=>document.querySelector('#cinematic-counter')?.textContent?.includes('01 / 04'));
    await page.screenshot({path:'artifacts/cinematic-'+cfg.name+'.png'});
    if(jsErrors.length)console.warn(cfg.name+' console errors:',JSON.stringify(jsErrors.slice(0,8)));
    console.log('PASS '+cfg.name+': '+JSON.stringify(diagnostic));
    await context.close();
  }
} finally {
  await browser.close();
}
