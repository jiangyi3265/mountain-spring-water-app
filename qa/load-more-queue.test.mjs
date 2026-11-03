import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { order, pageContext } from './order-pagination-harness.mjs'
import { settle } from './review-fixes-harness.mjs'

// 2026-09-28 统一验收偶发失败的根因：页面每 3 秒自动同步，同步进行中点“加载更多”被 `if(ordersLoading)return` 静默丢弃，
// 用户看到的是“点了没反应”。修复后应排队，在本次同步结束后立即加载下一页。
const history = Array.from({ length: 5 }, (_, index) => order(`HIST${index + 1}`, '已完成'))
const pageOf = (params, size = 2) => ({ items: history.slice((params.page - 1) * size, params.page * size), total: history.length, page: params.page, pageSize: size })

test('送水员：自动同步进行中点“加载更多”排队执行，不被丢弃', async () => {
  const requests = []
  const api = { listCourierOrders: async params => { requests.push({ ...params }); return params.page ? pageOf(params) : [] } }
  const { ctx } = pageContext('delivery', api)
  Object.assign(ctx, { orderTab: '已完成', historyPage: 1, historyPageSize: 2, historyTotal: history.length, historyOrders: history.slice(0, 2), screen: 'orders' })
  assert.equal(ctx.historyHasMore, true)
  const background = ctx.loadOrders()
  assert.equal(ctx.ordersLoading, true, 'a background sync is in flight')
  ctx.loadMoreOrders()
  assert.equal(ctx.loadMorePending, true, 'the tap is queued, not dropped')
  await background
  await settle()
  assert.ok(requests.some(request => request.page === 2), 'page 2 requested after the sync finished')
  assert.equal(ctx.historyOrders.length, 4)
  assert.equal(ctx.loadMorePending, false)
})

test('客户：自动同步进行中点“加载更多订单”排队执行，不被丢弃', async () => {
  const requests = []
  const api = { listOrders: async params => { requests.push({ ...params }); return params.page ? pageOf(params) : history } }
  const { ctx } = pageContext('order', api)
  Object.assign(ctx, { activeTab: '全部', ordersPage: 1, ordersPageSize: 2, ordersTotal: history.length, orders: history.slice(0, 2), screen: 'orders' })
  assert.equal(ctx.ordersHasMore, true)
  const background = ctx.loadOrders()
  assert.equal(ctx.ordersLoading, true)
  ctx.loadMoreOrders()
  assert.equal(ctx.loadMorePending, true)
  await background
  await settle()
  assert.ok(requests.some(request => request.page === 2), 'page 2 requested after the sync finished')
  assert.equal(ctx.loadMorePending, false)
})

// 第 3 次整轮验收再现：按钮绑定 :disabled="ordersLoading"，同步期间 uni-button 处于禁用态会直接吞掉点击，
// 上面的排队逻辑根本收不到点击（浏览器复现：同步中点击 10/10 丢失）。按钮只在“加载更多”本身进行时禁用。
test('加载更多按钮只在加载更多进行中禁用，后台同步期间仍可点击以进入排队', () => {
  for (const [file, label] of [['../pages/order/index.vue', '加载更多订单'], ['../pages/delivery/index.vue', '加载更多历史订单']]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const button = source.match(new RegExp(`<button[^>]*@click="loadMoreOrders"[^>]*>[^<]*${label}`))?.[0]
    assert.ok(button, `${label} button found in ${file}`)
    assert.match(button, /:disabled="loadingMore"/, `${label} is disabled only while a load-more is in flight`)
    assert.doesNotMatch(button, /:disabled="ordersLoading"/, `${label} must stay clickable during a background sync`)
  }
})
