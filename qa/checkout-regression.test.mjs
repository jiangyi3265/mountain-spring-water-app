import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function loadPage(page, uni, api = {}, pages = []) {
  const source = readFileSync(new URL(`../pages/${page}/index.vue`, import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0]
  const imports = [...source.matchAll(/^import (\w+) from /gm)].map(match => match[1])
  return new Function('uni', 'waterApi', 'getCurrentPages', ...imports, source.replace(/^import .*$/gm, '').replace('export default', 'return'))(uni, api, () => pages)
}

test('支付成功返回订单列表，重复触发提交不能再创建或扣款', async () => {
  const storage = new Map(), messages = [], screens = []
  let creates = 0, settles = 0
  const component = loadPage('order', { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) }, {
    createOrder: async () => { creates++; return { id: 'paid', payStatus: '已支付' } },
  })
  const ctx = { ...component.data(), checkout: { station: '中央站', items: [{ sku: 'A', qty: 1, station: '中央站' }] }, quote: { amount: 10, goodsAmount: 10, ticketAmount: 0 }, account: { address: '测试地址', balance: 100 }, checkoutTotal: 10, payMethod: 'balance', selectedTickets: [] }
  for (const [key, method] of Object.entries(component.methods)) ctx[key] = method.bind(ctx)
  ctx.settleOrder = async order => { settles++; return order }
  ctx.mapOrder = order => order
  ctx.open = screen => { ctx.screen = screen; screens.push(screen) }
  ctx.toast = message => messages.push(message)
  await ctx.submitPayment()
  assert.equal(ctx.screen, 'success'); assert.equal(ctx.checkout, null)
  ctx.goBack(); assert.equal(ctx.screen, 'orders')
  await ctx.submitPayment()
  assert.equal(creates, 1); assert.equal(settles, 1)
  assert.match(messages[0], /没有可结算的商品/)
  assert.deepEqual(screens, ['success', 'orders'])
})

test('购物车结算只扣除同水站同商品的已购数量；重复清理无副作用', () => {
  const storage = new Map([['mountain-spring-cart', [
    { name: '中央站', items: [{ sku: 'A', qty: 3, checked: true }, { sku: 'B', qty: 2, checked: false }] },
    { name: '北站', items: [{ sku: 'A', qty: 4, checked: true }] },
  ]]])
  const page = loadPage('order', { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) })
  const ctx = { checkout: { station: '中央站', fromCart: true, items: [{ sku: 'A', qty: 2 }] } }
  page.methods.finishCheckout.call(ctx); page.methods.finishCheckout.call(ctx)
  const cart = storage.get('mountain-spring-cart')
  assert.equal(cart[0].items[0].qty, 1); assert.equal(cart[0].items[1].qty, 2)
  assert.equal(cart[1].items[0].qty, 4); assert.equal(cart[0].checked, false)
})

test('立即购买不清理购物车；从购物车买完最后一件后返回首页显示空车', () => {
  const cart = [{ name: '中央站', items: [{ sku: 'A', qty: 1, checked: true }] }]
  const storage = new Map([['mountain-spring-cart', cart]])
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) }
  const page = loadPage('order', uni)
  page.methods.finishCheckout.call({ checkout: { station: '中央站', fromCart: false, items: [{ sku: 'A', qty: 1 }] } })
  assert.equal(storage.get('mountain-spring-cart'), cart)
  page.methods.finishCheckout.call({ checkout: { station: '中央站', fromCart: true, items: [{ sku: 'A', qty: 1 }] } })
  const home = loadPage('index', uni)
  const ctx = { cartStations: cart }
  home.methods.restoreCart.call(ctx)
  assert.deepEqual(ctx.cartStations, [])
})

test('首页鉴权钩子在会员/订单页失效时切换页面，在首页时原地显示登录', () => {
  const pages = [{ route: 'pages/index/index' }], navigations = []
  const api = { hooks: {}, getConfig: async () => ({}), showLogin: role => navigations.push(role) }
  const page = loadPage('index', { getSystemInfoSync: () => ({}) }, api, pages)
  const ctx = { ...page.data(), restoreCart() {}, loadCatalog() {}, loadProfile() {} }
  page.onLoad.call(ctx, {})
  api.hooks.onAuthRequired('customer'); assert.equal(ctx.screen, 'auth'); assert.equal(navigations.length, 0)
  pages.push({ route: 'pages/member/index' })
  api.hooks.onAuthRequired('customer'); api.hooks.onAuthRequired('courier')
  assert.deepEqual(navigations, ['customer', 'courier'])
  let profileCalls = 0
  ctx.$nextTick = fn => fn(); ctx.$refs = {}; ctx.loadProfile = () => { profileCalls++ }
  page.onShow.call(ctx)
  assert.equal(profileCalls, 0, '登录页不能继续触发鉴权请求造成重定向循环')
})

test('多商品购物车一次结算：同水站勾选商品合并为一个结算单，跨水站拒绝合并', () => {
  const writes = [], messages = []
  const page = loadPage('index', { setStorageSync: (key, value) => writes.push({ key, value }), navigateTo: () => {} })
  const ctx = { screen: 'cart', account: { stationName: '中央站' }, stations: [], showToast: message => messages.push(message), cartStations: [{ name: '中央站', items: [{ sku: 'A', name: '桶装水', spec: '18.9L', price: '29.95', qty: 2, checked: true }, { sku: 'B', name: '瓶装水', spec: '550ml', price: '16.00', qty: 1, checked: true }, { sku: 'C', qty: 1, checked: false }] }] }
  page.methods.openOrder.call(ctx)
  assert.deepEqual(writes[0].value.items.map(item => [item.sku, item.qty]), [['A', 2], ['B', 1]])
  assert.equal(writes[0].value.fromCart, true)
  assert.equal(writes[0].value.station, '中央站')
  ctx.cartStations.push({ name: '城北站', items: [{ sku: 'A', qty: 1, checked: true }] })
  page.methods.openOrder.call(ctx)
  assert.equal(writes.length, 1)
  assert.match(messages[0], /不同水站/)
})

test('结算页水票挑选：电子票只抵对应商品，纸质票只抵 18.9L，数量不超过购买件数', () => {
  const page = loadPage('order', {})
  const available = [{ type: '电子票', code: 'E1', skuCode: 'B' }, { type: '电子票', code: 'E2', skuCode: 'X' }, { type: '纸质票', code: 'P1' }, { type: '纸质票', code: 'P2' }, { type: '纸质票', code: 'P3' }]
  const picked = page.methods.pickTickets(available, [{ sku: 'A', spec: '18.9L 桶装水', qty: 2 }, { sku: 'B', spec: '550ml × 12瓶', qty: 1 }])
  assert.deepEqual(picked.map(item => [item.code, item.skuCode]), [['E1', 'B'], ['P1', 'A'], ['P2', 'A']])
})

test('旧版单商品结算缓存仍能读取；售后按商品与数量提交', async () => {
  const page = loadPage('order', {})
  assert.deepEqual(page.methods.normalizeCheckout({ sku: 'A', qty: 1, station: '中央站' }).items.map(item => item.sku), ['A'])
  assert.equal(page.methods.normalizeCheckout(null), null)
  const created = []
  const order = loadPage('order', { showToast() {} }, { createAftersale: async data => { created.push(data); return data } })
  const ctx = { ...order.data(), selectedOrder: { id: 'DD1', amount: '40.00', refundedAmount: 0, ticketAmount: 0, status: '已完成' }, refundType: 'resend', refundLines: [{ skuCode: 'A', quantity: 1 }, { skuCode: 'B', quantity: 0 }], refundableAmount: 40, refundImages: [], appConfig: {} }
  for (const [key, method] of Object.entries(order.methods)) ctx[key] = method.bind(ctx)
  // Bind the real computed policy just as Vue does; submitting now validates the available type.
  for (const [key, getter] of Object.entries(order.computed)) Object.defineProperty(ctx, key, { get: () => getter.call(ctx), configurable: true })
  ctx.open = () => {}
  await ctx.submitRefund()
  assert.deepEqual(created[0].items, [{ skuCode: 'A', quantity: 1 }])
  assert.equal(created[0].type, '补送')
  assert.equal(created[0].amount, 0)
})
