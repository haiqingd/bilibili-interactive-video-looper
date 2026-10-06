/* Real saved case, no writes or upstream requests. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOOPER_URL||'https://story-explorer.nas.haiqingd.top:1443';
const guide=process.env.LOOPER_GUIDE||'c943cad2d9d142388e47eb3dbd80bac9';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const record=await(await page.request.get(base+'/api/guides/'+guide)).json(),g=record.graph;
  assert.equal(g.analysis.complete,true);assert.equal(g.analysis.truncated,false);assert.equal(g.analysis.states,10043);
  assert.equal(g.analysis.endings.filter(e=>e.reachable).length,55);assert.equal(g.analysis.reachable_nodes.length,371);
  const groups=new Map();
  for(const n of g.nodes)for(const q of n.questions)for(const c of q.choices){if(!c.target)continue;const pair=JSON.stringify([n.id,c.target]);if(!groups.has(pair))groups.set(pair,[]);groups.get(pair).push(q.type===0||!!c.hidden);}
  await page.goto(base+'/#/explore?guide='+guide+'&mode=full&labels=1');await page.locator('#stat-states').filter({hasText:'10,043'}).waitFor();
  await page.locator('.graph-node').first().waitFor();assert.equal(await page.locator('.graph-node').count(),371);
  const labelCounts=await page.locator('.edge-group').evaluateAll(elements=>elements.map(e=>({id:e.dataset.edge,count:e.querySelectorAll('.edge-label').length})));
  let automatic=0,manual=0;
  for(const e of labelCounts){const flags=groups.get(e.id);assert.ok(flags);if(flags.every(Boolean)){automatic++;assert.equal(e.count,0);}else{manual++;assert.equal(e.count,1);}}
  assert.ok(automatic>50);assert.ok(manual>50);
  const auto=g.nodes.find(n=>n.questions.length&&n.questions.every(q=>q.type===0));
  await page.locator('#node-search').fill(auto.id);await page.locator('#search-results [data-locate="'+auto.id+'"]').click();
  assert.equal(await page.locator('#node-detail .choice-detail b').count(),0);assert.ok(await page.locator('#node-detail .choice-target').count());
  await page.locator('#node-detail [data-return-endings]').click();const ending=g.analysis.endings.find(e=>e.reachable&&e.steps.some(s=>s.automatic)&&(g.ending_groups||[]).some(group=>group.id===e.id));assert.ok(ending);
  await page.locator('[data-ending="'+ending.id+'"]').click();await page.locator('#route-only').check();
  for(let i=0;i<ending.steps.length;i++){
   const step=ending.steps[i],edge=page.locator('[data-edge="route-edge:'+i+'"]');
   assert.equal(await edge.locator('.edge-label').count(),step.automatic?0:1);
   const row=page.locator('#route-steps li').nth(i);assert.equal(await row.locator('p').count(),step.automatic?0:1);
  }
  const text=await page.evaluate(()=>routeText());assert.match(text,/→ 自动跳转/);
  assert.deepEqual(errors,[]);fs.mkdirSync('artifacts',{recursive:true});await page.locator('#route-panel').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/automatic-route.png'});
  console.log('Real case: complete 371 scenes / 55 endings / 10043 states; automatic edge/detail/route labels omitted; manual labels preserved: passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
