import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { createFixture, evidence } from './order-pagination-fixture.mjs'
const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(`${process.env.APPDATA}/npm/node_modules/playwright`)) }
const origin = process.env.ORDER_QA_URL || 'http://127.0.0.1:18397'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Browser QA must target a local development server')
assert.equal((await fetch(origin)).status, 200)
const f = await createFixture('browser'), browser = await chromium.launch({ headless: true })
const report = { startedAt: new Date().toISOString(), environment: 'current H5 development source + loopback real API/SQLite; SQL volume fixtures; no production/WeChat/device calls', cases: [], requests: [], consoleErrors: [], failedRequests: [] }
let page, navigationPhase=false, responseGate=null
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
async function waitForGate(gate){let timer;try{await Promise.race([gate.arrived.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`No request reached gate ${gate.path}`)),12000)})])}finally{clearTimeout(timer)}}
async function navigating(action){navigationPhase=true;try{return await action()}finally{navigationPhase=false}}
const shot = name => page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true })
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.pathname.startsWith('/api/')) {
      const res = await fetch(`${f.base}${url.pathname.slice(4)}${url.search}`, { method: req.method(), headers: { 'Content-Type': 'application/json', ...(req.headers().authorization ? { Authorization: req.headers().authorization } : {}) }, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() })
      const body = await res.text()
      report.requests.push({ method: req.method(), path: url.pathname + url.search, status: res.status })
      const gate=responseGate
      if(gate&&!gate.captured&&gate.path===url.pathname&&gate.method===req.method()){
        gate.captured=true;gate.arrived.resolve();await gate.release.promise
      }
      return route.fulfill({ status: res.status, body, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' } })
    }
    if (url.origin === origin || url.protocol === 'data:') return route.continue()
    // An optional H5 facial SDK is not part of these order flows. Never contact it.
    if (url.pathname.endsWith('/jsvm_all.js')) return route.fulfill({ body: '', contentType: 'application/javascript' })
    return route.abort()
  })
  const p = await ctx.newPage()
  p.on('pageerror', error => report.consoleErrors.push(error.message))
  p.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  p.on('requestfailed', req => report.failedRequests.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText, expectedNavigationAbort: navigationPhase&&req.failure()?.errorText==='net::ERR_ABORTED' }))
  return p
}
async function loadEveryPage(buttonName) {
  // uni-button is a custom element; unlike native <button> it has no implicit ARIA role.
  const button = page.locator('.list-pagination').getByText(buttonName, { exact: true })
  await button.waitFor()
  let previous = -1
  for (;;) {
    await page.waitForFunction(() => ![...document.querySelectorAll('uni-button')].some(x => x.textContent.includes('加载中…')))
    if (!await button.count()) break
    const count = await page.locator('.simple-order,.order-card').count()
    assert.ok(count > previous, 'load-more must make visible progress')
    previous = count
    await button.click()
    await page.waitForFunction(old => document.querySelectorAll('.simple-order,.order-card').length > old, count)
  }
}
try {
  page = await context()
  await navigating(() => page.goto(`${origin}/#/pages/delivery/index`, { waitUntil: 'domcontentloaded' }))
  await page.locator('.login-form input').nth(0).fill('13812345678')
  await page.locator('.login-form input').nth(1).fill('PaginationOnly!2026')
  if (await page.locator('.uni-checkbox-input svg').count() === 0) await page.locator('.consent-toggle').click()
  await page.getByText('登录工作台', { exact: true }).click()
  await page.locator('.bottom-badge').filter({ hasText: '208' }).waitFor()
  assert.equal(await page.locator('.alert-layer').count(), 0)
  assert.deepEqual((await page.locator('.stat-grid .ui-strong').allTextContents()).slice(0,2), ['206','2'])
  assert.match(await page.locator('.list-note').innerText(), /非全天总计/)
  await shot('courier-complete-active-scope')
  await page.locator('.bottom-nav .nav-item').filter({ hasText: '订单' }).click()
  await page.locator('.segment-row').getByText('配送中', { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.simple-order').length === 2)
  await shot('courier-old-delivering-and-held')
  await page.locator('.simple-order').first().click()
  await page.getByText('商品已全部退回，不能继续配送', { exact: true }).waitFor()
  await shot('courier-held-detail')
  await page.locator('.nav-back').click()
  await page.locator('.bottom-nav .nav-item').filter({ hasText: '订单' }).click()
  await page.locator('.segment-row').getByText('已完成', { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.simple-order').length === 20)
  await loadEveryPage('加载更多历史订单')
  assert.equal(await page.locator('.simple-order').count(), 325)
  await shot('courier-history-325')
  report.cases.push({ id: 'F03-browser', status: 'PASS', active: 208, deliveringIncludingHeld: 2, completedHistory: 325, initialAlert: false })

  await page.locator('.bottom-nav .nav-item').filter({ hasText: '工作台' }).click()
  f.db.prepare('UPDATE orders SET courier_id=NULL,courier_name=NULL WHERE courier_id=?').run(f.courierId)
  await page.getByText('暂无配送任务', { exact: true }).waitFor()
  const first = await f.newTask('browser-first-after-idle')
  await page.locator('.alert-layer').waitFor({ timeout: 12000 })
  assert.match(await page.locator('.alert-info').innerText(), new RegExp(first))
  await shot('courier-first-new-alert')
  await page.getByText(/^稍后处理/).click()
  await f.ok(`/orders/${first}/accept`, 'POST', {}, 'courier')
  await f.ok(`/orders/${first}/complete`, 'POST', { signMethod: 'manual' }, 'courier')
  await page.getByText('暂无配送任务', { exact: true }).waitFor({ timeout: 12000 })
  const second = await f.newTask('browser-next-after-clear')
  await page.locator('.alert-layer').waitFor({ timeout: 12000 })
  assert.match(await page.locator('.alert-info').innerText(), new RegExp(second))
  await shot('courier-next-new-alert')
  await navigating(() => page.goto(`${origin}/?reload=1#/pages/delivery/index?screen=workbench`, { waitUntil: 'domcontentloaded' }))
  await page.locator('.next-card').filter({ hasText: '林悦' }).waitFor()
  assert.equal(await page.locator('.alert-layer').count(), 0, 'fresh entry with existing order is baseline, not a new assignment')
  report.cases.push({ id: 'F07-browser', status: 'PASS', firstAssignment: first, nextAssignment: second, refreshedEntryAlert: false })

  // Existing newer B must not become the target of an alert for newly assigned older A.
  const older=await f.ok('/orders','POST',{sku:'water-18_9l',quantity:1,payment:'货到付款',idempotencyKey:'browser-older-new-assignment'},'customer')
  f.db.prepare("UPDATE orders SET created_at='2026-08-01T00:00:00Z' WHERE id=?").run(older.id)
  await f.ok(`/orders/${older.id}/pay`,'POST',{},'customer')
  await f.ok(`/orders/${older.id}/assign`,'POST',{courierId:f.courierId})
  await page.locator('.alert-layer').waitFor({timeout:12000})
  assert.match(await page.locator('.alert-info').innerText(),new RegExp(older.id))
  await shot('courier-older-new-assignment-alert')
  await page.getByText('立即接单',{exact:true}).click()
  await page.locator('.delivery-state').filter({hasText:'配送中'}).waitFor()
  assert.equal(f.app.store.get(older.id).status,'配送中')
  assert.equal(f.app.store.get(second).status,'待配送')
  report.cases.push({id:'IR-M02-older-new-assignment-browser',status:'PASS',newAssignment:older.id,existingPending:second,acceptedStatus:f.app.store.get(older.id).status,existingStatus:f.app.store.get(second).status})

  await navigating(() => page.close()); page = await context()
  await navigating(() => page.goto(`${origin}/#/pages/index/index?screen=auth`, { waitUntil: 'domcontentloaded' }))
  await page.locator('#auth-phone input').fill(f.sessions.customer.profile.phone)
  await page.locator('#auth-password input').fill('PaginationOnly!2026')
  if (await page.locator('.uni-checkbox-input svg').count() === 0) await page.locator('.consent-toggle').click()
  await page.locator('.auth-submit').click()
  await page.waitForFunction(() => !document.querySelector('.auth-submit'))
  await navigating(() => page.goto(`${origin}/?orders=1#/pages/order/index?screen=orders`, { waitUntil: 'domcontentloaded' }))
  await page.locator('.order-card').first().waitFor()
  await loadEveryPage('加载更多订单')
  const expected = f.db.prepare('SELECT COUNT(*) count FROM orders WHERE customer_id=?').get(f.customerId).count
  assert.equal(await page.locator('.order-card').count(), expected)
  await shot('customer-history-all')
  await page.locator('.status-tabs').getByText('配送中', { exact: true }).click()
  await page.locator('.order-card').filter({ hasText: f.deliveringId }).waitFor()
  await page.locator('.status-tabs').getByText('全部', { exact: true }).click()
  await page.locator('.search-input input').fill('PAGE-HISTORY-0000')
  await page.waitForFunction(() => document.querySelectorAll('.order-card').length === 1 && document.querySelector('.order-card').textContent.includes('PAGE-HISTORY-0000'))
  await shot('customer-old-history-search')
  await navigating(() => page.reload({ waitUntil: 'domcontentloaded' }))
  await page.locator('.order-card').first().waitFor()
  assert.equal(await page.locator('.order-card').count(), 20)
  assert.equal(await page.locator('.list-pagination').getByText('加载更多订单', { exact: true }).count(), 1)
  report.cases.push({ id: 'customer-browser', status: 'PASS', allHistory: expected, oldActiveFilter: true, oldHistorySearch: true, refreshRetainsPagingEntry: true })

  for(const action of ['cancel','confirm-receipt']){
    const create=key=>f.ok('/orders','POST',{sku:'water-18_9l',quantity:1,payment:'货到付款',idempotencyKey:key},'customer')
    const a=await create(`browser-race-${action}-A`),b=await create(`browser-race-${action}-B`)
    if(action==='confirm-receipt')for(const item of [a,b]){
      await f.ok(`/orders/${item.id}/pay`,'POST',{},'customer');await f.ok(`/orders/${item.id}/assign`,'POST',{courierId:f.courierId})
      await f.ok(`/orders/${item.id}/accept`,'POST',{},'courier');await f.ok(`/orders/${item.id}/complete`,'POST',{signMethod:'manual'},'courier')
    }
    await page.locator('.order-card').filter({hasText:a.id}).waitFor({timeout:12000})
    const gate={method:'GET',path:`/api/orders/${a.id}`,arrived:deferred(),release:deferred(),captured:false}
    responseGate=gate
    await page.locator('.order-card').filter({hasText:a.id}).click()
    await waitForGate(gate)
    await page.locator('.nav-back').click()
    await page.locator('.order-card').filter({hasText:b.id}).click()
    const bRefresh=page.waitForResponse(res=>new URL(res.url()).pathname===`/api/orders/${b.id}`&&res.request().method()==='GET')
    gate.release.resolve();await bRefresh;responseGate=null
    await page.waitForFunction(id=>document.querySelector('.order-info')?.textContent.includes(id),b.id)
    assert.ok(!(await page.locator('.order-info').first().innerText()).includes(a.id))
    await shot(`customer-race-${action}-B-retained`)
    const write=page.waitForResponse(res=>new URL(res.url()).pathname===`/api/orders/${b.id}/${action}`&&res.request().method()==='POST')
    await page.getByText(action==='cancel'?'取消订单':'确认收货',{exact:true}).click()
    assert.equal((await write).status(),200)
    const persisted=f.db.prepare('SELECT id,status,receipt_confirmed_at FROM orders WHERE id IN (?,?) ORDER BY id').all(a.id,b.id)
    if(action==='cancel'){assert.equal(f.app.store.get(a.id).status,'待付款');assert.equal(f.app.store.get(b.id).status,'已取消')}
    else{assert.equal(f.app.store.get(a.id).receiptConfirmedAt,null);assert.ok(f.app.store.get(b.id).receiptConfirmedAt)}
    assert.match(await page.locator('.order-info').first().innerText(),new RegExp(b.id))
    report.cases.push({id:`IR-M01-browser-delayed-detail-${action}-B`,status:'PASS',delayedOrder:a.id,selectedOrder:b.id,persisted,method:'real DOM select/back/select, delay only real GET response delivery, real POST + SQLite'})
    await page.locator('.nav-back').click()
  }
  assert.equal(report.failedRequests.filter(r=>!r.expectedNavigationAbort).length, 0, JSON.stringify(report.failedRequests))
  assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors))
  assert.equal(report.requests.filter(r => r.status >= 400).length, 0)
} catch (error) { report.error = error.stack; if (page) await shot('browser-failure').catch(() => {}); process.exitCode = 1 }
finally {
  responseGate?.release.resolve()
  await navigating(() => browser.close()); await f.close()
  report.finishedAt = new Date().toISOString(); report.status = report.error ? 'FAIL' : 'PASS'
  await writeFile(`${evidence}/browser-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases, error: report.error, requests: report.requests.length, consoleErrors: report.consoleErrors, failedRequests: report.failedRequests }, null, 2))
}
