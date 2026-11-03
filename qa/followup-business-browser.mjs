import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { createFixture, evidence, password } from './followup-business-fixture.mjs'
const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require(`${process.env.APPDATA}/npm/node_modules/playwright`)) }
const origin = process.env.BUSINESS_QA_URL || process.env.ORDER_QA_URL || 'http://127.0.0.1:18447'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Local H5 only')
assert.equal((await fetch(origin)).status, 200)
const f = await createFixture('browser'), browser = await chromium.launch({ headless: true })
const report = { startedAt: new Date().toISOString(), environment: 'current local H5 + actual loopback HTTP/SQLite; no external services or real money', cases: [], requests: [], consoleErrors: [], failedRequests: [] }
let page, navigating = false, navigationId = 0
// These screens change local Vue state without changing the route. Force a real re-entry,
// including when the route still says orders but the visible screen is aftersales.
const goto = async path => { navigating = true; try { await page.goto(`${origin}/?businessQa=${++navigationId}#${path}`, { waitUntil: 'domcontentloaded' }) } finally { navigating = false } }
const shot = name => page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true })
const selectedItems = order => order.aftersalePolicy.returnItems.map(item => ({ ...item }))
const stock = id => f.db.prepare('SELECT sku_id,quantity,status FROM order_inventory_allocations WHERE order_id=? ORDER BY sku_id').all(id)
async function openRefund(order) {
  await goto('/pages/order/index?screen=orders')
  const card = page.locator('.order-card').filter({ hasText: order.id })
  await card.waitFor()
  const read = page.waitForResponse(res => new URL(res.url()).pathname === `/api/orders/${order.id}`)
  await card.click(); await read
  await page.locator('.order-info').filter({ hasText: order.id }).waitFor()
  await page.getByText('申请售后', { exact: true }).click()
  await page.locator('.refund-goods').waitFor()
}
async function submitAndAssert(order, { type, amount, items, locked, screenshot }) {
  if (type === '退货退款') await page.locator('.radio-line').getByText(type, { exact: true }).click()
  const input = page.locator('.refund-amount-input input')
  assert.equal(await input.isDisabled(), locked)
  if (!locked) await input.fill(String(amount))
  assert.equal(Number(await input.inputValue()), amount)
  if (locked && type === '退货退款') {
    for (const button of await page.locator('.refund-line uni-button').all()) assert.notEqual(await button.getAttribute('disabled'), null)
    assert.deepEqual((await page.locator('.refund-line .stepper > uni-text').allTextContents()).map(Number), items.map(item => item.quantity))
  }
  await shot(screenshot)
  const responseWait = page.waitForResponse(res => new URL(res.url()).pathname === '/api/aftersales' && res.request().method() === 'POST')
  await page.getByText('提交申请', { exact: true }).click()
  const response = await responseWait; assert.equal(response.status(), 201)
  const body = response.request().postDataJSON()
  assert.equal(body.orderId, order.id); assert.equal(body.type, type); assert.equal(body.amount, amount); assert.deepEqual(body.items, items)
  const { data: aftersale } = await response.json()
  const row = f.db.prepare('SELECT id,order_id,amount_cents,items,status FROM aftersales WHERE id=?').get(aftersale.id)
  assert.equal(row.amount_cents, Math.round(amount * 100)); assert.deepEqual(JSON.parse(row.items), items); assert.equal(row.status, '待审核')
  await page.locator('.aftersale-result').filter({ hasText: order.id }).filter({ hasText: aftersale.id }).waitFor()
  return { aftersale, body, row }
}
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.pathname.startsWith('/api/')) {
      const response = await fetch(`${f.base}${url.pathname.slice(4)}${url.search}`, { method: req.method(), headers: { 'Content-Type': 'application/json', ...(req.headers().authorization ? { Authorization: req.headers().authorization } : {}) }, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() })
      const body = await response.text()
      report.requests.push({ method: req.method(), path: url.pathname + url.search, status: response.status, ...(url.pathname === '/api/aftersales' && req.method() === 'POST' ? { body: req.postDataJSON() } : {}) })
      return route.fulfill({ status: response.status, body, contentType: 'application/json' })
    }
    if (url.origin === origin || url.protocol === 'data:') return route.continue()
    if (url.pathname.endsWith('/jsvm_all.js')) return route.fulfill({ body: '', contentType: 'application/javascript' })
    return route.abort()
  })
  page = await context.newPage()
  page.on('pageerror', error => report.consoleErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
  page.on('requestfailed', req => report.failedRequests.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText, expectedNavigationAbort: navigating && req.failure()?.errorText === 'net::ERR_ABORTED' }))
  await goto('/pages/index/index?screen=auth')
  await page.locator('#auth-phone input').fill(f.sessions.customer.profile.phone)
  await page.locator('#auth-password input').fill(password)
  if (await page.locator('.uni-checkbox-input svg').count() === 0) await page.locator('.consent-toggle').click()
  await page.locator('.auth-submit').click(); await page.waitForFunction(() => !document.querySelector('.auth-submit'))

  const coupon = await f.ok('/admin/coupons', 'POST', { name: '会员可领取验收券', type: '满减券', discount: 3, minimum: 20, totalQuantity: 10, status: '启用' }, 'admin')
  await goto('/pages/member/index?screen=membership')
  const account = await f.ok('/account')
  await page.locator('.member-level').getByText(account.level, { exact: true }).waitFor()
  assert.doesNotMatch(await page.locator('.member-scroll').innerText(), /优先派单|专属客服|专属优惠|自动发放|直接抵扣/)
  assert.match(await page.locator('.benefit-card').innerText(), /自行领取或积分兑换/)
  assert.match(await page.locator('.member-card').innerText(), new RegExp(`积分 ${account.points}`))
  await shot('member-real-benefits')
  await page.locator('.asset-nav').getByText('商城', { exact: true }).click()
  const couponCard = page.locator('.gift-card').filter({ hasText: coupon.name })
  const claim = page.waitForResponse(res => new URL(res.url()).pathname === `/api/coupons/${coupon.id}/claim`)
  await couponCard.click(); assert.equal((await claim).status(), 201)
  await couponCard.getByText('已领取 · 可抵 ¥3.00', { exact: true }).waitFor()
  const couponRow = f.db.prepare('SELECT coupon_id,status FROM customer_coupons WHERE coupon_id=? AND customer_id=?').get(coupon.id, f.customerId)
  assert.equal(couponRow.status, '未使用')
  await goto('/pages/member/index?screen=points')
  await page.locator('.gift-card').filter({ hasText: coupon.name }).getByText('已领取 · 可抵 ¥3.00', { exact: true }).waitFor()
  await shot('member-coupon-persisted')
  report.cases.push({ id: 'X07-member-benefits-real-coupon', status: 'PASS', account: { level: account.level, points: account.points }, couponRow })

  for (const [status, type] of [['待配送', '仅退款'], ['配送中', '退货退款']]) {
    const order = await f.createOrder(`browser-${status}-${type}`, { status }), stockBefore = stock(order.id)
    await openRefund(order)
    assert.match(await page.locator('.refund-rule').innerText(), /未签收订单仅支持整单退款/)
    assert.match(await page.locator('.radio-line').filter({ hasText: '补送' }).innerText(), /签收后/)
    const items = type === '退货退款' ? selectedItems(order) : []
    const submitted = await submitAndAssert(order, { type, amount: order.aftersalePolicy.remainingAmount, items, locked: true, screenshot: `undelivered-${type}` })
    await openRefund(await f.ok(`/orders/${order.id}`))
    await page.getByText('退款处理中', { exact: true }).waitFor()
    assert.notEqual(await page.getByText('退款处理中', { exact: true }).getAttribute('disabled'), null)
    const balanceBefore = (await f.ok('/account')).balance
    await f.completeAftersale(submitted.aftersale.id)
    const after = await f.ok(`/orders/${order.id}`), balanceAfter = (await f.ok('/account')).balance
    assert.equal(after.status, '已取消'); assert.equal(after.refundedAmount, order.amount)
    assert.equal(Math.round((balanceAfter - balanceBefore) * 100), Math.round(order.amount * 100))
    if (type === '仅退款') assert.deepEqual(stock(order.id), stockBefore)
    else assert.ok(stock(order.id).every(row => row.status === '已回补'))
    report.cases.push({ id: `X09-${status}-${type}`, status: 'PASS', request: submitted.body, persisted: submitted.row, finalStatus: after.status, allocations: stock(order.id) })

    if (type === '仅退款') {
      assert.equal(after.aftersalePolicy.allowZeroAmountReturn, true)
      await openRefund(after)
      const zero = await submitAndAssert(after, { type: '退货退款', amount: 0, items: selectedItems(after), locked: true, screenshot: 'cancelled-zero-remaining-goods' })
      const unchangedBalance = (await f.ok('/account')).balance
      await f.completeAftersale(zero.aftersale.id)
      assert.equal((await f.ok('/account')).balance, unchangedBalance)
      assert.ok(stock(order.id).every(row => row.status === '已回补'))
      report.cases.push({ id: 'X09-cancelled-zero-return', status: 'PASS', request: zero.body, allocations: stock(order.id), balanceUnchanged: true })
    }
  }

  const delivered = await f.createOrder('browser-delivered-partial', { status: '已完成' })
  await openRefund(delivered)
  await page.locator('.radio-line').getByText('退货退款', { exact: true }).click()
  await page.locator('.refund-line').nth(0).getByText('－', { exact: true }).click()
  await page.locator('.refund-line').nth(1).getByText('－', { exact: true }).click()
  const partialItems = [{ skuCode: 'water-18_9l', quantity: 1 }]
  // Already selected quantities must survive; clicking the same option resets the form.
  const partialInput = page.locator('.refund-amount-input input'); await partialInput.fill('29.95')
  await shot('delivered-partial-return')
  const partialResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/api/aftersales' && res.request().method() === 'POST')
  await page.getByText('提交申请', { exact: true }).click()
  const partialRes = await partialResponse; assert.equal(partialRes.status(), 201)
  assert.deepEqual(partialRes.request().postDataJSON().items, partialItems)
  const partial = (await partialRes.json()).data
  await f.completeAftersale(partial.id)
  const afterPartial = await f.ok(`/orders/${delivered.id}`)
  assert.equal(afterPartial.status, '已完成'); assert.equal(afterPartial.refundedAmount, 29.95)
  assert.deepEqual(afterPartial.aftersalePolicy.returnItems.map(item => item.quantity), [1, 1])
  report.cases.push({ id: 'X09-delivered-partial-preserved', status: 'PASS', request: partialRes.request().postDataJSON(), remaining: afterPartial.aftersalePolicy })
  // Explicit historical fixture: retain real completed refund/stock records, change only delivery status.
  f.db.prepare("UPDATE orders SET status='已取消',dispatch_status='已取消' WHERE id=?").run(delivered.id)
  const legacy = await f.ok(`/orders/${delivered.id}`)
  await openRefund(legacy)
  const remaining = await submitAndAssert(legacy, { type: '退货退款', amount: legacy.aftersalePolicy.remainingAmount, items: selectedItems(legacy), locked: true, screenshot: 'historical-remaining-items' })
  await f.completeAftersale(remaining.aftersale.id)
  const returns = f.db.prepare("SELECT sku_id,SUM(quantity) quantity FROM inventory_movements WHERE ref_type='售后退货' AND ref_id IN (SELECT id FROM aftersales WHERE order_id=?) GROUP BY sku_id ORDER BY sku_id").all(delivered.id)
  assert.deepEqual(returns.map(row => row.quantity), [2, 1])
  report.cases.push({ id: 'X09-historical-remaining-only', status: 'PASS', fixture: 'real delivered partial return, then SQL delivery-status-only change to cancelled historical fixture; remaining money keeps entry reachable', request: remaining.body, cumulativeReturned: returns })

  const ticket = (await f.ok('/admin/electronic-tickets', 'POST', { customerId: f.customerId, skuCode: 'water-18_9l', count: 1, expiresAt: '2099-01-01T00:00:00.000Z' }, 'admin'))[0]
  const ticketOrder = await f.createOrder('browser-ticket-zero', { items: [{ sku: 'water-18_9l', quantity: 1 }], tickets: [{ type: '电子票', code: ticket.id }] })
  assert.equal(ticketOrder.amount, 0); assert.equal(ticketOrder.aftersalePolicy.allowZeroAmountReturn, true)
  await openRefund(ticketOrder)
  assert.match(await page.locator('.refund-rule').innerText(), /返还水票/)
  const ticketReturn = await submitAndAssert(ticketOrder, { type: '退货退款', amount: 0, items: selectedItems(ticketOrder), locked: true, screenshot: 'ticket-zero-return' })
  await f.completeAftersale(ticketReturn.aftersale.id)
  const ticketRow = f.db.prepare('SELECT id,status FROM electronic_tickets WHERE id=?').get(ticket.id)
  assert.equal(ticketRow.status, '可用'); assert.ok(stock(ticketOrder.id).every(row => row.status === '已回补'))
  await goto('/pages/order/index?screen=aftersales')
  await page.locator('.aftersale-result').filter({ hasText: ticketOrder.id }).getByText('已完成', { exact: true }).waitFor()
  await shot('refund-result-after-reentry')
  report.cases.push({ id: 'X09-ticket-zero-return', status: 'PASS', request: ticketReturn.body, ticket: ticketRow, allocations: stock(ticketOrder.id) })
  assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors))
  assert.equal(report.failedRequests.filter(item => !item.expectedNavigationAbort).length, 0, JSON.stringify(report.failedRequests))
  assert.equal(report.requests.filter(item => item.status >= 400).length, 0)
} catch (error) { report.error = error.stack; process.exitCode = 1; if (page) await shot(`failure-${Date.now()}`).catch(() => {}) }
finally {
  navigating = true; await browser.close(); await f.close()
  report.finishedAt = new Date().toISOString(); report.status = report.error ? 'FAIL' : 'PASS'
  await writeFile(`${evidence}/browser-${Date.now()}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases, error: report.error, consoleErrors: report.consoleErrors, failedRequests: report.failedRequests }, null, 2))
}
