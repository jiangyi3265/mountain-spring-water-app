import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile } from 'node:fs/promises'
import { createFixture, evidence } from './followup-business-fixture.mjs'

test('X09 真实HTTP拒绝未签收部分退款/部分退货，拒绝时不写售后或更改金额库存', async () => {
  const f = await createFixture('api-negative'), report = { startedAt: new Date().toISOString(), cases: [] }
  try {
    for (const status of ['待配送', '配送中']) for (const kind of ['partial-refund', 'partial-return']) {
      const order = await f.createOrder(`${status}-${kind}`, { status })
      const before = f.db.prepare('SELECT status,refunded_cents FROM orders WHERE id=?').get(order.id)
      const stock = f.db.prepare('SELECT * FROM order_inventory_allocations WHERE order_id=? ORDER BY sku_id').all(order.id)
      const body = { orderId: order.id, type: kind === 'partial-refund' ? '仅退款' : '退货退款', amount: kind === 'partial-refund' ? 1 : order.amount, reason: '隔离验收：未签收不能部分退款', ...(kind === 'partial-return' ? { items: [{ skuCode: order.items[0].skuCode, quantity: 1 }] } : {}) }
      const response = await f.request('/aftersales', 'POST', body)
      const count = f.db.prepare('SELECT COUNT(*) count FROM aftersales WHERE order_id=?').get(order.id).count
      report.cases.push({ status, kind, orderId: order.id, httpStatus: response.status, message: response.message, aftersaleCount: count })
      assert.equal(response.status, 400, JSON.stringify(report.cases.at(-1)))
      assert.equal(count, 0)
      assert.deepEqual(f.db.prepare('SELECT status,refunded_cents FROM orders WHERE id=?').get(order.id), before)
      assert.deepEqual(f.db.prepare('SELECT * FROM order_inventory_allocations WHERE order_id=? ORDER BY sku_id').all(order.id), stock)
    }
  } catch (error) { report.error = error.stack; throw error }
  finally { report.finishedAt = new Date().toISOString(); await writeFile(`${evidence}/api-negative-${Date.now()}.json`, JSON.stringify(report, null, 2)); await f.close() }
})
