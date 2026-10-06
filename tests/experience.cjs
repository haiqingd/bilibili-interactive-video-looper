/* Uses existing saved graphs read-only; network responses below are explicit test fixtures. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'http://127.0.0.1:8787';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1540,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const output=path.join(__dirname,'..','artifacts');fs.mkdirSync(output,{recursive:true});
 try{
  await page.goto(base);const library=await (await page.request.get(base+'/api/guides')).json();const saved=library.find(g=>g.bvid==='BV1ECFQevEoD');
  assert.ok(saved,'This regression needs the saved BV1ECFQevEoD graph');
  await page.locator('[data-page="library"]').click();await page.locator('.library-card').filter({hasText:'BV1ECFQevEoD'}).locator('[data-action="open"]').click();
  await page.locator('#map-mode').selectOption('overview');
  await page.locator('[data-display="chapter:5A"]').waitFor();assert.equal(await page.locator('.graph-node').count(),12);assert.equal(await page.locator('.edge-label').count(),0);
  await page.screenshot({path:path.join(output,'case-overview.png'),fullPage:true});
  await page.locator('[data-display="chapter:5A"]').click();assert.ok(await page.locator('.graph-node').count()<=10);assert.equal(await page.locator('[data-cycle]').count(),9);
  await page.screenshot({path:path.join(output,'case-chapter.png'),fullPage:true});
  await page.locator('[data-level="-1"]').click();await page.locator('[data-display="chapter:6B"]').click();await page.locator('[data-cycle="5"]').click();
  assert.ok(await page.locator('.graph-node').count()<=30);assert.equal(await page.locator('.group-members [data-locate]').count(),70);
  await page.waitForTimeout(300);await page.screenshot({path:path.join(output,'case-cycle.png'),fullPage:true});
  await page.locator('#node-detail [data-return-endings]').click();
  await page.locator('[data-ending="40868472"]').click();assert.equal(await page.locator('#route-steps li').count(),45);assert.equal(await page.locator('#route-only').isChecked(),false);await page.locator('#route-only').check();assert.equal(await page.locator('.graph-node').count(),46);
  assert.equal(await page.locator('.graph-edge.highlight').count(),45);
  for(let i=0;i<4;i++)await page.locator('#route-next').click();assert.equal(await page.locator('#route-position').innerText(),'4 / 45 步');
  await page.locator('#route-prev').click();assert.equal(await page.locator('#route-position').innerText(),'3 / 45 步');
  await page.locator('#fullscreen-button').click();assert.equal(await page.locator('.map-fullscreen').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.map-fullscreen').count(),0);
  await page.locator('#node-search').fill('40868472');await page.locator('#search-results [data-locate="40868472"]').click();assert.match(await page.locator('#node-detail').innerText(),/B-复盘/);
  await page.locator('#clear-route').click();
  const authors=await(await page.request.get(base+'/api/authors')).json();assert.ok(authors.length);
  const mid=authors.find(a=>a.id===String(saved.author_id)).id,known=library.filter(g=>String(g.author_id)===mid).map(g=>({bvid:g.bvid,title:g.title,guide_id:g.id,saved:true,author_id:mid,interactive:true}));
  const fake={bvid:'BV1UE411y7Wy',title:'浏览器测试：尚未解析的互动作品',interactive:true};
  let catalog={author_id:mid,videos:known,cached_pages:1,next_page:2,has_more:true,scanned:30,total_submissions:60,fetched_at:null,warnings:[]},risk=false,posts=[];
  await page.route('**/api/authors/'+mid+'/videos',async route=>{
   if(route.request().method()==='POST'){
    const body=route.request().postDataJSON();posts.push(body);
    if(risk){await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'HTTP 412：浏览器测试的风控响应'})});return;}
    catalog={...catalog,videos:[...known,fake],next_page:3,has_more:false,scanned:60,cached_pages:2};
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(catalog)});
  });
  await page.locator('#guide-author').click();await page.locator('.author-video-card').first().waitFor();assert.equal(await page.locator('.author-video-card').count(),known.length);
  await page.locator('.author-login summary').click();await page.locator('#author-cookie').fill('SESSDATA=browser-test-fixture');await page.locator('#author-load-more').click();
  await page.locator('[data-bvid="'+fake.bvid+'"]').waitFor();assert.equal(posts[0].page,2);assert.equal(posts[0].cookie,'SESSDATA=browser-test-fixture');
  assert.equal(await page.locator('#author-load-more').isVisible(),false);
  risk=true;await page.locator('#author-refresh').click();await page.locator('#author-error:not([hidden])').waitFor();assert.match(await page.locator('#author-error').innerText(),/412/);assert.equal(await page.locator('.author-video-card').count(),known.length+1);
  const parseRequests=[];
  await page.route('**/api/parse',async route=>{parseRequests.push(route.request().postDataJSON());await route.fulfill({status:202,contentType:'application/json',body:'{"job_id":"experience-test"}'});});
  await page.route('**/api/jobs/experience-test',route=>route.fulfill({contentType:'application/json',body:'{"status":"error","phase":"测试完成","done":0,"discovered":1,"error":"浏览器测试：已验证解析入口，未请求上游"}'}));
  await page.locator('[data-bvid="'+fake.bvid+'"] [data-video-action="parse"]').click();await page.locator('#parse-error:not([hidden])').waitFor();
  assert.equal(parseRequests.length,1);assert.match(parseRequests[0].url,new RegExp(fake.bvid));assert.equal(parseRequests[0].cookie,'SESSDATA=browser-test-fixture');
  assert.equal(await page.locator('#author-cookie').inputValue(),'');assert.equal(await page.locator('#cookie').inputValue(),'');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'case-mobile.png'),fullPage:false});
  assert.deepEqual(errors,[]);
  console.log('Real 388-node graph: chapter/section reduction, 70-node loop, 45-step guide, navigation, search, fullscreen, mobile: passed');
  console.log('Author fixtures: cache, pagination, risk preservation, selected-video parse and volatile Cookie handoff: passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
