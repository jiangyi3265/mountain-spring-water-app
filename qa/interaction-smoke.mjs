import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Log.enable 会回放同一页面此前检查留下的日志；只统计本脚本开始之后的浏览器错误，避免把上一个检查的错误算到本检查。
const qaScriptStartedAt = Date.now()

const endpoint = `http://127.0.0.1:${process.env.CDP_PORT || '9225'}`
const baseUrl = process.env.MOBILE_URL || 'http://127.0.0.1:4174'
const outputDir = resolve(process.env.QA_EVIDENCE_DIR || 'qa')
mkdirSync(outputDir, { recursive: true })
const delay = ms => new Promise(done => setTimeout(done, ms))
const targets = await fetch(`${endpoint}/json`).then(response => response.json())
const target = targets.find(item => item.type === 'page')
if (!target) throw new Error('No browser page target found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((done, fail) => {
  socket.addEventListener('open', done, { once: true })
  socket.addEventListener('error', fail, { once: true })
})
let id = 0
const pending = new Map()
const browserErrors = []
const apiFailures = []
const requests = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !(message.params.entry.timestamp < qaScriptStartedAt)) browserErrors.push(message.params.entry.text)
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
  const requestId = ++id
  pending.set(requestId, { resolve: resolveSend, reject: rejectSend })
  socket.send(JSON.stringify({ id: requestId, method, params }))
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
const open = async route => {
  await send('Page.navigate', { url: `${baseUrl}/?smoke=${Date.now()}#/${route}` })
  await waitFor(`document.readyState === 'complete' && location.hash.includes(${JSON.stringify(route.split('?')[0])}) && Boolean(document.querySelector('uni-page-body'))`, route)
  await delay(450)
}
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

  await open('pages/index/index?screen=home')
  await evaluate(`localStorage.removeItem('mountain-spring-cart');localStorage.removeItem('mountain-spring-checkout')`)
  await open('pages/index/index?screen=home')
  await waitFor(`Boolean(document.querySelector('.grid-price uni-button'))`, '真实商品目录')
  await evaluate(`document.querySelector('.grid-price uni-button').click()`)
  await waitFor(`document.querySelector('.mobile-toast')?.textContent.trim() === '已加入购物车'`, '加入购物车反馈')
  check('首页加入购物车反馈', true, '已加入购物车')

  await open('pages/index/index?screen=cart')
  const totalBefore = Number(await evaluate(`document.querySelector('.cart-settle .ui-strong')?.textContent?.replace(/[^0-9.]/g,'') || '0'`))
  await evaluate(`document.querySelector('.cart-item .stepper uni-button:last-child').click()`)
  await delay(120)
  const totalAfter = Number(await evaluate(`document.querySelector('.cart-settle .ui-strong')?.textContent?.replace(/[^0-9.]/g,'') || '0'`))
  check('购物车数量变化会实时重算金额', totalAfter > totalBefore, `${totalBefore} -> ${totalAfter}`)
  await open('pages/index/index?screen=cart')
  const totalAfterRefresh = Number(await evaluate(`document.querySelector('.cart-settle .ui-strong')?.textContent?.replace(/[^0-9.]/g,'') || '0'`))
  check('购物车刷新后保持数据', totalAfterRefresh === totalAfter, `${totalAfter} -> ${totalAfterRefresh}`)
  await evaluate(`document.querySelector('.cart-settle uni-button').click()`)
  await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '确认订单'`, '确认订单')
  await evaluate(`document.querySelector('.bottom-action uni-button').click()`)
  await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '收银台'`, '收银台')
  check('真实购物车可进入收银台', true, '收银台')

  await open('pages/delivery/index?screen=login')
  await evaluate(`(() => { const inputs=document.querySelectorAll('.login-form input');const set=(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}))};set(inputs[0],'13812345678');set(inputs[1],'123456') })()`)
  await evaluate(`document.querySelector('.login-form uni-button').click()`)
  await waitFor(`Boolean(document.querySelector('.work-scroll'))`, '送水员密码登录')
  check('送水员密码登录后加载真实工作台', true, await evaluate(`document.querySelector('.work-profile')?.innerText || ''`))
  await open('pages/delivery/index?screen=workbench')
  await waitFor(`Boolean(document.querySelector('.tools > uni-view:nth-child(2)'))`, '主动签收入口')
  await evaluate(`document.querySelector('.tools > uni-view:nth-child(2)').click()`)
  await waitFor(`document.querySelector('.nav-title')?.textContent.trim() === '主动签收'`, '主动签收页面')
  const initialConfirmed = await evaluate(`Boolean(document.querySelector('.confirm-check .on'))`)
  await evaluate(`document.querySelector('.confirm-check').click()`)
  await delay(80)
  const toggledOff = await evaluate(`!document.querySelector('.confirm-check .on')`)
  check('主动签收确认状态可切换', initialConfirmed && toggledOff, `${initialConfirmed} -> ${!toggledOff}`)

  check('核心交互无浏览器控制台错误', browserErrors.length === 0, browserErrors)
  check('核心交互无失败 API 请求', apiFailures.length === 0, apiFailures)
  const failures = checks.filter(item => !item.pass)
  writeFileSync(resolve(outputDir, 'mobile-interaction-report.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), checked: checks.length, failures, checks }, null, 2)}\n`)
  console.log(JSON.stringify({ checked: checks.length, failures, checks }, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  if (socket.readyState < WebSocket.CLOSING) socket.close()
  await delay(50)
}
