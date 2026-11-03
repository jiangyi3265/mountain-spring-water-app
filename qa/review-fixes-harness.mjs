import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import vm from 'node:vm'

// Shared helpers for the 2026-09-28 independent-review regression tests.
// Page methods run verbatim through order-pagination-harness.pageContext; the service is the real services/waterApi.js.

/** Real services/waterApi.js in its own VM realm. `handler(call)` answers every uni.request (path, method, data, token). */
export function realService(handler, { sessions = {}, toasts = [], globals = {} } = {}) {
  const storage = new Map(Object.entries(sessions).map(([role, token]) => [`water_session_${role}`, { token, expiresAt: new Date(Date.now() + 3600000).toISOString(), profile: { id: `${role}-fixture` } }]))
  const calls = [], navigations = []
  const source = readFileSync(new URL('../services/waterApi.js', import.meta.url), 'utf8').replaceAll('import.meta.env', 'testEnv').replace('export const waterApi =', 'globalThis.waterApi =').replace('export { API_BASE_URL }', '')
  const uni = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    showToast: ({ title }) => toasts.push(title), reLaunch: options => { navigations.push(options.url); options.complete?.() },
    request: options => {
      const url = new URL(options.url), call = { path: url.pathname, params: Object.fromEntries(url.searchParams), method: options.method || 'GET', data: options.data, token: options.header.Authorization?.replace('Bearer ', '') }
      calls.push(call)
      Promise.resolve().then(() => handler(call)).then(
        result => result && result.__http ? options.success({ statusCode: result.status, data: result.body }) : options.success({ statusCode: 200, data: { code: 0, data: result } }),
        error => options.success({ statusCode: error.status || 503, data: { code: error.status || 503, message: error.message } }))
    },
  }
  // globals：可注入 getCurrentPages 等小程序全局函数
  const context = vm.createContext({ testEnv: { VITE_WATER_API_URL: 'http://127.0.0.1/api' }, console, uni, ...globals })
  vm.runInContext(source, context)
  return { api: context.waterApi, storage, calls, navigations, toasts, uni }
}

/** Forward a realService call to a real HTTP server (method, JSON body, bearer token) and pass the envelope through unchanged. */
export function forwardTo(base) {
  return async ({ path, params, method, data, token }) => {
    const query = new URLSearchParams(params).toString()
    const response = await fetch(`${base}${path.slice(4)}${query ? `?${query}` : ''}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' || data === undefined ? undefined : JSON.stringify(data) })
    return { __http: true, status: response.status, body: await response.json().catch(() => ({})) }
  }
}

export const settle = async (rounds = 30) => { for (let i = 0; i < rounds; i++) await new Promise(done => setImmediate(done)) }
export async function waitFor(check, label = 'condition', timeout = 5000) {
  const started = Date.now()
  while (!check()) { if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`); await new Promise(done => setTimeout(done, 10)) }
}
export const templateOf = page => readFileSync(new URL(`../pages/${page}/index.vue`, import.meta.url), 'utf8').split('<script>')[0]

/** Every order timeline action the snapshot backend can emit (insertEvent / updateState / seed timelines). */
export async function backendOrderActions() {
  const root = new URL('../../water-api/', import.meta.url)
  const files = [new URL('server.mjs', root), ...(await readdir(new URL('lib/', root))).filter(name => name.endsWith('.mjs')).map(name => new URL(`lib/${name}`, root))]
  const actions = new Set()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/insertEvent\([^;]*?action:\s*([^,}]+)/g)) for (const literal of match[1].matchAll(/'([a-z][a-z-]*)'/g)) actions.add(literal[1])
    for (const match of source.matchAll(/updateState\([^;]*?\},\s*'([a-z][a-z-]*)'/g)) actions.add(match[1])
    for (const match of source.matchAll(/timeline:\s*\[\{[^\]]*?action:\s*'([a-z][a-z-]*)'/g)) actions.add(match[1])
  }
  return actions
}

const evidenceRoot = process.env.QA_EVIDENCE_DIR ? resolve(process.env.QA_EVIDENCE_DIR, 'review-fixes-mobile') : fileURLToPath(new URL('../../.qa-runtime/review-fixes-20260928/mobile/', import.meta.url))
export const evidence = resolve(evidenceRoot, `run-${Date.now()}-${process.pid}`)
export const password = 'ReviewFixes!2026'

/** Snapshot water-api on an ephemeral loopback port with a throwaway SQLite file; no production, no external network. */
export async function bootApi(label, { demoAuth = true } = {}) {
  process.env.NODE_ENV = 'test'
  await mkdir(evidence, { recursive: true })
  const { createWaterApi } = await import('../../water-api/server.mjs')
  const { createWechatClient, createGeocoder, createOssClient } = await import('../../water-api/lib/integrations.mjs')
  const app = await createWaterApi({ dataFile: `${evidence}/${label}-${Date.now()}.sqlite`, tokenSecret: 'review-fixes-isolated-test-signing-secret-2026', defaultPassword: password, seedDemoData: true, demoAuthEnabled: demoAuth, simulatedPaymentsEnabled: false,
    integrations: { wechat: createWechatClient({}), oss: createOssClient({}), geocoder: createGeocoder({}) } })
  await new Promise(done => app.server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${app.server.address().port}/api`, sessions = {}
  const request = async (path, method = 'GET', body, role) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(sessions[role] ? { Authorization: `Bearer ${sessions[role].token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, ...await res.json().catch(() => ({})) }
  }
  const ok = async (...args) => { const result = await request(...args); assert.ok(result.status < 300, `${args[1] || 'GET'} ${args[0]}: ${JSON.stringify(result)}`); return result.data }
  const close = () => new Promise(done => app.server.close(done))
  return { app, db: app.store.db, base, sessions, request, ok, close }
}
