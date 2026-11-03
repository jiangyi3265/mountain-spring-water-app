import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { pageContext } from './order-pagination-harness.mjs'

function fixture(api = {}, uni = {}) {
  const { ctx } = pageContext('index', api, { setStorageSync() {}, ...uni })
  ctx.authConsent = true // These existing cases exercise explicitly consented login attempts.
  ctx.showToast = () => {}; ctx.loadProfile = () => {}
  ctx.authForm.phone = '13888888888'; ctx.authForm.password = 'testpass'
  return ctx
}

test('登录只发出一个请求；失败释放按钮并保留可重试的错误', async () => {
  let calls = 0, rejectRequest
  const ctx = fixture({ loginWithPassword: () => { calls++; return new Promise((_, reject) => { rejectRequest = reject }) } })
  const first = ctx.submitAuth()
  await ctx.submitAuth(); ctx.switchAuthMode()
  assert.equal(calls, 1); assert.equal(ctx.authMode, 'login'); assert.equal(ctx.authSubmitting, true)
  rejectRequest(new Error('密码不正确')); await first
  assert.equal(ctx.authSubmitting, false); assert.equal(ctx.authError, '密码不正确')
  ctx.clearAuthError(); assert.equal(ctx.authError, '')
})

test('注册校验水站与地址，不向接口发送缺少水站的注册请求', async () => {
  let calls = 0
  const ctx = fixture({ register: async () => { calls++ } })
  ctx.authMode = 'register'; ctx.authForm.name = '测试用户'; ctx.authForm.address = '测试小区 1 栋'
  await ctx.submitAuth()
  assert.equal(ctx.authErrorField, 'station'); assert.equal(calls, 0)
  ctx.stations = [{ id: 'station-test' }]; ctx.authForm.address = '短'
  await ctx.submitAuth(); assert.equal(ctx.authErrorField, 'address'); assert.equal(calls, 0)
  ctx.authForm.address = '测试小区 1 栋'; await ctx.submitAuth()
  assert.equal(calls, 1); assert.equal(ctx.screen, 'home'); assert.equal(ctx.authForm.password, '')
})

test('切换登录与注册清除明文密码和微信绑定状态', () => {
  const ctx = fixture(); ctx.pendingWechatCode = 'old-code'; ctx.authPasswordVisible = true; ctx.authError = 'old-error'
  ctx.switchAuthMode()
  assert.equal(ctx.authMode, 'register'); assert.equal(ctx.pendingWechatCode, ''); assert.equal(ctx.authForm.password, '')
  assert.equal(ctx.authPasswordVisible, false); assert.equal(ctx.authError, '')
})

test('微信一键登录防止重复点击，主动绑定已有账号时获取新code且验证账号密码', async () => {
  let requests = 0, options, payload
  const ctx = fixture({ wechatLogin: async value => { requests++; payload = value } }, { login: value => { options = value } })
  ctx.wechatAuth(); ctx.wechatAuth(); await ctx.submitAuth()
  assert.equal(ctx.wechatSubmitting, true); assert.equal(requests, 0)
  await options.success({ code: 'wechat-code' })
  assert.equal(requests, 1); assert.equal(ctx.wechatSubmitting, false); assert.equal(ctx.pendingWechatCode, ''); assert.deepEqual(payload, { code: 'wechat-code' }); assert.equal(ctx.screen, 'home')
  ctx.openWechatBinding(); ctx.authConsent = true
  ctx.authForm.password = 'testpass'; const binding = ctx.submitAuth()
  options.success({ code: 'fresh-binding-code' }); await binding
  assert.deepEqual(payload, { code: 'fresh-binding-code', phone: '13888888888', password: 'testpass' })
  assert.equal(ctx.pendingWechatCode, ''); assert.equal(ctx.screen, 'home')
})

test('微信失败、无授权码及同步异常均恢复按钮，允许重试', async () => {
  let options
  const ctx = fixture({}, { login: value => { options = value } })
  ctx.wechatAuth(); options.fail(); assert.equal(ctx.wechatSubmitting, false); assert.match(ctx.authError, /连接失败/)
  ctx.wechatAuth(); await options.success({}); assert.equal(ctx.wechatSubmitting, false); assert.match(ctx.authError, /未获取/)
  const throwing = fixture({}, { login: () => { throw new Error('SDK unavailable') } })
  throwing.wechatAuth(); assert.equal(throwing.wechatSubmitting, false); assert.equal(throwing.authError, 'SDK unavailable')
})

test('商品接口失败不清空可用水站，注册仍能提交', async () => {
  let submitted
  const ctx = fixture({
    listCatalogCategories: async () => [],
    listCatalogProducts: async () => { throw new Error('商品服务不可用') },
    listCatalogStations: async () => [{ id: 'station-test', name: '体验测试水站' }],
    register: async data => { submitted = data },
  })
  await ctx.loadCatalog()
  assert.equal(ctx.catalogError, '商品服务不可用')
  assert.equal(ctx.stations.length, 1); assert.equal(ctx.stationsError, '')
  ctx.authMode = 'register'; ctx.authForm.name = '注册测试'; ctx.authForm.address = '测试地址 1 栋'
  await ctx.submitAuth()
  assert.equal(submitted.stationId, 'station-test'); assert.equal(ctx.screen, 'home')
})

test('水站接口失败不清空商品，单独重试水站可恢复', async () => {
  let attempts = 0, productCalls = 0
  const ctx = fixture({
    listCatalogCategories: async () => [{ name: '桶装水' }],
    listCatalogProducts: async () => { productCalls++; return [{ id:'p1', skuCode:'SKU1', name:'测试商品', price:10 }] },
    listCatalogStations: async () => { if (++attempts === 1) throw new Error('network'); return [{ id:'station-test' }] },
  })
  await ctx.loadCatalog()
  assert.equal(ctx.products.length, 1); assert.equal(ctx.catalogError, '')
  assert.equal(ctx.stationsError, 'network'); assert.equal(ctx.stationsLoading, false)
  await ctx.loadStations()
  assert.equal(ctx.stations.length, 1); assert.equal(ctx.stationsError, '')
  assert.equal(productCalls, 1, '重试水站不重复请求商品')
})

test('空水站列表属于未开通，不伪装成网络失败或发起注册', async () => {
  let calls = 0
  const ctx = fixture({ listCatalogStations: async () => [], register: async () => { calls++ } })
  await ctx.loadStations()
  assert.equal(ctx.stationsError, ''); assert.equal(ctx.stationsLoading, false)
  ctx.authMode = 'register'; ctx.authForm.name = '注册测试'; ctx.authForm.address = '测试地址 1 栋'
  await ctx.submitAuth()
  assert.match(ctx.authError, /尚未开通/); assert.equal(calls, 0)
})

test('重复刷新只请求一次水站，列表重排后保持用户选择', async () => {
  let calls = 0, resolveStations
  const ctx = fixture({ listCatalogStations: () => { calls++; return new Promise(resolve => { resolveStations = resolve }) } })
  ctx.stations = [{ id:'s1' }, { id:'s2' }]; ctx.authForm.stationIndex = 1
  const pending = ctx.loadStations(); await ctx.loadStations()
  assert.equal(calls, 1); assert.equal(ctx.stationsLoading, true)
  resolveStations([{ id:'s2' }, { id:'s1' }]); await pending
  assert.equal(ctx.authForm.stationIndex, 0); assert.equal(ctx.stations[ctx.authForm.stationIndex].id, 's2')
  assert.equal(ctx.stationsLoading, false)
})

test('注册成功后退出应返回登录表单，清除密码和微信绑定状态', async () => {
  let confirm
  const ctx = fixture({ logout: async () => {} }, {
    showActionSheet: options => options.success({ tapIndex: 1 }),
    showModal: options => { confirm = options.success },
    setStorageSync() {},
  })
  ctx.authMode = 'register'; ctx.screen = 'profile'; ctx.pendingWechatCode = 'old-code'; ctx.authPasswordVisible = true
  ctx.openSettings(); await confirm({ confirm: true })
  assert.equal(ctx.authMode, 'login'); assert.equal(ctx.screen, 'auth')
  assert.equal(ctx.authForm.password, ''); assert.equal(ctx.pendingWechatCode, ''); assert.equal(ctx.authPasswordVisible, false)
})
