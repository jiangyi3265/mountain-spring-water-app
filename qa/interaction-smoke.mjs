const endpoint = 'http://127.0.0.1:9225'
const baseUrl = 'http://127.0.0.1:4174'
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const targets = await fetch(endpoint + '/json').then((response) => response.json())
const target = targets.find((item) => item.type === 'page')
if (!target) throw new Error('No browser page target found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((done, fail) => {
  socket.addEventListener('open', done, { once: true })
  socket.addEventListener('error', fail, { once: true })
})
let id = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
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
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const open = async (route) => {
  await send('Page.navigate', { url: `${baseUrl}/?smoke=${Date.now()}#/${route}` })
  await delay(700)
}
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

await open('pages/index/index?screen=home')
await evaluate(`document.querySelector('.grid-price uni-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await delay(100)
let value = await evaluate(`document.querySelector('.mobile-toast')?.textContent?.trim() || ''`)
check('首页加入购物车反馈', value === '已加入购物车', value)

await open('pages/index/index?screen=cart')
const totalBefore = Number((await evaluate(`document.querySelector('.cart-settle .ui-strong')?.textContent?.replace(/[^0-9.]/g,'') || '0'`)))
await evaluate(`document.querySelector('.cart-item .stepper uni-button:last-child')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await delay(100)
const totalAfter = Number((await evaluate(`document.querySelector('.cart-settle .ui-strong')?.textContent?.replace(/[^0-9.]/g,'') || '0'`)))
check('购物车数量变化会实时重算金额', totalAfter > totalBefore, `${totalBefore} -> ${totalAfter}`)
await open('pages/index/index?screen=cart')
const totalAfterRefresh = Number((await evaluate(`document.querySelector('.cart-settle .ui-strong')?.textContent?.replace(/[^0-9.]/g,'') || '0'`)))
check('购物车刷新后保持数据', totalAfterRefresh === totalAfter, `${totalAfter} -> ${totalAfterRefresh}`)
const countBeforeDelete = Number(await evaluate(`document.querySelector('.cart-settle uni-button:last-child')?.textContent?.match(/[0-9]+/)?.[0] || '0'`))
await evaluate(`document.querySelector('.cart-item .remove-item')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await delay(100)
const countAfterDelete = Number(await evaluate(`document.querySelector('.cart-settle uni-button:last-child')?.textContent?.match(/[0-9]+/)?.[0] || '0'`))
check('购物车删除会更新结算数量', countAfterDelete < countBeforeDelete, `${countBeforeDelete} -> ${countAfterDelete}`)

await open('pages/order/index?screen=confirm')
await evaluate(`document.querySelector('.bottom-action uni-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await delay(120)
value = await evaluate(`document.querySelector('.nav-title')?.textContent?.trim() || ''`)
check('确认订单进入收银台', value === '收银台', value)
await evaluate(`document.querySelector('.single-action uni-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await delay(120)
value = await evaluate(`document.querySelector('.nav-title')?.textContent?.trim() || ''`)
check('收银台进入支付成功', value === '支付成功', value)

await open('pages/delivery/index?screen=workbench')
await evaluate(`document.querySelector('.tools > uni-view:nth-child(2), .tools > view:nth-child(2)')?.click()`)
await delay(120)
value = await evaluate(`document.querySelector('.nav-title')?.textContent?.trim() || ''`)
check('送水员进入主动签收', value === '主动签收', value)
const initialConfirmed = await evaluate(`Boolean(document.querySelector('.confirm-check .on'))`)
await evaluate(`document.querySelector('.confirm-check')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await delay(80)
const toggledOff = await evaluate(`!document.querySelector('.confirm-check .on')`)
check('主动签收确认状态可切换', initialConfirmed && toggledOff, `${initialConfirmed} -> ${!toggledOff}`)

socket.close()
const failures = checks.filter((item) => !item.pass)
console.log(JSON.stringify({ checked: checks.length, failures, checks }, null, 2))
if (failures.length) process.exitCode = 1
