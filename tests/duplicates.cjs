/* Saved real graph, read-only. Optional asset interception tests edits against Docker APIs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'https://story-explorer.nas.haiqingd.top:1443';
const guide='b581db81ee0f4ef085bd74ddd709021d',ids=['42658475','42658426','42658443','42658419'];
const title='2-第二天公聊+10提9',card='[data-display="duplicate:42658419"]';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    if(process.env.LOOPER_TEST_LOCAL_ASSETS==='1'){
      const assets=new Map([['/','index.html'],['/map.js','map.js'],['/app.js','app.js'],['/style.css','style.css'],['/theme.js','theme.js']]);
      await page.route('**/*',r=>{
        const file=assets.get(new URL(r.request().url()).pathname);
        return file?r.fulfill({path:path.join(__dirname,'..','static',file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'}):r.continue();
      });
    }
    const record=await(await page.request.get(base+'/api/guides/'+guide)).json(),g=record.graph;
    await page.goto(base+'/#/explore?guide='+guide+'&center='+ids[0]+'&labels=1');
    await page.locator(card).waitFor();assert.equal(await page.locator(card).count(),1);
    assert.match(await page.locator(card).textContent(),/4 个相同片段/);
    for(const id of ids)assert.equal(await page.locator('[data-display="'+id+'"]').count(),0);
    const outgoing=await page.locator('.edge-group').evaluateAll(elements=>elements.filter(e=>JSON.parse(e.dataset.edge)[0]==='duplicate:42658419').map(e=>e.querySelector('.edge-label')?.textContent));
    assert.deepEqual(outgoing.sort(),['A 投票','B 不投']);
    await page.locator('#fit-button').click();await page.locator(card).click();
    assert.equal(await page.locator('#guide-panel-title').innerText(),'相同片段详情');
    assert.equal(await page.locator('#node-detail .choice-detail').count(),2);
    assert.equal(await page.locator('[data-equivalent]').count(),4);
    await page.locator('.equivalent-members summary').click();
    await page.locator('[data-equivalent="'+ids[2]+'"]').click();
    await page.waitForFunction(id=>location.hash.includes('node='+id),ids[2]);
    assert.equal(await page.locator(card).count(),1);
    assert.equal(await page.locator('[data-equivalent="'+ids[2]+'"]').getAttribute('aria-pressed'),'true');
    await page.reload();await page.locator(card).waitFor();
    assert.equal(await page.locator('#guide-panel-title').innerText(),'相同片段详情');
    assert.equal(await page.locator('[data-equivalent="'+ids[2]+'"]').getAttribute('aria-pressed'),'true');
    await page.locator('#merge-duplicates').uncheck();await page.waitForFunction(()=>location.hash.includes('duplicates=0'));
    assert.equal(await page.locator(card).count(),0);
    for(const id of ids)assert.equal(await page.locator('[data-display="'+id+'"]').count(),1);
    assert.equal(await page.locator('.equivalent-members').count(),0);
    await page.goBack();await page.locator(card).waitFor();
    assert.equal(await page.locator('#merge-duplicates').isChecked(),true);
    await page.locator('#map-mode').selectOption('full');assert.equal(await page.locator('.graph-node').count(),g.nodes.length);
    assert.equal(await page.locator('#merge-duplicates').isEnabled(),false);
    await page.locator('#map-mode').selectOption('compact');
    await page.locator('[data-view="list"]').click();assert.equal(await page.locator('.node-row').count(),g.nodes.length);
    await page.locator('[data-view="graph"]').click();
    const ending=g.analysis.endings.find(e=>e.reachable&&e.length&&e.steps.some(s=>ids.includes(s.source))&&(g.ending_groups||[]).some(group=>group.id===e.id));
    assert.ok(ending);await page.locator('[data-ending="'+ending.id+'"]').click();
    assert.equal(await page.locator('#route-steps li').count(),ending.length);
    assert.equal(await page.locator(card+'.highlight').count(),1);
    await page.locator('#route-only').check();assert.equal(await page.locator('.graph-node').count(),ending.length+1);
    assert.equal(await page.locator(card).count(),0);
    assert.equal(await page.locator('#merge-duplicates').isEnabled(),false);
    await page.locator('#clear-route').click();
    await page.locator('#node-search').fill(ids[1]);await page.locator('#search-results [data-locate="'+ids[1]+'"]').click();
    assert.equal(await page.locator(card+'.selected').count(),1);
    fs.mkdirSync('artifacts',{recursive:true});await page.locator('#readable-button').click();
    await page.evaluate(id=>focusDisplay(mapView.membership.get(id)),ids[1]);
    await page.locator('.workspace-grid').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/merged-scenes.png'});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.deepEqual(errors,[]);
    console.log('Real four-scene merge, unique outgoing labels, original IDs, details/history/toggle, full/list views, exact routes, search and mobile: passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
