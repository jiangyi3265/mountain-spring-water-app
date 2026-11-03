import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { OrderStore } from '../../water-api/lib/order-store.mjs'
import { createBusinessStore } from '../../water-api/lib/business-store.mjs'
import { seedLegacyAftersale } from '../../water-api/test/legacy-aftersale-fixture.mjs'
// Log.enable 会回放同一页面此前检查留下的日志；只统计本脚本开始之后的浏览器错误，避免把上一个检查的错误算到本检查。
const qaScriptStartedAt = Date.now()

const endpoint = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9225')
const baseUrl = process.env.MOBILE_URL || 'http://127.0.0.1:4174'
const apiBase = process.env.API_BASE || 'http://127.0.0.1:18090/api'
const outputDir = resolve(process.env.QA_EVIDENCE_DIR || 'qa')
mkdirSync(outputDir, { recursive: true })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tokens = {}
const api = async (path, { method = 'GET', role = 'customer', body } = {}) => {
  if (!tokens[role]) {
    const response = await fetch(`${apiBase}/auth/demo-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, ...(role === 'courier' ? { phone: '13812345678' } : {}) }) })
    const payload = await response.json()
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || `${role} 验收登录失败`)
    tokens[role] = payload.data.token
  }
  const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` }, body: body ? JSON.stringify(body) : undefined })
  const payload = await response.json()
  if (!response.ok || payload.code !== 0) throw new Error(payload.message || `${method} ${path} 失败`)
  return payload.data
}
const pages = await fetch(endpoint + '/json').then((response) => response.json())
const target = pages.find((page) => page.type === 'page')
if (!target) throw new Error('No browser page target found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let id = 0
const pending = new Map()
const browserErrors = []
const apiFailures = []
const requests = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !(message.params.entry.timestamp < qaScriptStartedAt)) browserErrors.push(message.params.entry.text)
  if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url)
  if (message.method === 'Network.responseReceived') {
    const { response } = message.params
    if (response.status >= 400 && response.url.includes('/api/')) apiFailures.push(`${response.status} ${response.url}`)
  }
  if (message.method === 'Network.loadingFailed') {
    const url = requests.get(message.params.requestId) || ''
    if (url.includes('/api/')) apiFailures.push(`${message.params.errorText} ${url}`)
  }
  if (!message.id || !pending.has(message.id)) return
  const task = pending.get(message.id)
  pending.delete(message.id)
  message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id
  pending.set(requestId, { resolve, reject })
  socket.send(JSON.stringify({ id: requestId, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const navigate = async (hash) => {
  await send('Page.navigate', { url: baseUrl + '/?qa=' + Date.now() + '#/' + hash })
  const expectedPath = hash.split('?')[0]
  await delay(120)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(100)
    if (await evaluate(`document.readyState === "complete" && location.hash.includes(${JSON.stringify(expectedPath)}) && Boolean(document.querySelector("uni-page-body"))`)) {
      await delay(500)
      return
    }
  }
  throw new Error('Route did not load: ' + hash)
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log('PASS  ' + message)
}
const waitFor = async (expression, message, attempts = 50) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`等待超时：${message}`)
}
const screenshot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(outputDir, name + '.png'), Buffer.from(result.data, 'base64'))
}

try {
await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

await navigate('pages/index/index?screen=home')
await evaluate(`localStorage.removeItem('mountain-spring-cart');localStorage.removeItem('mountain-spring-checkout')`)
await navigate('pages/index/index?screen=home')
await waitFor(`Boolean(document.querySelector('.product-card'))`, '真实商品目录加载完成')
assert((await evaluate('[...document.querySelectorAll(".banner-title")].map(n=>n.textContent).join("")')).includes('源自山泉'), '商城首页加载品牌主视觉')
const layout = await evaluate(`(() => { const grid=document.querySelector('.product-grid');const hero=document.querySelector('.hero-banner');return {innerWidth,body:document.body.scrollWidth,page:document.documentElement.scrollWidth,gridWidth:grid.getBoundingClientRect().width,gridRight:grid.getBoundingClientRect().right,gridBox:getComputedStyle(grid).boxSizing,heroRight:hero.getBoundingClientRect().right} })()`)
console.log('INFO  mobile layout ' + JSON.stringify(layout))
assert(layout.page <= 390 && layout.gridRight <= 390 && layout.heroRight <= 390, '商城首页在 390px 视口无横向溢出')
await screenshot('mobile-home')
await evaluate(`document.querySelector('.product-card .grid-price uni-button').click()`)
await waitFor(`Boolean(localStorage.getItem('mountain-spring-cart'))`, '真实商品加入购物车')

// Keep product A checked in the cart, then buy B from its actual detail page.
const productBName = await evaluate(`document.querySelectorAll('.product-card .grid-name')[1].textContent.trim()`)
await evaluate(`document.querySelectorAll('.product-card')[1].click()`)
await waitFor(`Boolean(document.querySelector('.detail-actions .solid-button'))`, '商品B详情购买入口')
await evaluate(`document.querySelector('.detail-actions .solid-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '确认订单'`, '详情购买进入结算')
assert((await evaluate('document.body.innerText')).includes(productBName), '详情B结算不被已勾选购物车A替换')
await screenshot('mobile-detail-buy-B')
await evaluate(`document.querySelector('.bottom-action uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '收银台'`, '详情B收银台')
await evaluate(`document.querySelector('.single-action uni-button').click()`)
await waitFor(`Boolean(document.querySelector('.success-title'))`, '详情B真实订单落库')
const detailOrderId = await evaluate(`document.body.innerText.match(/DD[0-9]{12,}/)?.[0] || ''`)
const detailOrder = await api(`/orders/${encodeURIComponent(detailOrderId)}`)
assert(detailOrder.product === productBName && detailOrder.quantity === 1, '详情商品B的订单名称和数量实际入库')
await navigate('pages/order/index?screen=orders')
await waitFor(`document.body.innerText.includes(${JSON.stringify(detailOrderId)})`, '重新进入后能查到详情购买订单')
await navigate('pages/index/index?screen=home')
await waitFor(`Boolean(document.querySelector('.quick-actions'))`, '回到首页继续购物车A回归')

await evaluate(`[...document.querySelectorAll('.quick-actions uni-view')].find((node)=>node.textContent.includes('查订单')).click()`)
await delay(250)
assert((await evaluate('location.hash')).includes('pages/order/index'), '首页订单入口可跳转')
assert(await evaluate('document.querySelector(".nav-title").textContent.trim()') === '我的订单', '订单中心正确显示')

await navigate('pages/index/index?screen=home')
await waitFor(`Boolean([...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('购物车')))`, '底部购物车入口')
await evaluate(`[...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('购物车')).click()`)
await waitFor(`Boolean(document.querySelector('.cart-settle uni-button:not([disabled])'))`, '购物车结算按钮可用')
await evaluate(`document.querySelector('.cart-settle uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '确认订单'`, '购物车进入真实订单确认页')
console.log('INFO  order route ' + await evaluate('location.hash + " | " + (document.querySelector(".nav-title")?.textContent || "no-title") + " | " + [...document.querySelectorAll("[class]")].map(n=>String(n.className)).filter(n=>n.includes("action")).join(",")'))
await screenshot('mobile-order-confirm')
await evaluate(`document.querySelector('.bottom-action uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '收银台'`, '进入收银台')
assert(await evaluate('document.querySelector(".nav-title").textContent.trim()') === '收银台', '确认订单可进入收银台')
await evaluate(`document.querySelector('.single-action uni-button').click()`)
await waitFor(`Boolean(document.querySelector('.success-title'))`, '订单支付结果落库并进入成功页')
assert(await evaluate('document.querySelector(".success-title").textContent.trim()') === '支付成功', '支付动作进入成功页')
console.log('INFO  payment result ' + await evaluate(`document.querySelector('.success-detail')?.innerText || ''`))
const paidOrderId = await evaluate(`document.body.innerText.match(/DD[0-9]{12,}/)?.[0] || ''`)
assert(Boolean(paidOrderId), '成功页显示真实订单编号')
const paidOrder = await api(`/orders/${encodeURIComponent(paidOrderId)}`)
assert(paidOrder.payStatus === '已支付' && paidOrder.status === '待配送', '支付成功对应服务端已支付且待配送状态')

// 规则变更（2026-09-28 业主决定）：纸质水票只能由水站在后台发放入账，客户不能再凭票号自助绑定。
// 原“输入 JT000238 → 确认绑定”步骤改为：说明页不再提供绑定输入框；后台发放后水票自动出现在“我的水票”。
await navigate('pages/member/index?screen=bind')
assert(!(await evaluate('Boolean(document.querySelector(".code-input"))')), '纸质水票说明页不再提供自助绑定输入框')
assert(/水站发放/.test(await evaluate('document.body.innerText')), '纸质水票说明页提示由水站发放')
const smokeCustomer = await api('/account')
const paperStart = 100000 + (Date.now() % 800000)
const paperBatch = await api('/ticket-batches', { method: 'POST', role: 'admin', body: { prefix: 'SMK', start: paperStart, end: paperStart, station: smokeCustomer.stationName, customerId: smokeCustomer.id, note: 'mobile-smoke 后台发放' } })
await navigate('pages/member/index?screen=tickets')
await evaluate(`[...document.querySelectorAll('.segment *')].find(node=>node.textContent.trim().startsWith('纸质水票'))?.click()`)
await waitFor(`document.body.innerText.includes(${JSON.stringify(paperBatch.firstTicket)})`, '后台发放的纸质水票自动出现在我的水票')
assert(Boolean(await evaluate('document.querySelector(".ticket-summary")')), '水票资产页正常显示')
await screenshot('mobile-tickets')

await evaluate(`localStorage.removeItem('mountain-spring-cart');localStorage.removeItem('mountain-spring-checkout')`)
await navigate('pages/index/index?screen=home')
await waitFor(`Boolean(document.querySelector('.product-card .grid-price uni-button'))`, '水票订单商品加载')
await evaluate(`document.querySelector('.product-card .grid-price uni-button').click()`)
await evaluate(`[...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('购物车')).click()`)
await waitFor(`Boolean(document.querySelector('.cart-settle uni-button:not([disabled])'))`, '水票订单购物车可结算')
await evaluate(`document.querySelector('.cart-settle uni-button').click()`)
await waitFor(`Boolean([...document.querySelectorAll('.discount-row')].find(node=>node.textContent.includes('水票抵扣')))`, '适用水票加载')
await evaluate(`[...document.querySelectorAll('.discount-row')].find(node=>node.textContent.includes('水票抵扣')).click()`)
await waitFor(`document.querySelector('.bottom-action')?.textContent.includes('¥0.00')`, '水票全额抵扣金额')
await evaluate(`document.querySelector('.bottom-action uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '收银台'`, '水票订单进入收银台')
assert((await evaluate(`document.body.innerText`)).includes('水票支付'), '全额抵扣只显示水票支付')
await evaluate(`document.querySelector('.single-action uni-button').click()`)
await waitFor(`Boolean(document.querySelector('.success-title'))`, '水票订单落库')
const ticketOrderId = await evaluate(`document.body.innerText.match(/DD[0-9]{12,}/)?.[0] || ''`)
assert(Boolean(ticketOrderId), '水票成功页显示真实订单编号')
const ticketOrder = await api(`/orders/${encodeURIComponent(ticketOrderId)}`)
assert(ticketOrder.payment === '水票支付' && ticketOrder.payStatus === '已支付' && ticketOrder.ticketAmount > 0, '水票订单服务端真实核销并确认支付')

const heldOrder = await api('/orders', { method: 'POST', body: { sku: 'water-18_9l', quantity: 2, payment: '余额支付', idempotencyKey: `browser-partial-return-${Date.now()}` } })
await api(`/orders/${heldOrder.id}/pay`, { method: 'POST', body: {} })
await api(`/orders/${heldOrder.id}/assign`, { method: 'POST', role: 'admin', body: { courierId: 'courier-001' } })
// This is a pre-policy historical state, no longer accepted for new requests.
// Keep the original hold/re-entry assertions using the explicit upgrade fixture.
const fixtureFile = resolve(process.env.WATER_API_DATA_FILE || '')
const fixtureRuntime = resolve(import.meta.dirname, '../../.qa-runtime')
const fixtureRelative = relative(fixtureRuntime, fixtureFile)
if (!['127.0.0.1', 'localhost'].includes(new URL(apiBase).hostname) ||
    process.env.WATER_API_DEMO_DATA_ENABLED !== 'true' || !fixtureRelative ||
    fixtureRelative.startsWith('..') || isAbsolute(fixtureRelative) ||
    fixtureFile !== resolve(outputDir, '../acceptance.sqlite')) throw new Error('Legacy fixture requires this run’s isolated acceptance.sqlite')
const legacyStore = new OrderStore({ filePath: fixtureFile, seedDemoData: false })
let partialSale
try {
  await legacyStore.init()
  partialSale = seedLegacyAftersale(createBusinessStore(legacyStore, { seedDemoData: false }), heldOrder.id, { amount: 29.95, quantity: 1 })
} finally { legacyStore.db?.close() }
const legacyReadback = await api(`/orders/${heldOrder.id}`)
assert(legacyReadback.refundedAmount === 29.95 && legacyReadback.aftersalePolicy.returnItems[0].quantity === 1, '隔离历史夹具金额及剩余商品由真实API回读')
for (let visit = 0; visit < 2; visit += 1) {
  await navigate('pages/order/index?screen=orders')
  await waitFor(`Boolean([...document.querySelectorAll('.order-card')].find(n=>n.textContent.includes(${JSON.stringify(heldOrder.id)})))`, '客户重新读取部分退货订单')
  await evaluate(`[...document.querySelectorAll('.order-card')].find(n=>n.textContent.includes(${JSON.stringify(heldOrder.id)})).click()`)
  await waitFor(`document.body.innerText.includes('已暂停配送，请人工核对剩余商品')`, '部分退货暂停原因真实展示')
  assert(await evaluate(`document.querySelector('.detail-state')?.textContent.trim() === '暂停配送' && ![...document.querySelectorAll('.double-action uni-button')].some(n=>n.textContent.trim()==='取消订单')`), '暂停状态醒目展示且不提供会重复回补库存的普通取消入口')
}
await screenshot('mobile-partial-return-hold')
const courierHeld = await api(`/orders/${heldOrder.id}`, { role: 'courier' })
assert(courierHeld.dispatchStatus === '暂停配送' && courierHeld.fulfillmentHoldReason.includes('人工核对'), '客户重入与送水员API读取同一暂停状态')

await navigate('pages/order/index?screen=orders')
await waitFor(`Boolean(document.querySelector('.aftersale-entry'))`, '订单页售后进度入口')
await evaluate(`document.querySelector('.aftersale-entry').click()`)
await waitFor(`Boolean([...document.querySelectorAll('.aftersale-result')].find(n=>n.textContent.includes(${JSON.stringify(partialSale.id)})))`, '实际售后结果显示')
assert((await evaluate(`document.body.innerText`)).includes('已完成'), '已完成售后可由客户回读')
await navigate('pages/order/index?screen=aftersales')
await waitFor(`document.body.innerText.includes(${JSON.stringify(partialSale.id)})`, '刷新重入后售后持久化结果仍可见')
await screenshot('mobile-aftersale-result')

await navigate('pages/delivery/index?screen=login')
await evaluate(`(() => { const inputs=document.querySelectorAll('.login-form input');const set=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))};set(inputs[0],'13812345678');set(inputs[1],'123456') })()`)
await evaluate(`(()=>{const t=document.querySelector('.consent-toggle');if(t&&!document.querySelector('.consent-notice .uni-checkbox-input svg'))t.click()})()`)
await evaluate(`document.querySelector('.login-form uni-button').click()`)
await waitFor(`Boolean(document.querySelector('.alert-card')) || Boolean(document.querySelector('.work-scroll'))`, '送水员登录并同步服务端资料')
const hasAlert = Boolean(await evaluate('document.querySelector(".alert-card")'))
assert(hasAlert || Boolean(await evaluate('document.querySelector(".work-scroll")')), '送水员登录后进入工作台')
await screenshot('mobile-delivery-alert')
await evaluate(hasAlert ? `document.querySelector('.alert-card uni-button').click()` : `document.querySelector('.next-card').click()`)
await waitFor(`Boolean(document.querySelector('.delivery-state'))`, '送水员接单并进入配送详情')
assert(Boolean(await evaluate('document.querySelector(".delivery-state")')), '送水员接单后进入配送详情')

await navigate('pages/delivery/index?screen=workbench')
await waitFor(`Boolean(document.querySelector('.online uni-switch'))`, '送水员服务端接单开关')
const initialOnline = Boolean((await api('/courier/profile', { role: 'courier' })).online)
await evaluate(`document.querySelector('.online uni-switch').click()`)
let toggledProfile = null
for (let attempt = 0; attempt < 30; attempt += 1) {
  toggledProfile = await api('/courier/profile', { role: 'courier' })
  if (Boolean(toggledProfile.online) !== initialOnline) break
  await delay(100)
}
assert(Boolean(toggledProfile?.online) !== initialOnline, '暂停接单开关真实更新服务端在线状态')
await evaluate(`document.querySelector('.online uni-switch').click()`)
for (let attempt = 0; attempt < 30; attempt += 1) {
  toggledProfile = await api('/courier/profile', { role: 'courier' })
  if (Boolean(toggledProfile.online) === initialOnline) break
  await delay(100)
}
assert(Boolean(toggledProfile?.online) === initialOnline, '验收结束后恢复送水员原在线状态')

if (browserErrors.length) console.log('INFO  browser errors ' + JSON.stringify(browserErrors))
assert(browserErrors.length === 0, '核心流程无浏览器运行时错误')
if (apiFailures.length) console.log('INFO  API failures ' + JSON.stringify(apiFailures))
assert(apiFailures.length === 0, '核心流程没有失败的 API 请求')
console.log('Mobile interaction smoke test completed.')
} finally {
  if (socket.readyState < WebSocket.CLOSING) socket.close()
  await delay(50)
}
