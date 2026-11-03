import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile } from 'node:fs/promises'
import { pageContext } from './order-pagination-harness.mjs'
import { bootApi, evidence, forwardTo, password, realService, settle, waitFor } from './review-fixes-harness.mjs'

// 真实回环 HTTP + 快照 water-api + 临时 SQLite；页面方法与 services/waterApi.js 原样执行。非浏览器/真机/生产支付测试。
async function withReport(name, run) {
  const report = { name, startedAt: new Date().toISOString(), environment: 'page methods + real services/waterApi.js + loopback snapshot water-api + temp SQLite', facts: {} }
  try { await run(report.facts) } catch (error) { report.error = error.stack; throw error }
  finally { report.finishedAt = new Date().toISOString(); await writeFile(`${evidence}/${name}-${Date.now()}.json`, JSON.stringify(report, null, 2)) }
}
async function demoSessions(f) {
  for (const role of ['admin', 'customer', 'courier']) f.sessions[role] = await f.ok('/auth/demo-login', 'POST', { role, ...(role === 'courier' ? { phone: '13812345678' } : {}) })
}
const codOrder = async (f, role, key) => {
  const created = await f.ok('/orders', 'POST', { idempotencyKey: key, items: [{ sku: 'water-18_9l', quantity: 1 }], payment: '货到付款', deliveryWindow: '明天 10:00–11:00', tickets: [] }, role)
  return f.ok(`/orders/${created.id}/pay`, 'POST', { payment: '货到付款' }, role)
}

test('F1/F2 真实HTTP：首次同步前派单可在详情接单；扫码签收不自动接单；工作台工具签收展示的下一单而非之前查看的单', async t => {
  const f = await bootApi('courier'); t.after(f.close)
  await withReport('courier-f1-f2', async facts => {
    await demoSessions(f)
    const courierId = f.sessions.courier.profile.id
    f.db.prepare('UPDATE orders SET courier_id=NULL,courier_name=NULL WHERE courier_id=?').run(courierId)
    f.sessions.c2 = await f.ok('/auth/register', 'POST', { name: '王二', phone: '13700000002', password, address: '翡翠城 9 幢 901 室', stationId: 'station-001' })
    const P = await codOrder(f, 'customer', 'review-f2-p')
    await f.ok(`/orders/${P.id}/assign`, 'POST', { courierId }, 'admin')
    const toasts = [], dials = []
    const service = realService(forwardTo(f.base), { sessions: { courier: f.sessions.courier.token }, toasts })
    const { ctx } = pageContext('delivery', service.api, { showToast: ({ title }) => toasts.push(title), makePhoneCall: ({ phoneNumber }) => dials.push(phoneNumber) })
    ctx.startSync = () => {}; ctx.stopSync = () => {}; ctx.screen = 'workbench'; ctx.online = true
    ctx.courierProfile = await service.api.getCourierProfile()
    await ctx.loadOrders()
    assert.equal(ctx.screen, 'workbench'); assert.equal(ctx.pendingOrder, undefined, '首次同步前的派单不弹提醒（原先唯一接单入口）')
    ctx.selectOrder(ctx.orders.find(row => row.id === P.id))
    assert.equal(ctx.canAcceptSelected, true)
    ctx.open('sign'); ctx.signMethod = 'scan'; ctx.receiptCode = '000000'; ctx.confirmed = true
    await ctx.finishSign()
    const afterScan = { ...f.db.prepare('SELECT status,receipt_code receiptCode FROM orders WHERE id=?').get(P.id) }
    facts.scanOnPending = { toast: toasts.at(-1), db: afterScan }
    assert.deepEqual(afterScan, { status: '待配送', receiptCode: null }, '扫码签收不能自动接单并生成新签收码')
    ctx.goBack(); assert.equal(ctx.screen, 'delivery-detail')
    await ctx.acceptSelectedOrder()
    const accepted = f.db.prepare('SELECT status,dispatch_status dispatchStatus,receipt_code receiptCode FROM orders WHERE id=?').get(P.id)
    facts.accepted = { ...accepted, receiptCode: accepted.receiptCode ? '<6 digits>' : null, uiStatus: ctx.selectedOrder.status }
    assert.equal(accepted.status, '配送中'); assert.match(String(accepted.receiptCode), /^\d{6}$/); assert.equal(ctx.selectedOrder.status, '配送中')
    ctx.open('sign'); assert.equal(ctx.signOptions.find(item => item.id === 'ticket').available, true, '接单后货到付款可上门收票')
    // 规则变更：未由水站发放给该客户的纸质票不能回收；后端原因原样显示一次（种子 JT000200-299 为未发放号段）
    ctx.signMethod = 'ticket'; ctx.ticketType = '纸质票'; ctx.ticketCode = 'JT000201'; toasts.length = 0
    await ctx.addTicket()
    const direct = await f.request('/courier/ticket-redemptions', 'POST', { orderId: P.id, tickets: [{ type: '纸质票', code: 'JT000201' }], preview: true }, 'courier')
    facts.unissuedPaperTicket = { toasts: [...toasts], server: { status: direct.status, message: direct.message } }
    assert.equal(direct.status, 400); assert.deepEqual(toasts, [direct.message]); assert.match(direct.message, /尚未由水站发放给该客户/); assert.deepEqual(ctx.collectTickets, [])
    ctx.goBack(); ctx.goBack(); assert.equal(ctx.screen, 'workbench')

    const X = await codOrder(f, 'customer', 'review-f1-x'), Y = await codOrder(f, 'c2', 'review-f1-y')
    for (const row of [X, Y]) { await f.ok(`/orders/${row.id}/assign`, 'POST', { courierId }, 'admin'); await f.ok(`/orders/${row.id}/accept`, 'POST', {}, 'courier') }
    await ctx.loadOrders()
    const next = ctx.nextOrder, viewed = ctx.activeOrders.find(row => row.status === '配送中' && row.phone !== next.phone)
    assert.ok(next && viewed, '需要两个不同客户的配送中任务')
    ctx.selectOrder(viewed); await ctx.loadOrders(); ctx.goBack(); await ctx.loadOrders()
    assert.equal(ctx.activeOrder.id, next.id)
    ctx.callCustomer(); assert.equal(dials.at(-1), String(next.phone).replace(/\D/g, ''))
    ctx.signNextOrder(); ctx.confirmed = true; await ctx.finishSign()
    const rows = Object.fromEntries(f.db.prepare('SELECT id,status,pay_status payStatus FROM orders WHERE id IN (?,?)').all(next.id, viewed.id).map(row => [row.id, row]))
    facts.f1 = { workbenchNext: next.id, previouslyViewed: viewed.id, dialed: dials.at(-1), db: rows }
    assert.equal(rows[next.id].status, '已完成'); assert.equal(rows[viewed.id].status, '配送中', '之前查看过的订单不能被签收')
    await new Promise(done => setTimeout(done, 650)); assert.equal(ctx.screen, 'workbench'); assert.equal(ctx.selectedOrder, null)
  })
})

test('F3/F4 真实HTTP：电子票有效期显示本地日期；水票支付待配送订单可取消并退回水票，只提示一次', async t => {
  const f = await bootApi('tickets'); t.after(f.close)
  await withReport('tickets-f3-f4', async facts => {
    await demoSessions(f)
    const customerId = f.sessions.customer.profile.id, expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()
    await f.ok('/admin/electronic-tickets', 'POST', { customerId, skuCode: 'water-18_9l', count: 2, expiresAt }, 'admin')
    const toasts = [], service = realService(forwardTo(f.base), { sessions: { customer: f.sessions.customer.token }, toasts })
    const member = pageContext('member', service.api, { showToast: ({ title }) => toasts.push(title) }).ctx
    await member.loadTickets()
    const electronic = member.tickets.filter(ticket => ticket.type === '电子'), stored = new Date((await f.ok('/tickets', 'GET', undefined, 'customer')).find(ticket => ticket.ticketType === '电子票').expiresAt)
    const expected = `${stored.getFullYear()}-${String(stored.getMonth() + 1).padStart(2, '0')}-${String(stored.getDate()).padStart(2, '0')}`
    facts.f4 = { issuedExpiresAt: expiresAt, displayed: electronic.map(ticket => ticket.date) }
    assert.equal(electronic.length, 2); assert.ok(electronic.every(ticket => ticket.date === expected), JSON.stringify(facts.f4))
    await member.loadAssets(); await member.loadStations()
    const station = (await f.ok('/catalog/stations')).find(item => item.name === member.account.stationName)
    facts.paperTicketNote = member.paperTicketNote
    assert.ok(station?.phone); assert.ok(member.paperTicketNote.includes(`${station.name}（电话 ${station.phone}）`), member.paperTicketNote)

    const pick = (await f.ok('/account/tickets/available?sku=water-18_9l', 'GET', undefined, 'customer')).filter(ticket => ticket.type === '电子票').slice(0, 1).map(ticket => ({ type: ticket.type, code: ticket.code, skuCode: ticket.skuCode }))
    const created = await f.ok('/orders', 'POST', { idempotencyKey: 'review-f3-ticket', items: [{ sku: 'water-18_9l', quantity: 1 }], payment: '水票支付', deliveryWindow: '明天 10:00–11:00', tickets: pick }, 'customer')
    const { ctx } = pageContext('order', service.api, { showToast: ({ title }) => toasts.push(title) })
    ctx.startSync = () => {}
    ctx.selectOrder(ctx.mapOrder(await service.api.getOrder(created.id)))
    assert.equal(ctx.selectedOrder.payment, '水票支付'); assert.equal(ctx.canCancelOrder, true)
    toasts.length = 0
    await ctx.cancelSelectedOrder()
    const ticketAfter = (await f.ok('/tickets', 'GET', undefined, 'customer')).find(ticket => ticket.code === pick[0].code)
    facts.f3 = { orderId: created.id, uiStatus: ctx.selectedOrder.status, toasts: [...toasts], ticketStatusAfter: ticketAfter.status, db: f.db.prepare('SELECT status,refund_status refundStatus FROM orders WHERE id=?').get(created.id) }
    assert.equal(ctx.selectedOrder.status, '已取消'); assert.equal(facts.f3.db.status, '已取消'); assert.equal(ticketAfter.status, '可用')
    assert.deepEqual(toasts, ['订单已取消，水票已退回账户'])
  })
})

test('F6 真实HTTP（演示登录关闭）：访客打开首页不请求受保护接口、不跳登录；之后密码登录照常', async t => {
  const f = await bootApi('guest', { demoAuth: false }); t.after(f.close)
  await withReport('guest-f6', async facts => {
    const service = realService(forwardTo(f.base)), storage = new Map(), navigations = []
    globalThis.getCurrentPages = () => [{ route: 'pages/index/index' }]
    const { ctx, component } = pageContext('index', service.api, { getSystemInfoSync: () => ({ statusBarHeight: 20 }), getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), navigateTo: options => navigations.push(options.url) })
    ctx.$nextTick = fn => fn(); ctx.$refs = {}; ctx.showToast = () => {}
    component.onLoad.call(ctx, {})
    await waitFor(() => ctx.guest && !ctx.catalogLoading && ctx.stations.length > 0, 'guest home loaded'); await settle()
    facts.guestRequests = [...new Set(service.calls.map(call => call.path))]
    assert.equal(ctx.screen, 'home'); assert.ok(ctx.products.length > 0)
    assert.ok(service.calls.every(call => call.path === '/api/config' || call.path.startsWith('/api/catalog/')), JSON.stringify(facts.guestRequests))
    assert.deepEqual(service.navigations, []); assert.equal((await f.request('/account')).status, 401, '受保护接口仍需登录')
    ctx.go('profile'); assert.equal(ctx.screen, 'auth')
    ctx.authForm.phone = '13888888888'; ctx.authForm.password = password
    ctx.authConsent = true; await ctx.submitAuth(); await waitFor(() => ctx.profileLoaded, 'profile after login')
    facts.afterLogin = { screen: ctx.screen, guest: ctx.guest, stationName: ctx.account.stationName }
    assert.equal(ctx.screen, 'profile'); assert.equal(ctx.guest, false); assert.ok(ctx.account.stationName)
  })
})

test('F7 真实HTTP：/account 返回 wechatBound=false 时，小程序结算页建单前拦截微信支付，不产生待付款单', async t => {
  const f = await bootApi('wechat'); t.after(f.close)
  await withReport('wechat-f7', async facts => {
    await demoSessions(f)
    const toasts = [], service = realService(forwardTo(f.base), { sessions: { customer: f.sessions.customer.token }, toasts })
    const { ctx } = pageContext('order', service.api, { showToast: ({ title }) => toasts.push(title), getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} })
    ctx.appConfig = { ...ctx.appConfig, wechatPay: true, simulatedPayments: false } // 模拟小程序已开通真实微信支付
    ctx.checkout = { station: '中央站', items: [{ sku: 'water-18_9l', qty: 1 }] }
    ctx.quote = await service.api.previewOrder({ items: [{ sku: 'water-18_9l', quantity: 1 }], tickets: [] })
    ctx.payMethod = 'wechat'; await ctx.loadAccount()
    const count = () => f.db.prepare('SELECT COUNT(*) count FROM orders WHERE customer_id=?').get(f.sessions.customer.profile.id).count, before = count()
    facts.account = { wechatBound: ctx.account.wechatBound, payMethodAfterLoad: ctx.payMethod }
    assert.equal(ctx.account.wechatBound, false); assert.equal(ctx.payMethod, 'cod')
    ctx.payMethod = 'wechat'; await ctx.submitPayment()
    facts.submit = { ordersBefore: before, ordersAfter: count(), toast: toasts.at(-1) }
    assert.equal(count(), before); assert.match(toasts.at(-1), /未绑定微信/)
  })
})

test('F14 真实HTTP：连点领取只发一次；重复领取/积分券领取被拒只提示一次', async t => {
  const f = await bootApi('coupons'); t.after(f.close)
  await withReport('coupons-f14', async facts => {
    await demoSessions(f)
    const pointsCoupon = await f.ok('/admin/coupons', 'POST', { name: '积分兑换券', type: '无门槛券', discount: 3, totalQuantity: 5, pointsCost: 100, status: '启用' }, 'admin')
    const toasts = [], service = realService(forwardTo(f.base), { sessions: { customer: f.sessions.customer.token }, toasts })
    const { ctx } = pageContext('member', service.api, { showToast: ({ title }) => toasts.push(title), showModal: options => options.success({ confirm: true }) })
    await ctx.loadAssets()
    const free = ctx.coupons.find(coupon => !coupon.pointsCost && !coupon.customerCouponId)
    assert.ok(free, '需要一张可免费领取的券')
    const first = ctx.pickCoupon(free); await ctx.pickCoupon(free); await first
    const claims = service.calls.filter(call => call.method === 'POST' && call.path.endsWith('/claim'))
    assert.equal(claims.length, 1); assert.deepEqual(toasts, ['优惠券领取成功'])
    toasts.length = 0; await ctx.claimCoupon({ couponId: free.couponId })
    facts.duplicate = [...toasts]
    assert.equal(toasts.length, 1); assert.match(toasts[0], /每人限领一次/)
    toasts.length = 0; await ctx.claimCoupon({ couponId: pointsCoupon.id })
    facts.pointsClaim = [...toasts]
    assert.deepEqual(toasts, ['该优惠券需使用 100 积分兑换'])
    const issued = coupon => f.db.prepare('SELECT COUNT(*) count FROM customer_coupons WHERE coupon_id=? AND customer_id=?').get(coupon, f.sessions.customer.profile.id).count
    facts.db = { free: issued(free.couponId), points: issued(pointsCoupon.id) }
    assert.deepEqual(facts.db, { free: 1, points: 0 })
  })
})
