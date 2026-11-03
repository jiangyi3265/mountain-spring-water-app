import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { order, pageContext } from './order-pagination-harness.mjs'
import { backendOrderActions, realService, settle, templateOf } from './review-fixes-harness.mjs'

// 2026-09-28 独立复核缺陷回归（页面方法原样执行 + 真实 services/waterApi.js；非浏览器/真机测试）。
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function courier(api = {}, uni = {}) {
  const toasts = [], calls = []
  const { ctx, component } = pageContext('delivery', api, { showToast: ({ title }) => toasts.push(title), makePhoneCall: ({ phoneNumber }) => calls.push(phoneNumber), ...uni })
  ctx.startSync = () => {}; ctx.stopSync = () => {}; ctx.loadOrders = async () => {}
  return { ctx, component, toasts, calls }
}
const cod = (id, status, extra = {}) => order(id, status, { payment: '货到付款', payStatus: '未支付', amount: 29.95, ...extra })

// ---------------- P1-F1 送水员工作台工具作用于过期选择 ----------------
test('F1 查看订单X后返回工作台，联系客户/主动签收只作用于工作台展示的下一单Y', async () => {
  const X = cod('X', '配送中', { customer: '已查看X', phone: '13800000001', address: 'X 地址' }), Y = cod('Y', '配送中', { customer: '下一单Y', phone: '13800000002', address: 'Y 地址' })
  const completed = []
  const { ctx, calls } = courier({ completeOrder: async id => { completed.push(id); return { ...(id === 'X' ? X : Y), status: '已完成', payStatus: '已支付' } } })
  ctx.screen = 'workbench'; ctx.activeOrders = [Y, X].map(ctx.mapOrder)
  assert.equal(ctx.nextOrder.id, 'Y')
  ctx.selectOrder(ctx.activeOrders[1]); assert.equal(ctx.activeOrder.id, 'X')
  ctx.goBack()
  assert.equal(ctx.screen, 'workbench'); assert.equal(ctx.selectedOrder, null, '返回工作台清除选择')
  assert.equal(ctx.activeOrder.id, 'Y', '工作台工具作用于展示的下一单')
  ctx.callCustomer(); assert.deepEqual(calls, ['13800000002'])
  ctx.signNextOrder()
  assert.equal(ctx.screen, 'sign'); assert.equal(ctx.activeOrder.id, 'Y')
  await ctx.finishSign(); assert.deepEqual(completed, [], '未勾选确认不能签收')
  ctx.confirmed = true; await ctx.finishSign()
  assert.deepEqual(completed, ['Y'])
  await new Promise(done => setTimeout(done, 650))
  assert.equal(ctx.screen, 'workbench'); assert.equal(ctx.selectedOrder, null, '签收后清除选择')
})

test('F1 列表屏切换都会清除选择；上门收票只针对工作台下一单，不挑其他订单', () => {
  const W = order('W', '配送中', { payment: '余额支付', payStatus: '已支付' }), Z = cod('Z', '配送中')
  const { ctx, toasts } = courier()
  ctx.screen = 'workbench'; ctx.activeOrders = [W, Z].map(ctx.mapOrder)
  for (const screen of ['orders', 'messages', 'mine', 'workbench']) { ctx.selectOrder(ctx.activeOrders[1]); ctx.navChange(screen); assert.equal(ctx.selectedOrder, null, screen) }
  ctx.openTicketSign()
  assert.equal(ctx.screen, 'workbench', '下一单W已付款，不应跳到其他订单Z收票'); assert.equal(ctx.selectedOrder, null)
  assert.match(toasts.at(-1), /货到付款/)
  ctx.activeOrders = [Z].map(ctx.mapOrder); ctx.openTicketSign()
  assert.equal(ctx.screen, 'sign'); assert.equal(ctx.selectedOrder.id, 'Z'); assert.equal(ctx.signMethod, 'ticket')
})

test('F1 签收页展示订单号/客户/地址/应收，进入即重置确认，需送水员显式勾选', async () => {
  const template = templateOf('delivery'), sign = template.split("screen==='sign'\" scroll-y")[1].split('</scroll-view>')[0]
  for (const binding of ['activeOrder.id', 'activeOrder.customer', 'activeOrder.address', 'receivable.label', 'receivable.value', '@click="confirmed=!confirmed"']) assert.ok(sign.includes(binding), binding)
  assert.match(template, /<view @click="signNextOrder">/)
  const completed = []
  const { ctx, toasts } = courier({ completeOrder: async id => { completed.push(id); return cod(id, '已完成') } })
  assert.equal(ctx.confirmed, false)
  ctx.selectOrder(cod('A', '配送中')); ctx.confirmed = true; ctx.open('sign')
  assert.equal(ctx.confirmed, false)
  await ctx.finishSign(); assert.deepEqual(completed, []); assert.match(toasts.at(-1), /勾选/)
  assert.equal(ctx.receivable.value, '¥29.95')
})

// ---------------- P2-F2 缺少“接单/开始配送”入口 ----------------
test('F2 未弹提醒的待配送派单可在详情“接单并开始配送”，调用接单接口并刷新', async () => {
  const P = cod('P', '待配送', { courierId: 'courier-1', dispatchStatus: '已派单' }), accepted = [], reloads = []
  const { ctx } = courier({ acceptOrder: async id => { accepted.push(id); return { ...P, status: '配送中', dispatchStatus: '已接单' } } })
  ctx.loadOrders = async () => { reloads.push(ctx.selectedOrder?.status) }
  ctx.courierProfile = { id: 'courier-1', name: '送水员', station: '中央站', phone: '' }
  ctx.screen = 'workbench'; ctx.activeOrders = [P].map(ctx.mapOrder)
  assert.equal(ctx.pendingOrder, undefined, '首次同步前派单不会弹提醒')
  ctx.selectOrder(ctx.activeOrders[0])
  assert.equal(ctx.canAcceptSelected, true)
  const pending = ctx.acceptSelectedOrder(); await ctx.acceptSelectedOrder(); await pending
  assert.deepEqual(accepted, ['P'], '连点只接单一次'); assert.deepEqual(reloads, ['配送中'])
  assert.equal(ctx.selectedOrder.status, '配送中'); assert.equal(ctx.screen, 'delivery-detail'); assert.equal(ctx.canAcceptSelected, false)
  assert.match(templateOf('delivery'), /v-if="canAcceptSelected"[^>]*@click="acceptSelectedOrder"/)
  const other = courier(); other.ctx.courierProfile = { id: 'courier-1' }; other.ctx.selectOrder(cod('Q', '待配送', { courierId: 'courier-2' }))
  assert.equal(other.ctx.canAcceptSelected, false, '不是派给本人的订单不显示接单')
  other.ctx.selectOrder(cod('H', '待配送', { fulfillmentHoldReason: '退款处理中' })); assert.equal(other.ctx.canAcceptSelected, false)
})

test('F2 待配送订单不提供收票/扫码签收；扫码签收不再自动接单', async () => {
  const P = cod('P', '待配送'), accepted = [], completed = [], previews = []
  const { ctx, toasts } = courier({ acceptOrder: async id => { accepted.push(id); return { ...P, status: '配送中' } }, completeOrder: async id => { completed.push(id); return P }, courierPreviewTickets: async body => { previews.push(body); return { amount: 0, ticketAmount: 29.95 } } })
  ctx.selectOrder(P); ctx.signMethod = 'scan'; ctx.open('sign')
  assert.equal(ctx.signMethod, 'manual', '不可用的签收方式回落到主动签收')
  assert.equal(ctx.signOptions.find(item => item.id === 'ticket').available, false)
  assert.equal(ctx.signOptions.find(item => item.id === 'scan').available, false)
  assert.match(ctx.signOptions.find(item => item.id === 'scan').note, /接单/)
  ctx.signMethod = 'ticket'; ctx.ticketCode = 'JT000001'; await ctx.addTicket()
  assert.deepEqual(previews, []); assert.match(toasts.at(-1), /接单/)
  ctx.signMethod = 'scan'; ctx.receiptCode = '123456'; ctx.confirmed = true
  await ctx.finishSign()
  assert.deepEqual(accepted, [], '扫码签收不自动接单（否则会重新生成签收码）'); assert.deepEqual(completed, [])
  assert.match(toasts.at(-1), /接单/)
  ctx.selectOrder({ ...P, status: '配送中' }); ctx.open('sign')
  assert.equal(ctx.signOptions.find(item => item.id === 'ticket').available, true)
  assert.equal(ctx.signOptions.find(item => item.id === 'scan').available, true)
})

// ---------------- P3-F15 消息动态显示原始动作代码 ----------------
test('F15 后端会写入的每个订单动作都有中文标签，未知动作显示通用文案而不是代码', async () => {
  const actions = await backendOrderActions()
  for (const known of ['confirm-receipt', 'replacement-created', 'late-payment-refund-pending', 'late-payment-refunded', 'accept', 'complete', 'pay-ticket']) assert.ok(actions.has(known), `解析后端动作失败：${known}`)
  const { ctx } = courier()
  const timeline = [...actions, 'future-action'].map((action, index) => ({ at: new Date(Date.UTC(2026, 8, 28, 0, index)).toISOString(), action, status: '配送中' }))
  ctx.activeOrders = [order('M', '配送中', { timeline })]
  assert.equal(ctx.messages.length, Math.min(30, timeline.length))
  const all = timeline.map(event => ({ ...ctx, orders: [order('M', '配送中', { timeline: [event] })] }))
  const component = pageContext('delivery', {}).component
  for (const view of all) { const [message] = component.computed.messages.call(view); assert.doesNotMatch(message.title, /[a-z]/i, `${view.orders[0].timeline[0].action} → ${message.title}`) }
  assert.equal(component.computed.messages.call(all.at(-1))[0].title, '订单动态更新')
})

// ---------------- P2-F3 水票支付待配送订单可取消 ----------------
test('F3 水票支付的待配送订单显示取消，成功提示水票已退回；不可取消的仍隐藏', async () => {
  const T = order('T', '待配送', { payment: '水票支付', payStatus: '已支付', amount: 0, ticketAmount: 29.95 }), toasts = [], cancelled = []
  const result = { ...T, status: '已取消', refundStatus: '已退款' }
  const { ctx } = pageContext('order', { cancelOrder: async id => { cancelled.push(id); return result }, listOrders: async () => ({ items: [result], total: 1, page: 1, pageSize: 20 }), getOrder: async () => result }, { showToast: ({ title }) => toasts.push(title) })
  ctx.startSync = () => {}
  ctx.selectOrder(T)
  assert.equal(ctx.canCancelOrder, true)
  await ctx.cancelSelectedOrder()
  assert.deepEqual(cancelled, ['T']); assert.equal(ctx.selectedOrder.status, '已取消')
  assert.equal(toasts.at(-1), '订单已取消，水票已退回账户')
  assert.equal(ctx.cancelMessage({ payment: '余额支付', refundStatus: '已退款', amount: 20, ticketAmount: 0 }), '订单已取消，余额已退回')
  assert.equal(ctx.cancelMessage({ payment: '余额支付', refundStatus: '已退款', amount: 20, ticketAmount: 9.95 }), '订单已取消，余额已退回，水票已退回账户')
  for (const blocked of [order('W', '待配送', { payment: '微信支付', payStatus: '已支付' }), order('R', '待配送', { payment: '水票支付', orderType: '补送' }), order('H', '待配送', { payment: '水票支付', fulfillmentHoldReason: '退款处理中' }), order('D', '配送中', { payment: '水票支付' })]) {
    ctx.selectOrder(blocked); assert.equal(ctx.canCancelOrder, false, blocked.id)
  }
})

// ---------------- P2-F4 电子水票有效期 ----------------
test('F4 电子票有效期按本地日期显示，只有 null 才显示长期有效', async () => {
  const expiresAt = '2026-10-28T18:14:07.458Z', local = new Date(expiresAt)
  const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
  const { ctx } = pageContext('member', { listTickets: async () => [{ code: 'ET0001', ticketType: '电子票', station: '中央站', status: '可用', expiresAt, productName: '山泉水' }, { code: 'JT0001', ticketType: '纸质票', station: '中央站', status: '可用', expiresAt: null }] })
  await ctx.loadTickets()
  assert.equal(ctx.tickets[0].date, expected); assert.equal(ctx.tickets[1].date, '长期有效')
  assert.ok(ctx.tickets.every(ticket => !ticket.station.includes('清泉')))
})

// ---------------- P2-F5 首页联系水站 ----------------
test('F5 首页联系水站/客服电话使用客户所属水站；无法确定时让用户选择而不是拨第一个', async () => {
  const dialed = [], sheets = []
  const { ctx } = pageContext('index', {}, { makePhoneCall: ({ phoneNumber }) => dialed.push(phoneNumber), showActionSheet: options => sheets.push(options) })
  ctx.stations = [{ id: 's1', name: '北站', phone: '13700000001' }, { id: 's2', name: '中央站', phone: '13700000002' }]
  ctx.account = { ...ctx.account, stationName: '中央站' }; ctx.profileLoaded = true
  ctx.callStation(); assert.deepEqual(dialed, ['13700000002'])
  assert.equal(ctx.menuValue({ target: 'support' }), '13700000002')
  ctx.openSupport(); assert.match(sheets.at(-1).itemList[0], /中央站 13700000002/)
  sheets.at(-1).success({ tapIndex: 0 }); assert.deepEqual(dialed, ['13700000002', '13700000002'])
  ctx.account = { ...ctx.account, stationName: '' }; ctx.callStation()
  assert.equal(dialed.length, 2, '访客/未匹配多水站时不默认拨第一个'); assert.deepEqual(sheets.at(-1).itemList, ['北站 13700000001', '中央站 13700000002'])
  // 选项改为可分页的 chooseFromList（微信最多 6 项），选择结果异步返回
  sheets.at(-1).success({ tapIndex: 1 }); await new Promise(resolve => setTimeout(resolve)); assert.equal(dialed.at(-1), '13700000002')
})

// ---------------- P2-F6 首次打开强制登录（小程序审核红线） ----------------
function guestShop() {
  let loggedIn = false
  const catalog = { '/api/catalog/categories': [{ id: 'c1', name: '桶装水' }], '/api/catalog/products': [{ id: 'p1', skuCode: 'water-18_9l', name: '山泉水', categoryName: '桶装水', spec: '18.9L', price: 29.95, stock: 9 }], '/api/catalog/stations': [{ id: 'station-001', name: '中央站', phone: '13700000002' }, { id: 'station-002', name: '北站', phone: '13700000001' }] }
  const protectedData = { '/api/account': { name: '林悦', phone: '13888888888', address: '北站小区 1 栋', stationName: '北站', balance: 128.6, points: 10 }, '/api/tickets': [], '/api/orders': { items: [], total: 0, page: 1, pageSize: 100 }, '/api/aftersales': [], '/api/coupons': [], '/api/account/referral': { referralCode: '' } }
  const service = realService(call => {
    if (call.path === '/api/config') return { demoAuth: false, wechatLogin: false, wechatPay: false }
    if (catalog[call.path]) return catalog[call.path]
    if (call.path === '/api/auth/login') { loggedIn = true; return { token: 'customer-token', expiresAt: new Date(Date.now() + 3600000).toISOString(), profile: { id: 'customer-001' } } }
    if (loggedIn && call.token === 'customer-token' && protectedData[call.path]) return protectedData[call.path]
    throw Object.assign(new Error('请先登录'), { status: 401 })
  })
  const storage = new Map(), navigations = []
  globalThis.getCurrentPages = () => [{ route: 'pages/index/index' }]
  const { ctx, component } = pageContext('index', service.api, { getSystemInfoSync: () => ({ statusBarHeight: 20 }), getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), navigateTo: options => navigations.push(options.url), showActionSheet() {} })
  ctx.$nextTick = fn => fn(); ctx.$refs = {}; ctx.showToast = () => {}
  return { ctx, component, service, navigations }
}

test('F6 访客首次打开停留首页，只请求公开目录接口，不跳登录', async () => {
  const { ctx, component, service, navigations } = guestShop()
  component.onLoad.call(ctx, {}); await settle()
  assert.equal(ctx.screen, 'home'); assert.equal(ctx.guest, true)
  assert.deepEqual([...new Set(service.calls.map(call => call.path))].sort(), ['/api/catalog/categories', '/api/catalog/products', '/api/catalog/stations', '/api/config'])
  assert.deepEqual(service.navigations, []); assert.deepEqual(navigations, [])
  component.onShow.call(ctx); await settle()
  assert.equal(ctx.screen, 'home'); assert.ok(service.calls.every(call => call.path === '/api/config' || call.path.startsWith('/api/catalog/')))
})

test('F6 访客可浏览分类/详情/购物车；结算、订单、会员、地址、售后、“我的”才提示登录且可“先逛逛”返回', async () => {
  const { ctx, component, service, navigations } = guestShop()
  component.onLoad.call(ctx, {}); await settle()
  ctx.go('category'); assert.equal(ctx.screen, 'category')
  ctx.selectProduct(ctx.products[0]); assert.equal(ctx.screen, 'detail')
  ctx.addCart(ctx.products[0]); assert.equal(ctx.cartCount, 1)
  ctx.go('search'); assert.equal(ctx.screen, 'search')
  ctx.go('cart'); assert.equal(ctx.screen, 'cart')
  ctx.openOrder(); assert.equal(ctx.screen, 'auth'); assert.deepEqual(navigations, [], '未登录不进入结算页')
  ctx.leaveAuth(); assert.equal(ctx.screen, 'cart')
  for (const action of [() => ctx.go('profile'), () => ctx.go('orders'), () => ctx.go('tickets'), () => ctx.go('points'), () => ctx.openAddress(), () => ctx.openMember('balance'), () => ctx.openProfileOrder({ tab: '售后' })]) {
    ctx.go('home'); action(); assert.equal(ctx.screen, 'auth'); ctx.leaveAuth(); assert.equal(ctx.screen, 'home')
  }
  assert.deepEqual(navigations, []); assert.deepEqual(service.navigations, [])
  assert.match(templateOf('index'), /class="auth-browse"[^>]*@click="leaveAuth"/)
  // 从购物车登录后回到购物车，访客加购并入账户所属水站
  ctx.go('cart'); ctx.openOrder(); assert.equal(ctx.screen, 'auth')
  ctx.authForm.phone = '13888888888'; ctx.authForm.password = 'fixture-password'
  ctx.authConsent = true; await ctx.submitAuth(); await settle()
  assert.equal(ctx.screen, 'cart'); assert.equal(ctx.guest, false); assert.equal(ctx.profileLoaded, true)
  assert.deepEqual(ctx.cartStations.map(station => [station.name, Boolean(station.guest), station.items.length]), [['北站', false, 1]])
  ctx.openOrder(); assert.deepEqual(navigations, ['/pages/order/index?screen=confirm'])
})

// ---------------- P2-F7 未绑定微信的账号选择微信支付 ----------------
function checkout(account, config = { wechatPay: true, simulatedPayments: false }) {
  const created = [], prepaid = [], toasts = []
  const { ctx } = pageContext('order', { getAccount: async () => account, createOrder: async body => { created.push(body); return { id: 'N1', payStatus: '未支付' } }, wechatPrepay: async id => { prepaid.push(id); return {} } }, { showToast: ({ title }) => toasts.push(title), getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} })
  ctx.appConfig = { ...ctx.appConfig, ...config }
  ctx.checkout = { station: '中央站', items: [{ sku: 'water-18_9l', qty: 1 }] }; ctx.quote = { amount: 29.95, goodsAmount: 29.95, ticketAmount: 0, items: [] }
  return { ctx, created, prepaid, toasts }
}
const account = extra => ({ name: '林悦', phone: '13888888888', address: '翡翠城 6 幢', stationName: '中央站', balance: 100, ...extra })

test('F7 密码登录未绑定微信时建单前禁用微信支付并提示，余额/货到付款可用', async () => {
  const { ctx, created, prepaid, toasts } = checkout(account({ wechatBound: false }))
  ctx.payMethod = 'wechat'; await ctx.loadAccount()
  assert.equal(ctx.payMethod, 'cod', '已选微信支付自动改为可用方式'); assert.match(ctx.wechatBlockedMessage, /未绑定微信/)
  ctx.payMethod = 'wechat'; await ctx.submitPayment()
  assert.deepEqual(created, [], '不能先建单再卡在待付款'); assert.deepEqual(prepaid, []); assert.match(toasts.at(-1), /未绑定微信/)
  ctx.payMethod = 'balance'; ctx.requestSubscriptions = async () => null; ctx.settleOrder = async order => ({ ...order, payStatus: '已支付' }); ctx.open = () => {}
  await ctx.submitPayment(); assert.equal(created.length, 1, '余额支付不受影响'); assert.equal(created[0].payment, '余额支付')
  ctx.selectedOrder = ctx.mapOrder(order('OLD', '待付款', { payment: '微信支付' })); ctx.settleOrder = async () => { prepaid.push('OLD'); return {} }
  await ctx.paySelectedOrder(); assert.deepEqual(prepaid, []); assert.match(toasts.at(-1), /未绑定微信/)
  assert.match(templateOf('order'), /:wechat-blocked-message="wechatBlockedMessage"/)
})

test('F7 已绑定微信或H5（未开通小程序支付）保持原有行为', async () => {
  const bound = checkout(account({ wechatBound: true })); bound.ctx.payMethod = 'wechat'; await bound.ctx.loadAccount()
  assert.equal(bound.ctx.payMethod, 'wechat'); assert.equal(bound.ctx.wechatBlockedMessage, '')
  const h5 = checkout(account({ wechatBound: false }), { wechatPay: false, simulatedPayments: false, wechatPayMessage: '请在微信小程序中使用微信支付或在线充值' }); h5.ctx.payMethod = 'wechat'
  await h5.ctx.loadAccount(); assert.equal(h5.ctx.wechatBlockedMessage, ''); await h5.ctx.submitPayment()
  assert.deepEqual(h5.created, []); assert.match(h5.toasts.at(-1), /微信小程序/)
})

test('F7 PayOptions 按 wechatBlockedMessage 禁用微信支付并显示原因', () => {
  const source = readFileSync(new URL('../components/PayOptions.vue', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0]
  const component = new Function('AppIcon', source.replace(/^import .*$/gm, '').replace('export default', 'return'))({})
  const props = Object.fromEntries(Object.entries(component.props).map(([key, value]) => [key, value.default]))
  const items = extra => component.computed.items.call({ ...props, wechatPay: true, balance: 100, payable: 29.95, ...extra })
  assert.equal(items({}).find(item => item.id === 'wechat').disabled, false)
  const blocked = items({ wechatBlockedMessage: '当前账号未绑定微信' })
  assert.deepEqual(blocked.map(item => [item.id, item.disabled]), [['wechat', true], ['balance', false], ['cod', false]]); assert.equal(blocked[0].note, '当前账号未绑定微信')
})

// ---------------- P3-F11 继续支付遇 onShow 同步 ----------------
test('F11 继续微信支付时拉起收银台返回触发 onShow 同步，仍进入支付成功页', async t => {
  const A = order('A', '待付款', { payment: '微信支付', payStatus: '未支付', amount: 29.95 }), paid = { ...A, status: '待配送', payStatus: '已支付' }, toasts = []
  let settled = false, ctx, component
  ;({ ctx, component } = pageContext('order', { wechatPrepay: async () => ({ timeStamp: '1' }), getOrder: async () => settled ? paid : A, listOrders: async () => ({ items: [settled ? paid : A], total: 1, page: 1, pageSize: 20 }) }, {
    showToast: ({ title }) => toasts.push(title),
    requestPayment: options => { component.onShow.call(ctx); settled = true; options.success({}) },
  }))
  t.after(() => ctx.stopSync())
  ctx.$nextTick = fn => fn(); ctx.$refs = {}; ctx.appConfig = { ...ctx.appConfig, wechatPay: true }; ctx.account = { ...ctx.account, wechatBound: true }
  ctx.selectOrder(A); await settle()
  await ctx.paySelectedOrder()
  assert.equal(ctx.screen, 'success', `支付结果不能被 onShow 静默丢弃：${toasts.join('|')}`)
  assert.equal(ctx.currentOrder.payStatus, '已支付'); assert.equal(ctx.paymentPending, false)
})

// ---------------- P3-F12 返回导航 ----------------
function orderEntry(screen) {
  const back = [], toasts = []
  const { ctx, component } = pageContext('order', { getConfig: async () => ({}), getAccount: async () => account({}), updateAccount: async body => account(body), listOrders: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }), listAftersales: async () => [] }, { getStorageSync: () => '', navigateBack: options => back.push(options), showToast: ({ title }) => toasts.push(title) })
  ctx.$nextTick = fn => fn(); ctx.$refs = {}
  component.onLoad.call(ctx, { screen })
  return { ctx, back, toasts }
}

test('F12 从“我的地址”进入，保存或返回都回到来源页而不是“我的订单”', async () => {
  const saved = orderEntry('address'); await settle()
  saved.ctx.addressForm = { name: '林悦', address: '翡翠城 6 幢 1203 室' }
  await saved.ctx.saveAddress(); await new Promise(done => setTimeout(done, 550))
  assert.equal(saved.back.length, 1); assert.equal(saved.ctx.screen, 'address')
  const back = orderEntry('address'); back.ctx.goBack(); assert.equal(back.back.length, 1); assert.equal(back.ctx.screen, 'address')
  const inPage = orderEntry('confirm'); inPage.ctx.open('address'); inPage.ctx.goBack(); assert.equal(inPage.ctx.screen, 'confirm', '结算页内修改地址仍回结算页')
})

test('F12 navigateTo 打开的订单列表/售后进度有返回按钮并返回上一页', async t => {
  assert.doesNotMatch(templateOf('order'), /:back="screen !== 'orders'"/)
  for (const screen of ['orders', 'aftersales']) {
    const { ctx, back } = orderEntry(screen); t.after(() => ctx.stopSync()); await settle()
    ctx.goBack(); assert.equal(back.length, 1, screen)
  }
  const { ctx, back } = orderEntry('orders'); t.after(() => ctx.stopSync()); await settle()
  ctx.open('aftersales'); ctx.goBack(); assert.equal(ctx.screen, 'orders'); assert.equal(back.length, 0)
})

// ---------------- P3-F13 商品详情“选择规格” ----------------
test('F13 同类商品面板显示商品名+规格，不再误称“选择规格”', () => {
  const panel = templateOf('index').split('class="sku-panel"')[1].split('</view></view>')[0]
  assert.doesNotMatch(panel, /选择规格/); assert.match(panel, /同类商品/); assert.match(panel, /\{\{ product\.name \}\}/)
})

// ---------------- P2-F14 优惠券 ----------------
function couponPage(api = {}) {
  const toasts = []
  const { ctx } = pageContext('member', api, { showToast: ({ title }) => toasts.push(title), showModal: options => options.success({ confirm: true }) })
  ctx.loadAssets = async () => {}
  ctx.coupons = [{ couponId: 'sold', name: '已领完券', discount: 5, type: '无门槛券', minimum: 0, totalQuantity: 10, issuedQuantity: 10, pointsCost: 0, status: '启用' }, { couponId: 'free', name: '新客券', discount: 5, type: '无门槛券', minimum: 0, totalQuantity: 10, issuedQuantity: 1, pointsCost: 0, status: '启用' }, { couponId: 'points', name: '积分券', discount: 3, totalQuantity: 5, issuedQuantity: 5, pointsCost: 100, status: '启用' }]
  return { ctx, toasts }
}

test('F14 已领完的券不在“可领取”，标记已领完且不能领取/兑换', async () => {
  const claimed = [], exchanged = []
  const { ctx, toasts } = couponPage({ claimCoupon: async id => { claimed.push(id) }, exchangePoints: async id => { exchanged.push(id); return { pointsAfter: 0 } } })
  ctx.account.points = 1000
  ctx.pointTab = '可领取'; assert.deepEqual(ctx.visibleCoupons.map(coupon => coupon.couponId), ['free'])
  assert.match(ctx.couponHint(ctx.coupons[0]), /已领完/); assert.match(ctx.couponHint(ctx.coupons[2]), /已兑完/)
  await ctx.pickCoupon(ctx.coupons[0]); await ctx.pickCoupon(ctx.coupons[2])
  assert.deepEqual(claimed, []); assert.deepEqual(exchanged, []); assert.deepEqual(toasts, ['该优惠券已领完', '该优惠券已兑完'])
  assert.match(templateOf('member'), /couponSoldOut\(coupon\)/)
})

test('F14 领取进行中重复点击只提交一次；失败只提示一次（接口层静默）', async () => {
  const release = deferred(), claimed = []
  const { ctx, toasts } = couponPage({ claimCoupon: async id => { claimed.push(id); await release.promise; throw new Error('该优惠券已领取，每人限领一次') } })
  const first = ctx.pickCoupon(ctx.coupons[1]); await ctx.pickCoupon(ctx.coupons[1]); await ctx.claimCoupon(ctx.coupons[1])
  release.resolve(); await first
  assert.deepEqual(claimed, ['free']); assert.deepEqual(toasts, ['该优惠券已领取，每人限领一次']); assert.equal(ctx.claimingCouponId, '')
  const shared = []
  const service = realService(() => { throw Object.assign(new Error('该优惠券需使用 100 积分兑换'), { status: 400 }) }, { sessions: { customer: 'customer' }, toasts: shared })
  const page = pageContext('member', service.api, { showToast: ({ title }) => shared.push(title) }).ctx
  page.loadAssets = async () => {}
  await page.claimCoupon({ couponId: 'points' })
  assert.deepEqual(shared, ['该优惠券需使用 100 积分兑换'], '请求层与页面不能重复提示')
})

// ---------------- P3-F16 积分明细单位 ----------------
test('F16 积分明细显示“积分”而不是像金额的“分”', async () => {
  const { ctx } = pageContext('member', { getAccount: async () => ({ balance: 1, points: 500 }), listCoupons: async () => [], listAccountTransactions: async () => [{ id: 1, accountType: '积分', changeAmount: -300, balanceAfter: 500, note: '积分兑换', createdAt: '2026-09-28T01:00:00Z' }, { id: 2, accountType: '余额', changeAmount: 1250, balanceAfter: 2500, note: '充值', createdAt: '2026-09-28T01:00:00Z' }] })
  await ctx.loadAssets()
  assert.deepEqual(ctx.balanceRecords.map(record => [record.amount, record.balance]), [['-300 积分', '500 积分'], ['+12.50', '25.00']])
})

// ---------------- 规则变更（2026-09-28 业主决定）：纸质水票只能由水站后台发放入账 ----------------
test('纸质水票规则：水票页不再提供自助绑定，说明由水站发放并可联系客户所属水站', async () => {
  const dialed = []
  const { ctx } = pageContext('member', { listCatalogStations: async () => [{ name: '北站', phone: '13700000001' }, { name: '中央站', phone: '13700000002' }] }, { makePhoneCall: ({ phoneNumber }) => dialed.push(phoneNumber) })
  ctx.account = { ...ctx.account, stationName: '中央站' }
  await ctx.loadStations()
  assert.match(ctx.paperTicketNote, /由水站发放到您的账户.*中央站（电话 13700000002）/)
  ctx.callStation(); assert.deepEqual(dialed, ['13700000002'])
  assert.equal(ctx.bindTicket, undefined, '不保留总会失败的自助绑定方法'); assert.equal(ctx.scanTicket, undefined)
  const template = templateOf('member')
  assert.doesNotMatch(template, /bindTicket|scanTicket|open\('bind'\)|绑定纸质水票|确认绑定/)
  const bind = template.split("screen==='bind'")[1].split('</template>')[0]
  assert.doesNotMatch(bind, /<input/); assert.match(bind, /paperTicketNote/)
})

test('纸质水票规则：送水员收票界面提示只收已发放给该客户的水票，后端拒绝原因原样显示一次', async () => {
  const message = '水票 JT000201 尚未由水站发放给该客户，请先在后台发放'
  const { ctx, toasts } = courier({ courierPreviewTickets: async () => { throw new Error(message) } })
  ctx.selectOrder(cod('P', '配送中')); ctx.signMethod = 'ticket'; ctx.open('sign')
  assert.equal(ctx.signMethod, 'ticket')
  ctx.ticketCode = 'jt000201'; await ctx.addTicket()
  assert.deepEqual(toasts, [message]); assert.deepEqual(ctx.collectTickets, [])
  const form = templateOf('delivery').split('<text class="sign-label">上门回收客户水票</text>')[1].split(`<view v-if="signMethod==='scan'"`)[0]
  assert.match(form, /仅可回收水站已发放给该客户的水票/)
})

// ---------------- P3 其他 ----------------
test('P3 客户“修改密码”已接入菜单；成功后清除会话回到登录页', async () => {
  const changed = [], cleared = []
  const modals = [{ confirm: true, content: 'NewPass!2026' }, { confirm: true, content: 'OldPass!2026' }]
  const { ctx } = pageContext('index', { changePassword: async (...args) => { changed.push(args) }, clearLocalSession: role => cleared.push(role) }, { showModal: options => options.success(modals.shift()) })
  ctx.showToast = () => {}; ctx.screen = 'profile'
  assert.ok(ctx.profileMenu.some(item => item.target === 'password'))
  ctx.handleProfileMenu({ target: 'password' }); await settle()
  assert.deepEqual(changed, [['customer', 'OldPass!2026', 'NewPass!2026']]); assert.deepEqual(cleared, ['customer'])
  assert.equal(ctx.screen, 'auth'); assert.equal(ctx.guest, true)
})

test('P3 送水员“我的”可修改密码：先暂停接单，成功后清除会话回登录页；失败恢复接单', async () => {
  const calls = []
  const make = fail => {
    const modals = [{ confirm: true, content: 'NewPass!2026' }, { confirm: true, content: 'OldPass!2026' }]
    const { ctx } = courier({ setCourierOnline: async online => { calls.push(['online', online]); return { online } }, changePassword: async (...args) => { calls.push(['password', ...args]); if (fail) throw new Error('原密码不正确') }, clearLocalSession: role => calls.push(['clear', role]) }, { showModal: options => options.success(modals.shift()) })
    ctx.screen = 'mine'; ctx.online = true; return ctx
  }
  const ok = make(false); ok.changePassword(); await settle()
  assert.deepEqual(calls, [['online', false], ['password', 'courier', 'OldPass!2026', 'NewPass!2026'], ['clear', 'courier']]); assert.equal(ok.screen, 'login')
  calls.length = 0; const failed = make(true); failed.changePassword(); await settle()
  assert.deepEqual(calls, [['online', false], ['password', 'courier', 'OldPass!2026', 'NewPass!2026'], ['online', true]]); assert.equal(failed.screen, 'mine'); assert.equal(failed.online, true)
  assert.match(templateOf('delivery'), /@click="changePassword">修改登录密码/)
})

test('P3 “售后/退款”进入售后进度；最近搜索来自本机记录；水票品牌与已用票按钮', () => {
  const navigations = [], storage = new Map()
  const { ctx } = pageContext('index', {}, { navigateTo: options => navigations.push(options.url), getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) })
  ctx.openProfileOrder(ctx.profileOrders.at(-1)); assert.deepEqual(navigations, ['/pages/order/index?screen=aftersales'])
  assert.deepEqual(ctx.recent, [], '不再显示写死的示例搜索词')
  ctx.go('search'); ctx.keyword = '苏打水'; ctx.doSearch(); ctx.keyword = '18.9L'; ctx.doSearch(); ctx.keyword = '苏打水'; ctx.doSearch()
  assert.deepEqual(storage.get('mountain-spring-recent-search'), ['苏打水', '18.9L'])
  const again = pageContext('index', {}, { getStorageSync: key => storage.get(key) }).ctx; again.go('search'); assert.deepEqual(again.recent, ['苏打水', '18.9L'])
  ctx.clearRecent(); assert.equal(storage.has('mountain-spring-recent-search'), false)
  const member = readFileSync(new URL('../pages/member/index.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(member, /清泉到家|清泉站点/)
  assert.match(templateOf('member'), /v-if="selectedTicket\?\.status==='可用'" class="main-button" @click="goHome">去订水，用水票抵扣/)
})

test('P3 账户接口部分失败显示错误状态而不是余额0；取消/补送单右侧按钮显示真实状态', async () => {
  const { ctx } = pageContext('index', { hasSession: () => true, canRestoreSession: async () => true, getAccount: async () => ({ balance: 88 }), listTickets: async () => [], listOrders: async () => [], listAftersales: async () => [], listCoupons: async () => [], getReferral: async () => { throw new Error('推荐服务暂不可用') } })
  await ctx.loadProfile()
  assert.equal(ctx.profileLoaded, false); assert.equal(ctx.profileError, '推荐服务暂不可用'); assert.equal(ctx.menuValue({ target: 'points', label: '积分商城' }), '')
  assert.match(templateOf('index'), /profileLoaded \? Number\(account\.balance\|\|0\)\.toFixed\(2\) : '--'/)
  const toasts = [], checkoutPage = pageContext('order', { getAccount: async () => { throw new Error('账户服务超时') } }, { showToast: ({ title }) => toasts.push(title) }).ctx
  await checkoutPage.loadAccount(); assert.equal(checkoutPage.accountError, '账户服务超时')
  checkoutPage.checkout = { station: '中央站', items: [{ sku: 'water-18_9l', qty: 1 }] }
  assert.throws(() => checkoutPage.validatePayment(), /账户信息加载失败/)
  const labels = [[order('C', '已取消', { payStatus: '未支付' }), '订单已取消'], [order('R', '待配送', { orderType: '补送', payStatus: '已支付' }), '水站安排补送中'], [order('R2', '已完成', { orderType: '补送', payStatus: '已支付' }), '补送已签收'], [order('P', '待配送', { payment: '货到付款', payStatus: '未支付' }), '等待配送']]
  for (const [row, label] of labels) { checkoutPage.selectedOrder = row; assert.equal(checkoutPage.detailStatusLabel, label, row.id) }
})
