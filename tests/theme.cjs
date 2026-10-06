/* Appearance checks against Docker; local assets can be previewed without a local server. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'https://story-explorer.nas.haiqingd.top:1443';
const entry=base+'/#/explore?guide=b581db81ee0f4ef085bd74ddd709021d&center=42658252&node=42658252&panel=node';
const assets=new Map([['/','index.html'],['/map.js','map.js'],['/app.js','app.js'],['/style.css','style.css'],['/theme.js','theme.js'],['/endings.js','endings.js']]);
async function intercept(page){
  if(process.env.LOOPER_TEST_LOCAL_ASSETS!=='1')return;
  await page.route('**/*',r=>{
    const file=assets.get(new URL(r.request().url()).pathname);
    return file?r.fulfill({path:path.join(__dirname,'..','static',file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'}):r.continue();
  });
}
function contrast(a,b){
  const luminance=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP story-explorer.nas.haiqingd.top 127.0.0.1']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await intercept(page);
  const mode=()=>page.locator('html').getAttribute('data-theme');
  try{
    const themeAsset=page.waitForResponse(r=>new URL(r.url()).pathname==='/theme.js');
    await page.goto(entry);assert.equal((await themeAsset).status(),200,'Theme script is served by the deployment');await page.locator('.ending-fork-summary').waitFor();
    assert.equal(await mode(),'dark');assert.equal(await page.locator('#theme-select').inputValue(),'system');
    await page.locator('#theme-select').selectOption('light');assert.equal(await mode(),'light');
    await page.emulateMedia({colorScheme:'dark'});assert.equal(await mode(),'light','Explicit light overrides system dark');
    await page.reload();await page.locator('.ending-fork-summary').waitFor();assert.equal(await mode(),'light');
    await page.locator('#zoom-in').click();
    const before=await page.evaluate(()=>({url:location.href,transform:document.querySelector('#graph-content').getAttribute('transform'),nodes:document.querySelectorAll('.graph-node').length}));
    await page.locator('#theme-select').selectOption('dark');
    assert.equal(await mode(),'dark');
    const after=await page.evaluate(()=>({url:location.href,transform:document.querySelector('#graph-content').getAttribute('transform'),nodes:document.querySelectorAll('.graph-node').length}));
    assert.deepEqual(after,before,'Theme changes preserve the scene, selection and zoom');
    await page.emulateMedia({colorScheme:'light'});assert.equal(await mode(),'dark');
    await page.reload();await page.locator('.ending-fork-summary').waitFor();assert.equal(await mode(),'dark');
    const colors=await page.evaluate(()=>{
      const card=document.querySelector('.graph-node.ending-fork');
      return {title:getComputedStyle(card.querySelector('.node-title')).fill,card:getComputedStyle(card.querySelector('rect')).fill,
        body:getComputedStyle(document.body).backgroundColor,map:getComputedStyle(document.querySelector('#graph-viewport')).backgroundColor,
        primary:getComputedStyle(document.querySelector('.primary')).color,button:getComputedStyle(document.querySelector('.primary')).backgroundColor};
    });
    assert.equal(colors.body,'rgb(16, 22, 36)');assert.equal(colors.map,'rgb(16, 26, 42)');
    assert.ok(contrast(colors.title,colors.card)>=4.5);assert.ok(contrast(colors.primary,colors.button)>=4.5);
    await page.locator('#readable-button').click();await page.evaluate(()=>focusDisplay(mapView.membership.get(selected)));
    await page.locator('.workspace-grid').scrollIntoViewIfNeeded();fs.mkdirSync('artifacts',{recursive:true});
    await page.screenshot({path:'artifacts/dark-desktop.png'});
    const downloadPromise=page.waitForEvent('download');await page.locator('#svg-export').click();
    const svg=fs.readFileSync(await(await downloadPromise).path(),'utf8');
    assert.ok(svg.includes(colors.title));assert.ok(svg.includes(colors.card));assert.ok(svg.includes(colors.map));
    const standalone=await context.newPage();await standalone.setContent(svg);
    assert.equal(await standalone.locator('.node-title').first().evaluate(e=>getComputedStyle(e).fill),colors.title);await standalone.close();
    await page.locator('#compare-toggle').click();await page.locator('#comparison-panel:not([hidden])').waitFor();
    assert.equal(await page.locator('#comparison-panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 37, 55)');
    assert.equal(await page.locator('.graph-edge[data-comparison="b"]').first().evaluate(e=>getComputedStyle(e).stroke),'rgb(128, 216, 208)');
    await page.locator('#compare-close').click();
    await page.locator('#help-button').click();
    assert.equal(await page.locator('#help-dialog').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 37, 55)');
    await page.locator('#help-close').click();
    await page.locator('[data-page="library"]').click();await page.locator('.library-card').first().waitFor();
    assert.equal(await page.locator('.library-card').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 37, 55)');
    await page.screenshot({path:'artifacts/dark-library.png'});
    // Keep appearance tests offline with an explicit cached author-directory fixture.
    await page.route('**/api/authors/*/videos',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({
      videos:[{bvid:'BV1Ap3xz9EwL',title:'血染钟楼02之全员追忆',guide_id:'b581db81ee0f4ef085bd74ddd709021d',saved:true}],
      cached_pages:1,scanned:0,total_submissions:0,has_more:false,next_page:2,warnings:[]
    })}));
    await page.locator('[data-page="authors"]').click();await page.locator('#authors-page .author-chip').first().waitFor();
    await page.locator('#author-video-cards .author-video-card').first().waitFor();
    assert.equal(await page.locator('#authors-page .author-chip.selected').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(48, 39, 71)');
    assert.equal(await page.locator('#author-video-cards .author-video-card').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 37, 55)');
    await page.locator('[data-page="explore"]').click();await page.locator('#explore-page:not([hidden])').waitFor();
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Responsive theme control at '+width);
    }
    await page.locator('#fullscreen-button').click();
    await page.locator('.map-fullscreen #graph-viewport').waitFor();
    assert.equal(await page.locator('.map-fullscreen').evaluate(e=>e.getBoundingClientRect().width),320);
    assert.equal(await page.locator('#graph-viewport').evaluate(e=>getComputedStyle(e).backgroundColor),colors.map);
    await page.screenshot({path:'artifacts/dark-mobile-fullscreen.png'});await page.keyboard.press('Escape');
    await page.locator('#theme-select').selectOption('system');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    const second=await context.newPage();await intercept(second);await second.goto(entry);await second.locator('#theme-select').waitFor();
    await page.locator('#theme-select').selectOption('light');await second.waitForFunction(()=>document.documentElement.dataset.theme==='light');await second.close();
    assert.deepEqual(errors,[]);
    const restricted=await browser.newContext({colorScheme:'dark'}),privatePage=await restricted.newPage();await intercept(privatePage);
    await privatePage.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Unavailable','SecurityError');}}));
    await privatePage.goto(base+'/#/explore');await privatePage.locator('#theme-select').waitFor();
    assert.equal(await privatePage.locator('html').getAttribute('data-theme'),'dark');
    await privatePage.locator('#theme-select').selectOption('light');assert.equal(await privatePage.locator('html').getAttribute('data-theme'),'light');
    await restricted.close();
    console.log('System/light/dark, explicit preference persistence, live system changes, cross-tab sync, unavailable storage, contrast, unchanged map state, standalone SVG, dialogs/library/authors, mobile and fullscreen: passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
