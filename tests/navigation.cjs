/* Read-only against existing guides; history restoration and comparison. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'http://127.0.0.1:8787';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const library=await(await page.request.get(base+'/api/guides')).json(),demo=library.find(g=>g.source==='demo');assert.ok(demo);
  await page.goto(base+'/#/explore?guide='+demo.id);await page.locator('[data-ending="good"]').waitFor();
  assert.equal(await page.locator('#map-mode').inputValue(),'compact');assert.equal(await page.locator('#route-only').isChecked(),false);
  await page.locator('[data-ending="good"]').click();assert.equal(await page.locator('#route-only').isChecked(),false);await page.waitForFunction(()=>location.hash.includes('ending=good'));
  await page.locator('#map-mode').selectOption('full');await page.waitForFunction(()=>location.hash.includes('mode=full'));const fullURL=page.url();
  await page.goBack();await page.waitForFunction(()=>document.querySelector('#map-mode').value==='compact'&&!location.hash.includes('mode=full'));assert.equal(await page.locator('#route-panel').isVisible(),true);
  await page.goForward();await page.waitForFunction(()=>document.querySelector('#map-mode').value==='full');assert.equal(page.url(),fullURL);
  await page.locator('#route-only').check();await page.waitForFunction(()=>location.hash.includes('only=1'));assert.equal(await page.locator('.graph-node').count(),8);
  await page.goBack();await page.waitForFunction(()=>!document.querySelector('#route-only').checked);assert.equal(await page.locator('.graph-node').count(),11);
  await page.locator('#route-only').check();await page.locator('#compare-toggle').click();assert.equal(await page.locator('#route-only').isChecked(),false);await page.locator('#comparison-panel:not([hidden])').waitFor();await page.locator('#compare-b').selectOption('bad');
  await page.waitForFunction(()=>location.hash.includes('compare='));assert.match(await page.locator('#comparison-results').innerText(),/信任值/);assert.match(await page.locator('#comparison-results').innerText(),/条件相关的前期选择/);assert.ok(await page.locator('.key-node').count()>0);
  const compareURL=page.url();await page.reload();await page.locator('#comparison-panel:not([hidden])').waitFor();assert.equal(page.url(),compareURL);assert.equal(await page.locator('#compare-b').inputValue(),'bad');
  fs.mkdirSync('artifacts',{recursive:true});await page.locator('#comparison-panel').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/ending-comparison.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#comparison-panel').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'artifacts/comparison-mobile.png'});await page.setViewportSize({width:1440,height:1080});
  await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>location.hash.includes('fullscreen=1'));await page.goBack();await page.waitForFunction(()=>!document.querySelector('.graph-card').classList.contains('map-fullscreen'));
  await page.locator('#compare-close').click();await page.waitForFunction(()=>!location.hash.includes('compare='));await page.goBack();await page.locator('#comparison-panel:not([hidden])').waitFor();
  await page.locator('#map-mode').selectOption('compact');await page.locator('#clear-route').click();await page.locator('[data-display="cycle:0"]').click();await page.waitForFunction(()=>location.hash.includes('focus='));
  const cycleURL=page.url();await page.locator('[data-node="loopA"]').first().click();await page.waitForFunction(()=>location.hash.includes('node=loopA'));
  await page.goBack();await page.waitForFunction(()=>document.querySelector('#guide-panel-title').textContent==='区域导航');assert.equal(page.url(),cycleURL);
  await page.reload();await page.locator('#node-detail [data-locate="loopA"]').waitFor();assert.equal(page.url(),cycleURL);
  await page.locator('#node-detail [data-return-endings]').click();await page.waitForFunction(()=>!location.hash.includes('panel=group'));await page.goBack();await page.waitForFunction(()=>document.querySelector('#guide-panel-title').textContent==='区域导航');
  await page.locator('[data-page="library"]').click();await page.waitForFunction(()=>location.hash.startsWith('#/library'));await page.goBack();await page.waitForFunction(()=>!document.querySelector('#explore-page').hidden);
  const real=library.find(g=>g.bvid==='BV1ECFQevEoD');if(real){await page.goto(base+'/#/explore?guide='+real.id);await page.locator('[data-ending="40868472"]').waitFor();assert.equal(await page.locator('#map-mode').inputValue(),'compact');await page.locator('[data-ending="40868472"]').click();assert.equal(await page.locator('#route-only').isChecked(),false);assert.ok(await page.locator('.graph-node').count()>46);await page.locator('#map-mode').selectOption('overview');await page.locator('[data-display="chapter:5A"]').click();const chapterURL=page.url();await page.locator('[data-cycle]').first().click();await page.goBack();await page.waitForFunction(()=>document.querySelector('#node-detail h4')?.textContent.includes('第五天'));assert.equal(page.url(),chapterURL);}
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('Default compact view, opt-in route, history/back/forward, deep links, cycle/chapter restoration, ending/score comparison and mobile: passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
