import assert from 'node:assert/strict'
import test from 'node:test'
import { pageContext } from './order-pagination-harness.mjs'
import { realService, forwardTo, waitFor, password } from './review-fixes-harness.mjs'
import { createWaterApi } from '../../water-api/server.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('微信入口默认一键登录且不索要手机号密码；未同意不调用SDK；绑定是用户主动选择', () => {
  let calls = 0, options
  const { ctx } = pageContext('index', {}, { setStorageSync() {}, login: value => { calls++; options = value } })
  ctx.isWechatPlatform = true
  assert.equal(ctx.wechatQuick, true)
  ctx.wechatAuth(); assert.equal(calls, 0)
  ctx.authConsent = true; ctx.wechatAuth(); assert.equal(calls, 1)
  ctx.wechatAuth(); assert.equal(calls, 1)
  options.fail(); ctx.openWechatBinding()
  assert.equal(ctx.wechatQuick, false); assert.equal(ctx.authConsent, false)
  assert.equal(ctx.pendingWechatCode, 'bind-existing')
  ctx.returnWechatQuick(); assert.equal(ctx.wechatQuick, true); assert.equal(ctx.pendingWechatCode, '')
})

test('页面真实服务与HTTP联调：新微信进入首页并补全配送资料、获得报价、成功建单', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'water-onetap-ui-'))
  const app = await createWaterApi({ dataFile: join(dir,'water.sqlite'), tokenSecret: 'isolated-onetap-ui-fixture-2026-at-least-32', seedDemoData: true, defaultPassword: password, demoAuthEnabled: false,
    integrations: { wechat: { loginConfigured: true, payConfigured: false, subscribeConfigured: false, login: async code => ({ openid: 'ui-' + code }) }, oss: { configured: false }, geocoder: { configured: false } } })
  await new Promise(done => app.server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise(done => app.server.close(done)); await rm(dir, { recursive: true, force: true }) })
  const service = realService(forwardTo(`http://127.0.0.1:${app.server.address().port}/api`))
  let options
  const { ctx } = pageContext('index', service.api, { ...service.uni, login: value => { options = value } })
  ctx.isWechatPlatform = true; ctx.screen = 'auth'; ctx.authConsent = true; ctx.showToast = () => {}
  ctx.wechatAuth(); await options.success({ code: 'new-user' })
  await waitFor(() => ctx.profileLoaded, 'one-tap profile loaded')
  assert.equal(ctx.screen, 'home'); assert.equal(ctx.pendingWechatCode, '')
  assert.equal(ctx.account.wechatOnly, true); assert.equal(ctx.account.phone, '')
  assert.ok(ctx.visibleProfileMenu.every(item => item.target !== 'password'))
  assert.deepEqual(service.calls.find(call => call.path === '/api/auth/wechat').data, { code: 'new-user' })
  const { ctx: order } = pageContext('order', service.api, service.uni)
  order.toast = () => {}; order.account = ctx.account; order.screen = 'confirm'; order.entryScreen = 'confirm'
  order.checkout = { station: '', items: [{ sku: 'water-18_9l', qty: 1 }], fromCart: false }
  assert.throws(() => order.validatePayment(), /完善收货信息/)
  assert.equal(order.screen, 'address')
  await waitFor(() => order.addressStations.length > 0, 'delivery stations')
  Object.assign(order.addressForm, { name: '新微信用户', contactPhone: '13912345678', address: '新用户测试小区 1 栋', stationIndex: 0 })
  order.goBack = () => { order.screen = 'confirm' }
  await order.saveAddress(); await waitFor(() => !!order.quote, 'quote after saving first delivery profile')
  assert.equal(order.account.phone, '13912345678'); assert.ok(order.account.stationId)
  assert.equal(order.checkout.station, order.account.stationName)
  const created = await service.api.createOrder({ idempotencyKey: 'one-tap-ui-order', items: [{ sku: 'water-18_9l', quantity: 1 }], payment: '货到付款' })
  assert.equal(created.customerId, ctx.account.id); assert.equal(created.phone, '13912345678')
  assert.equal(app.business.customerByPhone('13912345678'), undefined, '配送电话不是密码登录身份')
})
