import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const endpoint = `http://127.0.0.1:${process.env.CDP_PORT || '9225'}`
const baseUrl = process.env.MOBILE_URL || 'http://127.0.0.1:4174'
const apiBase = process.env.API_BASE || 'http://127.0.0.1:18090/api'
const outputDir = resolve(process.env.QA_EVIDENCE_DIR || 'qa')
mkdirSync(outputDir, { recursive: true })
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

const targets = await fetch(`${endpoint}/json`).then(response => response.json())
const target = targets.find(item => item.type === 'page')
if (!target) throw new Error('No browser page target found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})
let sequence = 0
const pending = new Map()
const runtimeExceptions = []
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.method === 'Runtime.exceptionThrown') runtimeExceptions.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeExceptions.push(message.params.entry.text)
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
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async (expression, label, attempts = 80) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`等待超时：${label}`)
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`PASS  ${message}`)
}
const shot = async name => {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(outputDir, `${name}.png`), Buffer.from(result.data, 'base64'))
}

try {
await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Network.setBlockedURLs', { urls: [`${apiBase}/catalog/*`] })
await send('Page.navigate', { url: `${baseUrl}/?failure=${Date.now()}#/pages/index/index?screen=home` })
await waitFor(`Boolean(document.querySelector('.retry-button'))`, '商品接口失败空态')
assert(await evaluate(`document.querySelectorAll('.product-card').length === 0`), '商品接口失败时不展示硬编码商品')
assert((await evaluate(`document.body.innerText`)).includes('商品暂时无法加载'), '商品接口失败时展示可重试错误态')
await shot('mobile-catalog-failure-safe')

await send('Network.setBlockedURLs', { urls: [`${apiBase}/orders*`] })
await send('Page.navigate', { url: `${baseUrl}/?failure=${Date.now()}#/pages/order/index?screen=orders` })
await waitFor(`Boolean(document.querySelector('.sync-warning'))`, '订单接口失败提示')
assert(await evaluate(`document.querySelectorAll('.order-card').length === 0`), '订单接口失败时不展示硬编码订单')
assert((await evaluate(`document.querySelector('.sync-warning')?.innerText || ''`)).includes('订单加载失败'), '订单接口失败明确报错，不伪装暂无订单')
assert(!(await evaluate(`document.body.innerText`)).includes('暂无订单'), '未知订单数据不能显示确认为空')
await shot('mobile-orders-failure-safe')
await send('Network.setBlockedURLs', { urls: [] })
await evaluate(`Array.from(document.querySelectorAll('button,uni-button')).find(b=>b.innerText.includes('重试加载订单')).click()`)
await waitFor(`!document.querySelector('.sync-warning')`, '重试成功清除错误提示')
await send('Network.setBlockedURLs', { urls: [`${apiBase}/account*`] })
await send('Page.navigate', { url: `${baseUrl}/?failure=${Date.now()}#/pages/member/index?screen=balance` })
await waitFor(`Boolean(document.querySelector('.asset-error'))`, '资产读取失败提示')
assert(await evaluate(`!document.querySelector('.balance-hero')`), '资产读取失败不展示伪0余额')
await shot('mobile-assets-failure-safe')
await send('Network.setBlockedURLs', { urls: [] })
await evaluate(`document.querySelector('.asset-error uni-button, .asset-error button').click()`)
await waitFor(`Boolean(document.querySelector('.balance-hero'))&&!document.querySelector('.asset-error')`, '资产重试恢复真实余额')
assert(runtimeExceptions.length === 0, '失败场景没有未处理的浏览器异常或控制台错误')
console.log('Mobile failure-mode smoke test completed.')
} finally {
  if (socket.readyState < WebSocket.CLOSING) socket.close()
  await delay(50)
}
