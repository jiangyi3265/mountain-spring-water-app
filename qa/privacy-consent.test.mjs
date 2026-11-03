import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { pageContext } from './order-pagination-harness.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function fixture(page = 'index', storageFailure = false) {
  const requests = [], storage = new Map(), messages = []
  const api = new Proxy({}, { get: (_, method) => method === 'recentlyToasted' ? () => false : async (...args) => { requests.push({ method, args }); return {} } })
  const uni = {
    setStorageSync(key, value) { if (storageFailure) throw new Error('disk full'); storage.set(key, value) },
    login() { requests.push({ method: 'uni.login' }) },
    showToast: options => messages.push(options.title),
    showModal: options => messages.push(options.content),
    pageScrollTo() {},
  }
  const { ctx } = pageContext(page, api, uni)
  if (page === 'index') {
    Object.assign(ctx.authForm, { phone: '13888888888', password: 'testpass', name: '测试', address: '测试小区 1 栋' })
    ctx.stations = [{ id: 'station-test' }]
    ctx.afterLogin = () => {}; ctx.loadProfile = () => {}
  } else {
    ctx.phone = '13888888888'; ctx.password = 'testpass'
    ctx.syncCourierProfile = async () => {}; ctx.loadOrders = async () => {}; ctx.open = () => {}
  }
  return { ctx, requests, storage, messages }
}

test('客户密码登录、注册、微信登录、绑定和演示登录默认未勾选，均不收集数据', async () => {
  for (const mode of ['login', 'register', 'wechat', 'bind', 'demo']) {
    const { ctx, requests, storage } = fixture()
    assert.equal(ctx.authConsent, false)
    if (mode === 'register') ctx.authMode = 'register'
    if (mode === 'bind') ctx.pendingWechatCode = 'previous-code'
    if (mode === 'wechat') ctx.wechatAuth()
    else if (mode === 'demo') await ctx.demoAuth()
    else await ctx.submitAuth()
    assert.deepEqual(requests, [], mode)
    assert.equal(storage.size, 0, mode)
    assert.match(ctx.authError, /请先阅读并勾选同意/)
  }
})

test('勾选后客户和配送员密码登录正常提交，授权记录只含版本与时间', async () => {
  for (const page of ['index', 'delivery']) {
    const { ctx, requests, storage } = fixture(page)
    ctx.authConsent = true
    await (page === 'index' ? ctx.submitAuth() : ctx.login())
    assert.equal(requests.filter(item => item.method === 'loginWithPassword').length, 1)
    const receipt = storage.get(`water_privacy_consent_${page === 'index' ? 'customer' : 'courier'}`)
    assert.deepEqual(Object.keys(receipt).sort(), ['agreedAt', 'version'])
    assert.equal(receipt.version, '2026-10-24')
    assert.ok(Number.isFinite(Date.parse(receipt.agreedAt)))
  }
})

test('配送员未勾选时不调用登录或配置接口，能看到同意提示', async () => {
  const { ctx, requests, messages } = fixture('delivery')
  assert.equal(ctx.authConsent, false)
  await ctx.login()
  assert.deepEqual(requests, [])
  assert.match(messages.at(-1), /请先阅读并勾选同意/)
})

test('存储授权失败时不发送账号或微信授权码，并允许重试', async () => {
  for (const page of ['index', 'delivery']) {
    const { ctx, requests, messages } = fixture(page, true)
    ctx.authConsent = true
    await (page === 'index' ? ctx.submitAuth() : ctx.login())
    if (page === 'index') ctx.wechatAuth()
    assert.deepEqual(requests, [])
    assert.match(page === 'index' ? ctx.authError : messages.at(-1), /无法保存授权状态/)
    assert.equal(page === 'index' ? ctx.authSubmitting : ctx.loginLoading, false)
  }
})

test('重新进入登录、切换注册或退出登录页均恢复未勾选；未同意可返回首页', () => {
  const { ctx } = fixture()
  ctx.authConsent = true; ctx.switchAuthMode(); assert.equal(ctx.authConsent, false)
  ctx.authConsent = true; ctx.requireLogin(); assert.equal(ctx.authConsent, false)
  ctx.authConsent = true; ctx.leaveAuth(); assert.equal(ctx.authConsent, false)
  assert.equal(ctx.screen, 'home')
})

test('旧版本授权不保留会话，当前授权保留会话且不影响业务数据', () => {
  const storage = new Map([
    ['water_session_customer', 'old-customer'], ['water_session_courier', 'current-courier'],
    ['water_privacy_consent_customer', { version: 'old' }],
    ['water_privacy_consent_courier', { version: '2026-10-24', agreedAt: '2026-10-24T00:00:00Z' }],
    ['mountain-spring-cart', ['cart-item']],
  ])
  const run = new Function('uni', read('services/privacy.js').replace(/^export /gm, '') + '\nclearUnconsentedSessions()')
  run({ getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key) })
  assert.equal(storage.has('water_session_customer'), false)
  assert.equal(storage.get('water_session_courier'), 'current-courier')
  assert.deepEqual(storage.get('mountain-spring-cart'), ['cart-item'])
  assert.match(read('App.vue'), /onLaunch\(\) \{ clearUnconsentedSessions\(\);/)
})

test('协议独立公开页面保留首页入口，阅读返回不产生授权或网络请求', () => {
  const pages = JSON.parse(read('pages.json')).pages
  assert.equal(pages[0].path, 'pages/index/index')
  assert.ok(pages.some(page => page.path === 'pages/legal/index'))
  const legal = read('pages/legal/index.vue')
  assert.doesNotMatch(legal, /waterApi|rememberConsent|authConsent/)
  assert.match(legal, /uni.navigateBack\(\)/)
  const component = read('components/ConsentNotice.vue')
  assert.match(component, /type: Boolean, default: false/)
  assert.equal((component.match(/<navigator class="legal-link"/g) || []).length, 2)
  const docs = read('services/legalDocuments.js')
  assert.match(docs, /仓林有限公司/); assert.match(docs, /13245986538/)
})
