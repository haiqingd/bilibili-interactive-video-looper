const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'http://127.0.0.1:8787';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 const guides=await(await page.request.get(base+'/api/guides')).json(),g=guides.find(g=>g.bvid==='BV1ECFQevEoD');assert.ok(g);
 await page.goto(base+'/#/explore?guide='+g.id);await page.locator('[data-ending="40868266"]').waitFor();
 assert.match(await page.locator('[data-ending="40868266"]').innerText(),/BE05 粗心大意/);assert.match(await page.locator('[data-ending="40868266"]').innerText(),/片尾识别 · 待核对/);
 await page.locator('[data-ending="40868266"]').click();assert.match(await page.locator('#route-title').innerText(),/BE05/);
 const url=page.url();await page.locator('#ending-label-open').click();assert.equal(await page.locator('#ending-label-select').inputValue(),'40868266');
 await page.locator('#ending-label-frames img').first().waitFor();assert.equal(await page.locator('#ending-label-frames img').first().evaluate(img=>img.complete&&img.naturalWidth>0),true);
 assert.equal(await page.locator('#ending-label-category').inputValue(),'BE');assert.match(await page.locator('#ending-label-original').innerText(),/处决3/);
 await page.screenshot({path:'artifacts/ending-ocr-review.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'artifacts/ending-ocr-mobile.png'});
 // Cookie remains ephemeral; intercept to avoid a live media task.
 await page.route('**/recognize-endings',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试环境停止任务'})}));
 await page.locator('.ending-cookie summary').click();await page.locator('#ending-ocr-cookie').fill('test-cookie');await page.locator('#ending-recognize-one').click();await page.waitForFunction(()=>document.querySelector('#ending-label-error').textContent.includes('测试环境'));
 assert.equal(await page.locator('#ending-ocr-cookie').inputValue(),'');assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('test-cookie')),false);
 await page.locator('#ending-label-close').click();
 const named=guides.find(g=>g.bvid==='BV1JGxMzqEu3');await page.goto(base+'/#/explore?guide='+named.id);await page.waitForFunction(()=>document.querySelector('#video-id').textContent==='BV1JGxMzqEu3');await page.locator('.ending-badge.he').first().waitFor();assert.ok(await page.locator('.ending-badge.be').count()>0);assert.ok(await page.locator('.ending-badge.he').count()>0);const record=await(await page.request.get(base+'/api/guides/'+named.id)).json();assert.equal(await page.locator('.ending').count(),record.graph.ending_groups.length);assert.match(await page.locator('.ending-source').first().innerText(),/标题标注/);
 assert.deepEqual(errors,[]);console.log('Ending title classification, real OCR evidence/name, route labels, ephemeral Cookie and mobile: passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
