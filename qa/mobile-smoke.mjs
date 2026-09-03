import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const endpoint = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9225')
const baseUrl = process.env.MOBILE_URL || 'http://127.0.0.1:4174'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text)
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
const screenshot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve('qa', name + '.png'), Buffer.from(result.data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

await navigate('pages/index/index?screen=home')
assert((await evaluate('[...document.querySelectorAll(".banner-title")].map(n=>n.textContent).join("")')).includes('源自山泉'), '商城首页加载品牌主视觉')
const layout = await evaluate(`(() => { const grid=document.querySelector('.product-grid');const hero=document.querySelector('.hero-banner');return {innerWidth,body:document.body.scrollWidth,page:document.documentElement.scrollWidth,gridWidth:grid.getBoundingClientRect().width,gridRight:grid.getBoundingClientRect().right,gridBox:getComputedStyle(grid).boxSizing,heroRight:hero.getBoundingClientRect().right} })()`)
console.log('INFO  mobile layout ' + JSON.stringify(layout))
assert(layout.page <= 390 && layout.gridRight <= 390 && layout.heroRight <= 390, '商城首页在 390px 视口无横向溢出')
await screenshot('mobile-home')

await evaluate(`[...document.querySelectorAll('.quick-actions uni-view')].find((node)=>node.textContent.includes('查订单')).click()`)
await delay(250)
assert((await evaluate('location.hash')).includes('pages/order/index'), '首页订单入口可跳转')
assert(await evaluate('document.querySelector(".nav-title").textContent.trim()') === '我的订单', '订单中心正确显示')

await navigate('pages/order/index?screen=confirm')
console.log('INFO  order route ' + await evaluate('location.hash + " | " + (document.querySelector(".nav-title")?.textContent || "no-title") + " | " + [...document.querySelectorAll("[class]")].map(n=>String(n.className)).filter(n=>n.includes("action")).join(",")'))
await screenshot('mobile-order-confirm')
await evaluate(`document.querySelector('.bottom-action uni-button').click()`)
await delay(100)
assert(await evaluate('document.querySelector(".nav-title").textContent.trim()') === '收银台', '确认订单可进入收银台')
await evaluate(`document.querySelector('.single-action uni-button').click()`)
await delay(100)
assert(await evaluate('document.querySelector(".success-title").textContent.trim()') === '支付成功', '支付动作进入成功页')

await navigate('pages/member/index?screen=bind')
await evaluate(`(() => { const input=document.querySelector('.code-input input');input.value='JT000238';input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await evaluate(`document.querySelector('.main-button').click()`)
await delay(750)
assert(Boolean(await evaluate('document.querySelector(".ticket-summary")')), '纸质水票绑定后返回水票资产页')
await screenshot('mobile-tickets')

await navigate('pages/delivery/index?screen=login')
await evaluate(`(() => { const input=document.querySelector('.login-form input');input.value='13812345678';input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
await evaluate(`document.querySelector('.login-form uni-button').click()`)
await delay(600)
const hasAlert = Boolean(await evaluate('document.querySelector(".alert-card")'))
assert(hasAlert || Boolean(await evaluate('document.querySelector(".work-scroll")')), '送水员登录后进入工作台')
await screenshot('mobile-delivery-alert')
await evaluate(hasAlert ? `document.querySelector('.alert-card uni-button').click()` : `document.querySelector('.next-card').click()`)
await delay(100)
assert(Boolean(await evaluate('document.querySelector(".delivery-state")')), '送水员接单后进入配送详情')

if (browserErrors.length) console.log('INFO  browser errors ' + JSON.stringify(browserErrors))
assert(browserErrors.length === 0, '核心流程无浏览器运行时错误')
socket.close()
console.log('Mobile interaction smoke test completed.')
