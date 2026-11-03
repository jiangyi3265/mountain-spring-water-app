import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// ---------- 1. 多商品购物车一次结算 + 水站配送费 ----------
const station = (await api('/admin/stations', { role: 'admin' })).find(item => item.name === '中央站')
await api(`/admin/stations/${station.id}`, { method: 'PUT', role: 'admin', body: { ...station, deliveryFee: 5, freeDeliveryOver: 60 } })
await navigate('pages/index/index?screen=home')
await evaluate(`localStorage.removeItem('mountain-spring-cart');localStorage.removeItem('mountain-spring-checkout')`)
await navigate('pages/index/index?screen=home')
await waitFor(`document.querySelectorAll('.product-card').length >= 2`, '商城首页至少两种真实商品')
const picked = await evaluate(`[...document.querySelectorAll('.product-card .grid-name')].slice(0,2).map(n=>n.textContent.trim())`)
await evaluate(`document.querySelectorAll('.product-card .grid-price uni-button')[0].click()`)
await delay(200)
await evaluate(`document.querySelectorAll('.product-card .grid-price uni-button')[1].click()`)
await waitFor(`(()=>{try{const raw=localStorage.getItem('mountain-spring-cart');return raw&&raw.split('"sku"').length>=3}catch{return false}})()`, '两种商品加入购物车')
await evaluate(`[...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('购物车')).click()`)
await waitFor(`Boolean(document.querySelector('.cart-settle uni-button:not([disabled])'))`, '购物车可结算')
await evaluate(`document.querySelector('.cart-settle uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '确认订单'`, '多商品进入同一张确认订单')
await waitFor(`document.querySelectorAll('.goods-card .goods-line').length === 2`, '确认页列出两种商品')
assert(picked.every(name => true && name), '首页商品名称可读取')
await waitFor(`Boolean(document.querySelector('.delivery-fee-row')) && !document.querySelector('.delivery-fee-row').textContent.includes('计算中')`, '服务端报价返回配送费')
const confirmText = await evaluate(`document.querySelector('.goods-card').innerText`)
const bottomTotal = Number((await evaluate(`document.querySelector('.bottom-action .ui-strong').textContent`)).replace(/[^\d.]/g, ''))
const quote = await api('/orders/preview', { method: 'POST', body: { items: await evaluate(`JSON.parse(localStorage.getItem('mountain-spring-checkout')).data?.items?.map(i=>({sku:i.sku,quantity:i.qty})) || JSON.parse(localStorage.getItem('mountain-spring-checkout')).items.map(i=>({sku:i.sku,quantity:i.qty}))`) } })
assert(Math.abs(bottomTotal - quote.amount) < 0.001, `确认页合计 ¥${bottomTotal} 与服务端报价 ¥${quote.amount} 一致`)
assert(quote.deliveryFee === 5 ? confirmText.includes('¥5.00') : confirmText.includes('免配送费'), `配送费展示与服务端规则一致（${quote.deliveryFee}）`)
await screenshot('fourth-multi-item-confirm')
await evaluate(`document.querySelector('.bottom-action uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '收银台'`, '进入收银台')
await evaluate(`document.querySelector('.single-action uni-button').click()`)
await waitFor(`Boolean(document.querySelector('.success-title'))`, '多商品订单支付成功')
const multiOrderId = await evaluate(`document.body.innerText.match(/DD[0-9]{12,}/)?.[0] || ''`)
const multiOrder = await api(`/orders/${encodeURIComponent(multiOrderId)}`)
assert(multiOrder.items.length === 2 && multiOrder.payStatus === '已支付', '同一订单保存两条商品明细并已支付')
assert(Math.abs(multiOrder.amount - quote.amount) < 0.001 && multiOrder.deliveryFee === quote.deliveryFee, '订单实付与配送费快照等于结算页报价')
const cartAfter = await evaluate(`localStorage.getItem('mountain-spring-cart') || ''`)
assert(!cartAfter.includes('"sku"'), '已结算商品从购物车移除')

// ---------- 2. 在线充值（本地联调为模拟支付，生产为微信支付回调入账） ----------
await api('/admin/recharge-packages', { method: 'POST', role: 'admin', body: { name: '充50送5', amount: 50, bonus: 5, sortOrder: 1 } })
const before = await api('/account')
await navigate('pages/member/index?screen=recharge')
await waitFor(`Boolean(document.querySelector('.recharge-option'))`, '充值套餐加载')
await evaluate(`[...document.querySelectorAll('.recharge-option')].find(n=>n.textContent.includes('50')).click()`)
await evaluate(`document.querySelector('.main-button').click()`)
let after = before
for (let attempt = 0; attempt < 40; attempt += 1) { after = await api('/account'); if (Math.abs(after.balance - before.balance - 55) < 0.001) break; await delay(150) }
assert(Math.abs(after.balance - before.balance - 55) < 0.001, '在线充值 50 元含赠送 5 元到账')
await waitFor(`[...document.querySelectorAll('.balance-record')].some(n=>n.textContent.includes('已支付'))`, '充值记录显示已支付')
await screenshot('fourth-recharge')

// ---------- 3. 送水员上门收票（仅未付款货到付款订单），应收实时试算 ----------
const batch = await api('/ticket-batches', { method: 'POST', role: 'admin', body: { prefix: `E${String(Date.now()).slice(-3)}`, start: 1, end: 2, station: '中央站', customerId: 'customer-001', note: 'E2E 上门收票' } })
const address = `E2E收票测试地址 ${Date.now()} 号`
const cod = await api('/orders', { method: 'POST', body: { idempotencyKey: `e2e-cod-${Date.now()}`, items: [{ sku: 'water-18_9l', quantity: 1 }], payment: '货到付款', address } })
await api(`/orders/${cod.id}/pay`, { method: 'POST', body: {} })
await api(`/orders/${cod.id}/assign`, { method: 'POST', role: 'admin', body: { courierId: 'courier-001' } })
await api(`/orders/${cod.id}/accept`, { method: 'POST', role: 'courier', body: {} })
await navigate('pages/delivery/index?screen=login')
await evaluate(`(() => { const inputs=document.querySelectorAll('.login-form input');const set=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))};set(inputs[0],'13812345678');set(inputs[1],'123456') })()`)
await evaluate(`(()=>{const t=document.querySelector('.consent-toggle');if(t&&!document.querySelector('.consent-notice .uni-checkbox-input svg'))t.click()})()`)
await evaluate(`document.querySelector('.login-form uni-button').click()`)
await waitFor(`Boolean(document.querySelector('.work-scroll'))`, '送水员登录工作台')
assert(!(await evaluate('document.body.innerText')).includes('未接入'), '工作台不再展示未接入的假功能入口')
await evaluate(`[...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('订单')).click()`)
await waitFor(`Boolean([...document.querySelectorAll('.simple-order')].find(n=>n.textContent.includes(${JSON.stringify(address)})))`, '送水员订单列表出现货到付款订单')
await evaluate(`[...document.querySelectorAll('.simple-order')].find(n=>n.textContent.includes(${JSON.stringify(address)})).click()`)
await waitFor(`Boolean(document.querySelector('.delivery-state'))`, '进入配送详情')
assert((await evaluate('document.body.innerText')).includes('货到付款应收'), '配送详情显示货到付款应收金额')
await evaluate(`[...document.querySelectorAll('.double-action uni-button')].find(n=>n.textContent.includes('确认送达')).click()`)
await waitFor(`Boolean(document.querySelector('.sign-options'))`, '进入签收方式')
await evaluate(`[...document.querySelectorAll('.sign-options > uni-view')].find(n=>n.textContent.includes('上门收票')).click()`)
await waitFor(`Boolean(document.querySelector('.ticket-input input'))`, '显示收票录入')
await evaluate(`(() => { const input=document.querySelector('.ticket-input input');input.value=${JSON.stringify(batch.firstTicket)};input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await evaluate(`document.querySelector('.add-ticket').click()`)
await waitFor(`document.querySelector('.ticket-form')?.innerText.includes('应收 ¥0.00')`, '收一张票后试算应收 ¥0.00（整单抵扣免配送费）')
await screenshot('fourth-courier-ticket')
// 2026-09-28 接手复核 T19：签收页展示本次签收订单并需显式勾选确认（默认不勾选），防止签错单。
assert((await evaluate(`document.querySelector('.sign-target')?.innerText || ''`)).includes(cod.id), '签收页核对卡片显示本次签收的订单号')
await evaluate(`document.querySelector('.confirm-check').click()`)
await evaluate(`document.querySelector('.single-action uni-button').click()`)
let signed = null
for (let attempt = 0; attempt < 40; attempt += 1) { signed = await api(`/orders/${cod.id}`); if (signed.status === '已完成') break; await delay(150) }
assert(signed.status === '已完成' && signed.amount === 0 && signed.payment === '水票支付', '签收完成，水票抵扣后应收为 0')
const paidAttempt = await fetch(`${apiBase}/courier/ticket-redemptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.courier}` }, body: JSON.stringify({ orderId: multiOrderId, tickets: [{ type: '纸质票', code: batch.lastTicket }] }) })
assert(paidAttempt.status >= 400, '已付款订单不能再收水票')

// ---------- 4. 客户申请补送 → 后台通过自动生成补送单 → 客户可见补送进度 ----------
await navigate('pages/order/index?screen=orders')
await waitFor(`Boolean([...document.querySelectorAll('.order-card')].find(n=>n.textContent.includes(${JSON.stringify(cod.id)})))`, '客户订单列表出现已签收订单')
await evaluate(`[...document.querySelectorAll('.order-card')].find(n=>n.textContent.includes(${JSON.stringify(cod.id)})).click()`)
await waitFor(`Boolean([...document.querySelectorAll('.double-action uni-button')].find(n=>n.textContent.includes('申请售后')))`, '已完成订单可申请售后')
await evaluate(`[...document.querySelectorAll('.double-action uni-button')].find(n=>n.textContent.includes('申请售后')).click()`)
await waitFor(`Boolean([...document.querySelectorAll('.radio-line')].find(n=>n.textContent.includes('补送')))`, '售后类型包含补送')
await evaluate(`[...document.querySelectorAll('.radio-line')].find(n=>n.textContent.includes('补送')).click()`)
await waitFor(`Boolean(document.querySelector('.refund-lines'))`, '补送选择商品数量')
await evaluate(`document.querySelector('.single-action uni-button').click()`)
await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '售后进度'`, '提交后进入售后进度')
const sale = (await api('/aftersales')).find(item => item.orderId === cod.id && item.type === '补送')
assert(Boolean(sale) && sale.items.length === 1, '补送售后按商品数量保存')
const approved = await api(`/admin/aftersales/${sale.id}/status`, { method: 'PUT', role: 'admin', body: { status: '已通过' } })
assert(/^DD\d{12}$/.test(approved.replacementOrderId || ''), '后台审核通过自动生成补送单')
await navigate('pages/order/index?screen=aftersales')
await waitFor(`document.body.innerText.includes(${JSON.stringify(approved.replacementOrderId)})`, '客户售后进度可见补送单')
await screenshot('fourth-replacement')

// 恢复默认配送费，避免影响后续其他验收脚本的金额断言。
await api(`/admin/stations/${station.id}`, { method: 'PUT', role: 'admin', body: { ...station, deliveryFee: 0, freeDeliveryOver: 0 } })
if (browserErrors.length) console.log('INFO  browser errors ' + JSON.stringify(browserErrors))
assert(browserErrors.length === 0, '第四轮流程无浏览器运行时错误')
const unexpected = apiFailures.filter(item => !item.includes('/courier/ticket-redemptions'))
if (unexpected.length) console.log('INFO  API failures ' + JSON.stringify(unexpected))
assert(unexpected.length === 0, '第四轮流程没有意外失败的 API 请求')
console.log('Fourth-round mobile smoke completed.')
} finally {
  if (socket.readyState < WebSocket.CLOSING) socket.close()
  await delay(50)
}
