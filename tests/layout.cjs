/* Read-only layout regression against saved guides. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.LOOPER_URL || 'http://127.0.0.1:8787';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless:true, args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const geometry = () => page.evaluate(() => {
    const card = document.querySelector('.graph-card'), viewport = document.querySelector('#graph-viewport');
    const rect = card.getBoundingClientRect(), box = viewport.getBoundingClientRect();
    const matrix = document.querySelector('#graph-content').transform.baseVal.consolidate().matrix;
    return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,mapHeight:box.height,k:matrix.a,
      centerX:(box.width / 2 - matrix.e) / matrix.a,centerY:(box.height / 2 - matrix.f) / matrix.a};
  });
  const noNestedScroll = () => page.evaluate(() => ['.guide-panel','.group-members','#node-list'].every(selector =>
    [...document.querySelectorAll(selector)].every(element => !['auto','scroll'].includes(getComputedStyle(element).overflowY))));
  try {
    const library = await (await page.request.get(base + '/api/guides')).json();
    const saved = library.find(g => g.bvid === 'BV1ECFQevEoD');
    assert.ok(saved, 'Requires the saved real graph');
    await page.goto(base + '/#/explore?guide=' + saved.id);
    await page.locator('#result:not([hidden])').waitFor();
    await page.locator('#map-mode').selectOption('overview');
    await page.locator('#zoom-in').click();
    await page.waitForTimeout(100);
    const before = await geometry();
    await page.locator('#fullscreen-button').click();
    await page.waitForTimeout(100);
    const expanded = await geometry();
    assert.equal(expanded.x, 0); assert.equal(expanded.y, 0);
    assert.equal(expanded.width, 1440); assert.equal(expanded.height, 900);
    assert.ok(expanded.mapHeight > before.mapHeight, 'Fullscreen must enlarge the map');
    assert.equal(expanded.k, before.k, 'Fullscreen must preserve zoom');
    assert.ok(Math.abs(expanded.centerX - before.centerX) < 1 && Math.abs(expanded.centerY - before.centerY) < 1, 'Fullscreen preserves the viewed location');
    assert.equal(await page.locator('#fullscreen-button').getAttribute('aria-pressed'), 'true');
    await page.setViewportSize({width:1280,height:800}); await page.waitForTimeout(100);
    const resized = await geometry();
    assert.equal(resized.k, expanded.k, 'Resizing must preserve zoom');
    assert.ok(Math.abs(resized.centerX - expanded.centerX) < 1 && Math.abs(resized.centerY - expanded.centerY) < 1);
    await page.setViewportSize({width:1440,height:900}); await page.waitForTimeout(100);
    const scroll = await page.evaluate(() => scrollY);
    await page.mouse.move(20, 200); await page.mouse.wheel(0, 250);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => scrollY), scroll, 'Background stays still');
    const fullscreenZoom = (await geometry()).k;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal((await geometry()).k, fullscreenZoom);
    assert.equal(await page.evaluate(() => document.body.classList.contains('map-expanded')), false);
    assert.equal(await noNestedScroll(), true);
    await page.locator('[data-display="chapter:6B"]').click();
    await page.locator('[data-cycle="5"]').click();
    assert.equal(await page.locator('.group-members [data-locate]').count(), 70);
    assert.equal(await noNestedScroll(), true, 'Large groups use the page scrollbar');
    await page.locator('#graph-viewport').scrollIntoViewIfNeeded();
    const box = await page.locator('#graph-viewport').boundingBox(), normal = await geometry();
    await page.mouse.move(box.x + 30, box.y + 50);
    const pageScroll = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 250); await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => scrollY) > pageScroll, 'Ordinary wheel scrolls the page');
    assert.equal((await geometry()).k, normal.k);
    const currentBox = await page.locator('#graph-viewport').boundingBox();
    await page.mouse.move(currentBox.x + 30, currentBox.y + 50);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    assert.ok((await geometry()).k > normal.k, 'Ctrl + wheel zooms the map');
    await page.locator('[data-view="list"]').click();
    assert.equal(await noNestedScroll(), true);
    await page.locator('#fullscreen-button').click();
    assert.equal(await page.locator('#node-list').evaluate(e => getComputedStyle(e).overflowY), 'auto');
    await page.keyboard.press('Escape');
    await page.locator('[data-view="graph"]').click();
    await page.locator('#node-detail [data-return-endings]').click();
    await page.locator('#map-mode').selectOption('overview');
    fs.mkdirSync('artifacts', {recursive:true});
    await page.locator('.workspace-grid').scrollIntoViewIfNeeded();
    await page.screenshot({path:'artifacts/layout-desktop.png'});
    await page.locator('#fullscreen-button').click();
    await page.waitForTimeout(100);
    await page.screenshot({path:'artifacts/layout-fullscreen.png'});
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.graph-card').classList.contains('map-fullscreen'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('map-expanded')), false);
    for (const width of [1024, 768, 390, 320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow at ' + width);
      await page.locator('#fullscreen-button').click(); await page.waitForTimeout(100);
      const mobile = await geometry();
      assert.equal(mobile.width, width); assert.equal(mobile.height, 844);
      assert.ok(mobile.mapHeight > 400);
      if (width === 390) await page.screenshot({path:'artifacts/layout-mobile-fullscreen.png'});
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    console.log('Single page scrolling, 70-scene group, fullscreen dimensions/zoom/location/history, background lock, list and responsive layouts: passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
