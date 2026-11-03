import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createWaterApi } from '../../water-api/server.mjs'
import { createWechatClient, createGeocoder, createOssClient } from '../../water-api/lib/integrations.mjs'

const evidenceRoot = process.env.QA_EVIDENCE_DIR ? resolve(process.env.QA_EVIDENCE_DIR, 'followup-business-mobile') : fileURLToPath(new URL('../../.qa-runtime/followup-business-20260928/mobile/', import.meta.url))
export const evidence = resolve(evidenceRoot, `run-${Date.now()}-${process.pid}`)
export const password = 'BusinessFollowup!2026'
export async function createFixture(label) {
  process.env.NODE_ENV = 'test'
  await mkdir(evidence, { recursive: true })
  const app = await createWaterApi({ dataFile: `${evidence}/${label}-${Date.now()}.sqlite`, tokenSecret: 'followup-business-isolated-test-signing-secret', defaultPassword: password, seedDemoData: true, demoAuthEnabled: true, simulatedPaymentsEnabled: false,
    integrations: { wechat: createWechatClient({}), oss: createOssClient({}), geocoder: createGeocoder({}) },
  })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${app.server.address().port}/api`, sessions = {}, db = app.store.db
  const request = async (path, method = 'GET', body, role = 'customer') => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(sessions[role] ? { Authorization: `Bearer ${sessions[role].token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, ...await res.json() }
  }
  const ok = async (...args) => { const result = await request(...args); assert.ok(result.status < 300, `${args[0]}: ${JSON.stringify(result)}`); return result.data }
  const close = () => new Promise(resolve => app.server.close(resolve))
  try {
    for (const role of ['admin', 'customer', 'courier']) sessions[role] = await ok('/auth/demo-login', 'POST', { role, ...(role === 'courier' ? { phone: '13812345678' } : {}) }, 'anonymous')
    const customerId = sessions.customer.profile.id, courierId = sessions.courier.profile.id
    await ok(`/admin/customers/${customerId}/account-adjustments`, 'POST', { balanceDelta: 3000, idempotencyKey: 'followup-business-funds', note: '隔离业务验收备用金' }, 'admin')
    const createOrder = async (key, { status = '待配送', tickets = [], items = [{ sku: 'water-18_9l', quantity: 2 }, { sku: 'bottled-550-12', quantity: 1 }] } = {}) => {
      let order = await ok('/orders', 'POST', { idempotencyKey: key, items, tickets, payment: '余额支付' })
      if (order.payStatus !== '已支付') order = await ok(`/orders/${order.id}/pay`, 'POST', {})
      if (status !== '待配送') {
        await ok(`/orders/${order.id}/assign`, 'POST', { courierId }, 'admin')
        await ok(`/orders/${order.id}/accept`, 'POST', {}, 'courier')
        if (status === '已完成') await ok(`/orders/${order.id}/complete`, 'POST', { signMethod: 'manual' }, 'courier')
      }
      return ok(`/orders/${order.id}`)
    }
    const completeAftersale = async id => {
      await ok(`/admin/aftersales/${id}/status`, 'PUT', { status: '已通过' }, 'admin')
      return ok(`/admin/aftersales/${id}/status`, 'PUT', { status: '已完成' }, 'admin')
    }
    return { app, db, base, sessions, request, ok, close, createOrder, completeAftersale, customerId, courierId }
  } catch (error) { await close(); throw error }
}
