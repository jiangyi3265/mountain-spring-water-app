import assert from 'node:assert/strict'
import test from 'node:test'
import { pageContext, order } from './order-pagination-harness.mjs'

const lines = [{ skuCode: 'water', product: '水', quantity: 2, unitPrice: 29.95 }, { skuCode: 'bottled', product: '瓶装水', quantity: 1, unitPrice: 16 }]
function refundPage(status, extra = {}) {
  const requests = [], messages = []
  const { ctx } = pageContext('order', { createAftersale: async body => { requests.push(body); return { id: 'after-1' } } }, { showToast: ({ title }) => messages.push(title) })
  ctx.selectedOrder = order('A', status, { amount: 75.9, refundedAmount: 0, payStatus: '已支付', items: lines, ...extra })
  ctx.screen = 'refund'; ctx.initRefund(); ctx.requestSubscriptions = async () => {}
  ctx.open = () => {}
  return { ctx, requests, messages }
}

test('X07 会员只说明可兑现等级/积分/水票/优惠券；等级名称匹配服务端，无自动权益承诺', () => {
  const { ctx } = pageContext('member', {})
  assert.doesNotMatch(JSON.stringify([ctx.benefits, ctx.levelDefs]), /优先派单|专属客服|专属优惠|自动.*(?:发放|领取)|直接抵扣/)
  assert.deepEqual(ctx.levelDefs.map(level => level.name), ['清泉银卡', '清泉金卡', '清泉钻石卡'])
  assert.match(ctx.levelDefs[1].note, /1000/); assert.match(ctx.levelDefs[2].note, /3000/)
  assert.match(ctx.benefits.find(benefit => benefit.icon === 'coupon').note, /条件|选择/)
})

for (const status of ['待配送', '配送中']) test(`X09 ${status}仅退款满额、退货数量整单锁定且不能从方法改小`, async () => {
  const { ctx, requests } = refundPage(status, { refundedAmount: 5.01 })
  assert.equal(ctx.refundLocked, true); assert.equal(ctx.refundAmount, '70.89')
  ctx.pickRefundType(ctx.refundOptions.find(option => option.id === 'return'))
  ctx.changeRefundLine(ctx.refundLines[0], -1)
  assert.deepEqual(ctx.refundLines.map(line => line.quantity), [2, 1])
  await ctx.submitRefund()
  assert.deepEqual(requests[0].items, [{ skuCode: 'water', quantity: 2 }, { skuCode: 'bottled', quantity: 1 }])
  assert.equal(requests[0].amount, 70.89); assert.equal(requests[0].orderId, 'A')
})

test('X09 不依赖disabled：未签收篡改金额、商品数量、补送类型均不发送请求', async () => {
  for (const mutation of [ctx => { ctx.refundAmount = '1' }, ctx => { ctx.pickRefundType(ctx.refundOptions[1]); ctx.refundLines[0].quantity = 1 }, ctx => { ctx.refundType = 'resend'; ctx.initRefundLines() }]) {
    const { ctx, requests, messages } = refundPage('配送中')
    mutation(ctx); await ctx.submitRefund()
    assert.equal(requests.length, 0); assert.ok(messages.length)
  }
})

test('X09 已签收保留部分仅退款、部分退货和补送，未扩大锁定范围', async () => {
  for (const type of ['refund', 'return', 'resend']) {
    const { ctx, requests } = refundPage('已完成')
    ctx.pickRefundType(ctx.refundOptions.find(option => option.id === type))
    assert.equal(ctx.refundLocked, false)
    if (type === 'return') ctx.changeRefundLine(ctx.refundLines[0], -1)
    ctx.refundAmount = '1.25'; await ctx.submitRefund()
    assert.equal(requests[0].amount, type === 'resend' ? 0 : 1.25)
    if (type === 'return') assert.equal(requests[0].items[0].quantity, 1)
  }
})

test('X09 全水票零实付可整单退货返票，混合付款保持剩余满额；禁止仅退款', async () => {
  for (const status of ['待配送', '已完成']) for (const amount of [0, 16]) {
    const { ctx, requests } = refundPage(status, { amount, ticketAmount: 59.9 })
    assert.equal(ctx.refundType, 'return'); assert.equal(ctx.refundLocked, true)
    await ctx.submitRefund(); assert.equal(requests.length, 1); assert.equal(requests[0].amount, amount)
    assert.deepEqual(requests[0].items.map(item => item.quantity), [2, 1])
    const invalid = refundPage(status, { amount, ticketAmount: 59.9 })
    invalid.ctx.refundType = 'refund'; await invalid.ctx.submitRefund(); assert.equal(invalid.requests.length, 0)
  }
})

test('X09 金额非法/负数/超额仍拒绝，未签收没有正现金或水票不能零元退款', async () => {
  for (const amount of ['abc', '-1', '99', '0', '1.001']) {
    const { ctx, requests } = refundPage('已完成')
    ctx.refundAmount = amount; await ctx.submitRefund(); assert.equal(requests.length, 0, amount)
  }
  const { ctx, requests } = refundPage('待配送', { amount: 0 })
  await ctx.submitRefund(); assert.equal(requests.length, 0)
})

test('X09 退款仍保留selectionRevision：等待订阅时选择B不能提交A表单到B', async () => {
  const { ctx, requests } = refundPage('待配送')
  let release; ctx.requestSubscriptions = () => new Promise(resolve => { release = resolve })
  const pending = ctx.submitRefund()
  ctx.selectOrder(order('B', '待配送', { amount: 20, items: lines }))
  release(); await pending
  assert.equal(requests.length, 0); assert.equal(ctx.selectedOrder.id, 'B')
})

test('X09 服务端policy覆盖历史金额/剩余商品，不重复退回已回库数量', async () => {
  const { ctx, requests } = refundPage('配送中', { aftersalePolicy: { wholeRefundRequired: true, remainingAmount: 16, returnItems: [{ skuCode: 'water', quantity: 1 }], pendingRefund: false, allowZeroAmountReturn: false } })
  ctx.pickRefundType(ctx.refundOptions[1])
  assert.equal(ctx.refundAmount, '16.00'); assert.deepEqual(ctx.refundLines.map(line => [line.skuCode, line.max, line.quantity]), [['water', 1, 1]])
  await ctx.submitRefund(); assert.deepEqual(requests[0].items, [{ skuCode: 'water', quantity: 1 }]); assert.equal(requests[0].amount, 16)
})

test('X09 零元剩余商品退货仅policy允许时可提交；无剩余商品不能提交', async () => {
  for (const allowed of [false, true]) {
    const { ctx, requests } = refundPage('配送中', { aftersalePolicy: { wholeRefundRequired: true, remainingAmount: 0, returnItems: [{ skuCode: 'water', quantity: 1 }], pendingRefund: false, allowZeroAmountReturn: allowed } })
    ctx.pickRefundType(ctx.refundOptions[1]); await ctx.submitRefund()
    assert.equal(requests.length, Number(allowed)); if (allowed) assert.equal(requests[0].amount, 0)
  }
  const empty = refundPage('配送中', { aftersalePolicy: { remainingAmount: 0, returnItems: [], allowZeroAmountReturn: true } })
  empty.ctx.pickRefundType(empty.ctx.refundOptions[1]); await empty.ctx.submitRefund(); assert.equal(empty.requests.length, 0)
})

test('X09 进行中退款不能重复申请；policy缺少字段时兼容原订单金额商品', async () => {
  const pending = refundPage('配送中', { aftersalePolicy: { pendingRefund: true } })
  assert.equal(pending.ctx.refundableAmount, 75.9)
  pending.ctx.pickRefundType(pending.ctx.refundOptions[1]); assert.deepEqual(pending.ctx.refundLines.map(line => line.max), [2, 1])
  await pending.ctx.submitRefund(); assert.equal(pending.requests.length, 0)
})

test('X09 已取消历史单入口仅在服务端确认剩余款或零元退货时开放；不开放未支付/补送', () => {
  for (const policy of [{ remainingAmount: 5 }, { remainingAmount: 0, allowZeroAmountReturn: true }]) {
    assert.equal(refundPage('已取消', { aftersalePolicy: policy }).ctx.canApplyAftersale, true)
    assert.equal(refundPage('已取消', { aftersalePolicy: policy, payStatus: '未支付' }).ctx.canApplyAftersale, false)
    assert.equal(refundPage('已取消', { aftersalePolicy: policy, orderType: '补送' }).ctx.canApplyAftersale, false)
  }
  assert.equal(refundPage('已取消', { aftersalePolicy: { remainingAmount: 0, allowZeroAmountReturn: false } }).ctx.canApplyAftersale, false)
})
