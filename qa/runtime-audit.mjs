import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const endpoint = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9225')
const baseUrl = process.env.MOBILE_URL || 'http://127.0.0.1:4174'
const outputDir = resolve(process.env.QA_EVIDENCE_DIR || 'qa')
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
const apiFailures = []
const requests = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeErrors.push(message.params.entry.text)
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
    const undersizedText = visible.filter((node) => {
      if (node.children.length || !node.textContent.trim()) return false
      if (node.closest('.status-bar,.bottom-badge,.image-count')) return false
      return parseFloat(getComputedStyle(node).fontSize) < 12
    }).slice(0, 12).map((node) => ({ text: node.textContent.trim().slice(0, 30), size: getComputedStyle(node).fontSize }))
    const undersizedTargets = visible.filter((node) => {
      if (!(node.matches('button,[role="button"]') || node.getAttribute('onclick') || [...node.attributes].some(attr => attr.name.startsWith('on')))) return false
      const rect = node.getBoundingClientRect()
      return rect.width < 40 || rect.height < 40
    }).slice(0, 12).map((node) => ({ text: node.textContent.trim().slice(0, 24), width: Math.round(node.getBoundingClientRect().width), height: Math.round(node.getBoundingClientRect().height) }))
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
      undersizedText,
      undersizedTargets,
      outside
    }
  })()`)
  report.push({ name, route, ...metrics, runtimeErrors: [...runtimeErrors], apiFailures: [...apiFailures] })
}

writeFileSync(resolve(outputDir, 'mobile-runtime-report.json'), JSON.stringify(report, null, 2))
socket.close()

const failures = report.filter((item) =>
  item.documentWidth > item.viewport || item.windowScrollY !== 0 || item.headerTop < 0 ||
  item.brokenImages > 0 || item.outside.length > 0 || item.undersizedText.length > 0 || item.undersizedTargets.length > 0 || item.runtimeErrors.length > 0 || item.apiFailures.length > 0
)
console.log(JSON.stringify({ checked: report.length, failures }, null, 2))
if (failures.length) process.exitCode = 1
