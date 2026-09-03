import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const endpoint = 'http://127.0.0.1:9225'
const baseUrl = 'http://127.0.0.1:4174'
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
  ['member-membership', 'pages/member/index?screen=membership'],
  ['delivery-login', 'pages/delivery/index?screen=login'],
  ['delivery-workbench', 'pages/delivery/index?screen=workbench'],
  ['delivery-alert', 'pages/delivery/index?screen=alert'],
  ['delivery-detail', 'pages/delivery/index?screen=delivery-detail'],
  ['delivery-sign', 'pages/delivery/index?screen=sign'],
  ['delivery-call', 'pages/delivery/index?screen=call']
]

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
const runtimeErrors = []
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeErrors.push(message.params.entry.text)
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

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

const report = []
for (const [name, route] of screens) {
  runtimeErrors.length = 0
  await send('Page.navigate', { url: `${baseUrl}/?runtime=${Date.now()}#/${route}` })
  await delay(700)
  const metrics = await evaluate(`(() => {
    const viewport = document.documentElement.clientWidth
    const visible = [...document.querySelectorAll('body *')].filter((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
    const outside = visible.filter((node) => {
      if (node.classList?.contains('profile-lines')) return false
      const rect = node.getBoundingClientRect()
      return rect.left < -1 || rect.right > viewport + 1
    }).slice(0, 8).map((node) => ({
      tag: node.tagName,
      className: String(node.className || '').slice(0, 90),
      left: Math.round(node.getBoundingClientRect().left),
      right: Math.round(node.getBoundingClientRect().right)
    }))
    const images = [...document.images]
    const header = document.querySelector('.mobile-header')?.getBoundingClientRect()
    const title = document.querySelector('.nav-title')
    const scrollView = document.querySelector('uni-scroll-view')
    const scrollRect = scrollView?.getBoundingClientRect()
    const innerScroller = scrollView?.shadowRoot?.querySelector('.uni-scroll-view')
    const titleRect = title?.getBoundingClientRect()
    return {
      hash: location.hash,
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      windowScrollY: Math.round(window.scrollY),
      bodyScrollTop: Math.round(document.body.scrollTop),
      headerTop: header ? Math.round(header.top) : null,
      headerHeight: header ? Math.round(header.height) : null,
      titleTop: titleRect ? Math.round(titleRect.top) : null,
      scrollTop: innerScroller ? Math.round(innerScroller.scrollTop) : null,
      scrollViewTop: scrollRect ? Math.round(scrollRect.top) : null,
      visualOffsetTop: Math.round(window.visualViewport?.offsetTop || 0),
      visualPageTop: Math.round(window.visualViewport?.pageTop || 0),
      title: title?.textContent?.trim() || '',
      titleColor: title ? getComputedStyle(title).color : '',
      titleBackground: title ? getComputedStyle(document.querySelector('.mobile-header')).backgroundColor : '',
      brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0).length,
      outside
    }
  })()`)
  report.push({ name, route, ...metrics, runtimeErrors: [...runtimeErrors] })
}

writeFileSync(resolve('qa', 'runtime-report.json'), JSON.stringify(report, null, 2))
socket.close()

const failures = report.filter((item) =>
  item.documentWidth > item.viewport || item.windowScrollY !== 0 || item.headerTop < 0 ||
  item.brokenImages > 0 || item.outside.length > 0 || item.runtimeErrors.length > 0
)
console.log(JSON.stringify({ checked: report.length, failures }, null, 2))
