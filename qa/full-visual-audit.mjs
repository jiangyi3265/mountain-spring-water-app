import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Log.enable 会回放同一页面此前检查留下的日志；只统计本脚本开始之后的浏览器错误，避免把上一个检查的错误算到本检查。
const qaScriptStartedAt = Date.now()

const endpoint = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9225')
const baseUrl = process.env.MOBILE_URL || 'http://127.0.0.1:4174'
const outputDir = resolve(process.env.QA_EVIDENCE_DIR || resolve('qa', 'audit-before'))
mkdirSync(outputDir, { recursive: true })

const screens = [
  ['shop-home', 'pages/index/index?screen=home'],
  ['shop-category', 'pages/index/index?screen=category'],
  ['shop-detail', 'pages/index/index?screen=detail'],
  ['shop-cart', 'pages/index/index?screen=cart'],
  ['shop-search', 'pages/index/index?screen=search'],
  ['shop-profile', 'pages/index/index?screen=profile'],
  ['order-confirm', 'pages/order/index?screen=confirm'],
  ['order-checkout', 'pages/order/index?screen=checkout'],
  ['order-success', 'pages/order/index?screen=success'],
  ['order-list', 'pages/order/index?screen=orders'],
  ['order-detail', 'pages/order/index?screen=detail'],
  ['order-refund', 'pages/order/index?screen=refund'],
  ['member-tickets', 'pages/member/index?screen=tickets'],
  ['member-ticket-detail', 'pages/member/index?screen=ticket-detail'],
  ['member-bind', 'pages/member/index?screen=bind'],
  ['member-balance', 'pages/member/index?screen=balance'],
  ['member-points', 'pages/member/index?screen=points'],
  ['member-recharge', 'pages/member/index?screen=recharge'],
  ['member-membership', 'pages/member/index?screen=membership'],
  ['delivery-login', 'pages/delivery/index?screen=login'],
  ['delivery-workbench', 'pages/delivery/index?screen=workbench'],
  ['delivery-alert', 'pages/delivery/index?screen=alert'],
  ['delivery-detail', 'pages/delivery/index?screen=delivery-detail'],
  ['delivery-sign', 'pages/delivery/index?screen=sign'],
]

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
const targets = await fetch(endpoint + '/json').then((response) => response.json())
const target = targets.find((item) => item.type === 'page')
if (!target) throw new Error('No browser page target found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})
let sequence = 0
const pending = new Map()
const runtimeErrors = []
const apiFailures = []
const requests = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !(message.params.entry.timestamp < qaScriptStartedAt)) runtimeErrors.push(message.params.entry.text)
  if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url)
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/') && message.params.response.status >= 400) apiFailures.push(`${message.params.response.status} ${message.params.response.url}`)
  if (message.method === 'Network.loadingFailed') {
    const url = requests.get(message.params.requestId) || ''
    if (url.includes('/api/')) apiFailures.push(`${message.params.errorText} ${url}`)
  }
  if (!message.id || !pending.has(message.id)) return
  const task = pending.get(message.id)
  pending.delete(message.id)
  message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
  const id = ++sequence
  pending.set(id, { resolve: resolveSend, reject: rejectSend })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

const report = []
for (const [name, route] of screens) {
  runtimeErrors.length = 0
  apiFailures.length = 0
  const url = baseUrl + '/?audit=' + Date.now() + '#/' + route
  await send('Page.navigate', { url })
  await delay(700)
  await evaluate(`(() => {
    window.scrollTo(0, 0)
    document.querySelectorAll('*').forEach((node) => {
      if (node.scrollTop) node.scrollTop = 0
    })
    document.querySelectorAll('uni-scroll-view').forEach((node) => {
      if (node.shadowRoot) {
        const scroller = node.shadowRoot.querySelector('.uni-scroll-view')
        if (scroller) scroller.scrollTop = 0
      }
    })
    return true
  })()`)
  await delay(220)
  const metrics = await evaluate(`(() => ({
    hash: location.hash,
    title: document.querySelector('.nav-title')?.textContent?.trim() || '',
    pageWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    visibleText: document.body.innerText.length
  }))()`)
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
  writeFileSync(resolve(outputDir, name + '.png'), Buffer.from(image.data, 'base64'))
  report.push({ name, route, ...metrics, runtimeErrors: [...runtimeErrors], apiFailures: [...apiFailures] })
  console.log('CAPTURED ' + name + ' ' + metrics.title)
}

writeFileSync(resolve(outputDir, 'report.json'), JSON.stringify(report, null, 2))
socket.close()
console.log('Captured ' + report.length + ' screens.')
if (report.some(item => item.runtimeErrors.length || item.apiFailures.length)) process.exitCode = 1
