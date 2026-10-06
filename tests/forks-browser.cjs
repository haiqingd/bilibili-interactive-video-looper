/* Read-only UI regression; Docker serves the API throughout. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'https://story-explorer.nas.haiqingd.top:1443';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,
    args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP story-explorer.nas.haiqingd.top 127.0.0.1']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    if(process.env.LOOPER_TEST_LOCAL_ASSETS==='1'){
      const assets=new Map([['/','index.html'],['/map.js','map.js'],['/app.js','app.js'],['/style.css','style.css'],['/theme.js','theme.js'],['/endings.js','endings.js']]);
      await page.route('**/*',r=>{
        const file=assets.get(new URL(r.request().url()).pathname);
        return file?r.fulfill({path:path.join(__dirname,'..','static',file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'}):r.continue();
      });
    }
    const guide='b581db81ee0f4ef085bd74ddd709021d',node='42658252';
    const recordResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/guides/'+guide);
    await page.goto(base+'/#/explore?guide='+guide+'&center='+node+'&node='+node+'&panel=node');
    const record=await(await recordResponse).json();
    await page.locator('.ending-fork-summary').waitFor();
    const fork=page.locator('.graph-node.ending-fork').filter({hasText:'4-10-指认'}).first();
    assert.equal(await fork.locator('[data-fork-choice]').count(),3);
    assert.match(await fork.textContent(),/3 个结局/);
    const rows=await page.locator('.fork-option').allTextContents();
    assert.equal(rows.length,3);
    for(const [i,option,ending] of [[0,'A 指向2号','BE01 WBS'],[1,'B 指向5号','HE01 幸福三选一'],[2,'C 指向8号','BE02 RIIDRA']]){
      assert.ok(rows[i].includes(option));assert.ok(rows[i].includes(ending));
    }
    assert.equal(await page.locator('#edge-labels').isChecked(),false);
    assert.ok(await page.locator('.fork-edge-label').count()>=3,'Ending destinations stay visible with ordinary edge labels disabled');
    const cardId=await fork.getAttribute('data-display');
    await page.locator('#readable-button').click();await page.evaluate(id=>focusDisplay(id),cardId);
    await page.locator('.workspace-grid').scrollIntoViewIfNeeded();
    fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/ending-forks-desktop.png'});
    await page.locator('.fork-destination').nth(1).click();
    await page.waitForFunction(()=>document.querySelector('#node-detail h4')?.textContent==='HE01 幸福三选一');
    await page.goBack();await page.locator('.ending-fork-summary').waitFor();
    await page.reload();await page.locator('.ending-fork-summary').waitFor();assert.equal(await page.locator('.fork-option').count(),3);
    await page.locator('#map-mode').selectOption('full');assert.equal(await page.locator('.graph-node').count(),record.graph.nodes.length);
    assert.equal(await page.locator('[data-display="'+node+'"].ending-fork').count(),1);
    await page.locator('#map-mode').selectOption('overview');assert.ok(await page.locator('.contains-ending-fork').count());
    await page.locator('.contains-ending-fork').first().click();assert.ok(await page.locator('.group-ending-forks [data-locate]').count());
    await page.goto(base+'/#/explore?guide=c943cad2d9d142388e47eb3dbd80bac9&center=46636746&node=46636746&panel=node');
    await page.locator('.ending-fork-summary').waitFor();
    assert.equal(await page.locator('.fork-option').count(),2);
    assert.ok(await page.locator('.fork-option code').count()>=2);
    assert.match(await page.locator('.ending-fork-summary').textContent(),/满足上述条件/);
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.locator('#fullscreen-button').click();
    assert.equal(await page.locator('.graph-card').evaluate(e=>e.getBoundingClientRect().width),320);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);
    console.log('Real 3-ending fork, choice-to-ending names, default-visible markings, merged/full/overview views, conditions, target navigation/history, mobile and fullscreen: passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
