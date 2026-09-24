import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Service-layer VM tests of production code with mocked uni storage/request.
// They are not browser, real backend, WeChat runtime, or physical-device tests.
const source = readFileSync(new URL('../services/waterApi.js', import.meta.url), 'utf8')
  .replaceAll('import.meta.env', 'testEnv')
  .replace('export const waterApi =', 'globalThis.waterApi =')
  .replace('export { API_BASE_URL }', '')
const session = token => ({ token, expiresAt: new Date(Date.now() + 3600000).toISOString(), profile: { id: token } })
function setup(storage = new Map([['water_session_customer', session('customer-ticket')], ['water_session_courier', session('courier-ticket')]]), testEnv = {}) {
  const pending = [], navigations = []
  const context = vm.createContext({
    testEnv, console,
    uni: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), request: options => pending.push(options), showToast() {}, reLaunch: options => navigations.push(options) },
  })
  vm.runInContext(source, context, { filename: 'services/waterApi.js' })
  return { api: context.waterApi, storage, pending, navigations }
}
function reply(call, data = {}, statusCode = 200, code = 0) { call.success({ statusCode, data: { code, data } }) }
const flush = () => new Promise(resolve => setImmediate(resolve))

for (const role of ['customer', 'courier']) {
  test(`${role} expired session clears invalid token and concurrent failures navigate to the correct login only once`, async () => {
    const h = setup()
    const request = role === 'customer' ? () => h.api.getAccount() : () => h.api.listCourierOrders()
    const first = request(), second = request()
    const done = Promise.allSettled([first, second])
    await flush()
    reply(h.pending[0], {}, 401, 401); reply(h.pending[1], {}, 401, 401)
    await flush()
    reply(h.pending[2], { demoAuth: false })
    const results = await done
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'AUTH_REQUIRED'))
    assert.equal(h.api.hasSession(role), false)
    assert.equal(h.navigations.length, 1)
    assert.equal(h.navigations[0].url, role === 'customer' ? '/pages/index/index?screen=auth' : '/pages/delivery/index?screen=login')
    h.navigations[0].complete()
    h.api.showLogin(role)
    assert.equal(h.navigations.length, 2, '后续独立登录失效仍可导航')
  })
}

for (const dev of [true, false]) {
  test(`${dev ? '开发预览' : '发布'}未指定接口时，商品请求必须发送到线上服务`, async () => {
    const h = setup(undefined, { DEV: dev })
    const result = h.api.listCatalogProducts()
    assert.equal(h.pending[0].url, 'https://cang.oksja.cn/api/catalog/products')
    reply(h.pending[0], [])
    assert.equal((await result).length, 0)
  })
}

test('显式配置的本地联调接口仍生效，且不产生双斜杠', async () => {
  const h = setup(undefined, { DEV: true, VITE_WATER_API_URL: 'http://127.0.0.1:18192/api/' })
  const result = h.api.listCatalogProducts()
  assert.equal(h.pending[0].url, 'http://127.0.0.1:18192/api/catalog/products')
  reply(h.pending[0], [])
  assert.equal((await result).length, 0)
})

for (const role of ['customer', 'courier']) {
  test(`${role} logout deduplicates clicks, clears only its own role, blocks automatic login after reload`, async () => {
    const h = setup()
    const other = role === 'customer' ? 'courier' : 'customer'
    const first = h.api.logout(role)
    assert.equal(h.api.logout(role), first)
    assert.equal(h.pending.length, 1)
    assert.match(h.pending[0].url, /\/api\/auth\/logout$/)
    assert.equal(h.pending[0].header.Authorization, `Bearer ${role}-ticket`)
    assert.equal(h.api.hasSession(role), true, 'storage retained until backend confirms')
    reply(h.pending[0])
    await first
    assert.equal(h.api.hasSession(role), false)
    assert.equal(h.api.authRequired(role), true)
    assert.equal(h.api.hasSession(other), true)
    const reload = setup(h.storage)
    const autoLogin = reload.api.login(role)
    const rejected = assert.rejects(autoLogin, /请先登录/)
    assert.equal(reload.pending.length, 1)
    assert.match(reload.pending[0].url, /\/config$/)
    reply(reload.pending[0], { demoAuth: true })
    await rejected
    assert.equal(reload.pending.length, 1, 'no demo login even if config permits it')
  })

  for (const failure of ['network', 'http', 'business']) {
    test(`${role} logout ${failure} failure preserves session and retry is possible`, async () => {
      const h = setup()
      const task = h.api.logout(role)
      const rejected = assert.rejects(task)
      if (failure === 'network') h.pending[0].fail({ errMsg: 'request:fail' })
      if (failure === 'http') reply(h.pending[0], {}, 503)
      if (failure === 'business') reply(h.pending[0], {}, 200, 500)
      await rejected
      assert.equal(h.api.hasSession(role), true)
      assert.equal(h.api.authRequired(role), false)
      const retry = h.api.logout(role)
      reply(h.pending[1], {}, 401, 401)
      await retry
      assert.equal(h.api.hasSession(role), false)
      assert.equal(h.api.authRequired(role), true)
    })
  }

  test(`${role} late password login is rejected after logout and cannot resurrect storage`, async () => {
    const h = setup()
    const signingIn = h.api.loginWithPassword(role, '13800000000', 'test-password')
    const rejected = assert.rejects(signingIn, /登录操作已取消/)
    reply(h.pending[0], { demoAuth: false })
    await flush()
    assert.match(h.pending[1].url, /\/auth\/login$/)
    const signingOut = h.api.logout(role)
    await assert.rejects(h.api.loginWithPassword(role, '13800000000', 'test-password'), /退出处理中/)
    assert.equal(h.pending.length, 3)
    reply(h.pending[2])
    await signingOut
    reply(h.pending[1], session('late-ticket'))
    await rejected
    assert.equal(h.api.hasSession(role), false)
    assert.equal(h.api.authRequired(role), true)
  })

  test(`${role} configuration arriving after logout cannot start a stale password request`, async () => {
    const h = setup()
    const signingIn = h.api.loginWithPassword(role, '13800000000', 'test-password')
    const rejected = assert.rejects(signingIn, /登录操作已取消/)
    assert.match(h.pending[0].url, /\/config$/)
    const signingOut = h.api.logout(role)
    reply(h.pending[1])
    await signingOut
    reply(h.pending[0], { demoAuth: true })
    await rejected
    assert.equal(h.pending.length, 2, 'late config must not trigger password or demo authentication')
    assert.equal(h.api.hasSession(role), false)
    assert.equal(h.api.authRequired(role), true)
  })
}

for (const flow of ['register', 'wechatLogin']) {
  test(`customer ${flow} during logout is blocked before issuing any request`, async () => {
    const h = setup()
    const signingOut = h.api.logout('customer')
    await assert.rejects(h.api[flow]({ code: 'test-code', phone: '13800000000' }), /退出处理中/)
    assert.equal(h.pending.length, 1)
    assert.match(h.pending[0].url, /\/auth\/logout$/)
    reply(h.pending[0])
    await signingOut
    assert.equal(h.api.hasSession('customer'), false)
  })

  test(`customer late ${flow} response cannot restore a logged out session`, async () => {
    const h = setup()
    const signingIn = h.api[flow]({ code: 'test-code', phone: '13800000000' })
    const rejected = assert.rejects(signingIn, /登录操作已取消/)
    const signingOut = h.api.logout('customer')
    reply(h.pending[1])
    await signingOut
    reply(h.pending[0], session('late-ticket'))
    await rejected
    assert.equal(h.api.hasSession('customer'), false)
    assert.equal(h.api.authRequired('customer'), true)
  })
}

test('customer and courier can logout concurrently without suppressing either revocation', async () => {
  const h = setup()
  const tasks = [h.api.logout('customer'), h.api.logout('courier')]
  assert.equal(h.pending.length, 2)
  assert.equal(h.pending[0].header.Authorization, 'Bearer customer-ticket')
  assert.equal(h.pending[1].header.Authorization, 'Bearer courier-ticket')
  reply(h.pending[1])
  reply(h.pending[0])
  await Promise.all(tasks)
  assert.equal(h.api.hasSession('customer'), false)
  assert.equal(h.api.hasSession('courier'), false)
})
