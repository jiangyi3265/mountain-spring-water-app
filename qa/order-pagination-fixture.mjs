import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createWaterApi } from '../../water-api/server.mjs'
import { createWechatClient, createGeocoder, createOssClient } from '../../water-api/lib/integrations.mjs'

export const evidence = process.env.QA_EVIDENCE_DIR ? resolve(process.env.QA_EVIDENCE_DIR, 'order-pagination') : fileURLToPath(new URL('../../.qa-runtime/order-pagination-20260928/', import.meta.url))
export async function createFixture(label) {
  process.env.NODE_ENV = 'test'
  await mkdir(evidence, { recursive: true })
  const app = await createWaterApi({ dataFile: `${evidence}/${label}-${Date.now()}.sqlite`, tokenSecret: 'order-pagination-isolated-test-signing-secret', defaultPassword: 'PaginationOnly!2026', seedDemoData: true, demoAuthEnabled: true, simulatedPaymentsEnabled: false,
    integrations: { wechat: createWechatClient({}), oss: createOssClient({}), geocoder: createGeocoder({}) },
  })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}/api`, sessions = {}, db = app.store.db
  const request = async (path, method = 'GET', body, role = 'admin') => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(sessions[role] ? { Authorization: `Bearer ${sessions[role].token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const payload = await res.json()
    return { status: res.status, ...payload }
  }
  const ok = async (...args) => { const result = await request(...args); assert.ok(result.status < 300, `${args[0]}: ${JSON.stringify(result)}`); return result.data }
  const close = () => new Promise(resolve => app.server.close(resolve))
  try {
    for (const role of ['admin', 'customer', 'courier']) sessions[role] = await ok('/auth/demo-login', 'POST', { role, ...(role === 'courier' ? { phone: '13812345678' } : {}) }, 'anonymous')
    const customerId = sessions.customer.profile.id, courierId = sessions.courier.profile.id
    db.prepare('UPDATE orders SET courier_id=NULL,courier_name=NULL WHERE courier_id=?').run(courierId)
    const newTask = async key => {
      const created = await ok('/orders', 'POST', { sku: 'water-18_9l', quantity: 1, payment: '货到付款', idempotencyKey: key }, 'customer')
      await ok(`/orders/${created.id}/pay`, 'POST', {}, 'customer')
      await ok(`/orders/${created.id}/assign`, 'POST', { courierId })
      return created.id
    }
    const pendingId = await newTask('pagination-old-pending'), deliveringId = await newTask('pagination-old-delivering'), heldId = await newTask('pagination-old-held')
    await ok(`/orders/${deliveringId}/accept`, 'POST', {}, 'courier')
    await ok(`/orders/${heldId}/accept`, 'POST', {}, 'courier')
    // SQL volume/hold fixtures, not hundreds of claimed real fulfillments.
    db.prepare("UPDATE orders SET created_at='2026-08-01T00:00:00Z' WHERE id IN (?,?,?)").run(pendingId, deliveringId, heldId)
    db.prepare("UPDATE order_inventory_allocations SET status='已回补' WHERE order_id=?").run(heldId)
    const row = db.prepare('SELECT * FROM orders WHERE id=?').get(deliveringId), columns = Object.keys(row)
    const insert = db.prepare(`INSERT INTO orders(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
    const clones = (prefix, count, extra) => app.business.transaction(() => {
      for (let i = 0; i < count; i++) {
        const copy = { ...row, ...extra, id: `${prefix}-${String(i).padStart(4, '0')}`, idempotency_key: `${prefix}-${i}` }
        insert.run(...columns.map(key => copy[key]))
      }
    })
    clones('PAGE-HISTORY', 325, { status: '已完成', dispatch_status: '已完成', created_at: '2026-09-28T01:00:00Z', completed_at: '2026-09-28T02:00:00Z', pay_status: '已支付' })
    clones('PAGE-ACTIVE', 205, { status: '待配送', dispatch_status: '待接单', created_at: '2026-08-02T00:00:00Z' })
    clones('OTHER-OWNER', 3, { customer_id: 'seed-customer-2', courier_id: 'courier-002', status: '待配送', created_at: '2026-09-28T03:00:00Z' })
    return { app, db, base, sessions, request, ok, close, newTask, pendingId, deliveringId, heldId, customerId, courierId }
  } catch (error) { await close(); throw error }
}
