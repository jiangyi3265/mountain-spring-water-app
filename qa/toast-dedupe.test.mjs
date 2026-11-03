import assert from 'node:assert/strict'
import test from 'node:test'
import { pageContext } from './order-pagination-harness.mjs'
import { realService } from './review-fixes-harness.mjs'

// 写操作失败时接口层会弹一次错误，页面 catch 又用同一句 toast 一次；同一错误只应出现一次，其它提示照常。
test('接口层刚弹出的错误，页面不再重复弹同一句；不同提示照常显示', async () => {
  const toasts = []
  const service = realService(() => Promise.reject(Object.assign(new Error('库存不足，无法取消'), { status: 409 })), { sessions: { customer: 'fixture-token' }, toasts })
  // 每次接口失败只抵消页面的一次同句提示（2026-09-30 起：避免误吞紧接着另一操作的同句失败），所以每个页面各自先失败一次
  for (const page of ['order', 'member', 'delivery']) {
    await assert.rejects(service.api.cancelOrder('DD-FIXTURE'), /库存不足/)
    const { ctx } = pageContext(page, service.api, { showToast: ({ title }) => toasts.push(title) })
    ctx.toast('库存不足，无法取消')
    ctx.toast('订单已刷新')
  }
  assert.deepEqual(toasts, ['库存不足，无法取消', '订单已刷新', '库存不足，无法取消', '订单已刷新', '库存不足，无法取消', '订单已刷新'], 'each API toast appears once; the page does not repeat it')
  await assert.rejects(service.api.cancelOrder('DD-FIXTURE'), /库存不足/)
  const { ctx: home } = pageContext('index', service.api)
  home.showToast('库存不足，无法取消')
  assert.equal(home.toast, '', 'home page inline toast skips the duplicate')
  home.showToast('已加入购物车')
  assert.equal(home.toast, '已加入购物车')
})
