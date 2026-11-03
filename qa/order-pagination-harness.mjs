import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Executes the production component methods and service, not copied implementations.
export function pageContext(name, api, uni = {}) {
  const source = readFileSync(new URL(`../pages/${name}/index.vue`, import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0]
  const imports = [...source.matchAll(/^import (\w+) from /gm)].map(match => match[1])
  // 页面对 services/ 下小工具的具名导入（waterApi 由测试注入）：内联真实源码，与页面共用这里的 uni 替身
  const helpers = [...source.matchAll(/^import \{[^}]+\} from '\.\.\/\.\.\/(services\/(?!waterApi)[^']+)'/gm)]
    .map(match => readFileSync(new URL(`../${match[1]}`, import.meta.url), 'utf8').replace(/^export /gm, '')).join('\n')
  const component = new Function('uni', 'waterApi', ...imports, `${helpers}\n${source.replace(/^import .*$/gm, '').replace('export default', 'return')}`)({ showToast() {}, pageScrollTo() {}, ...uni }, api)
  const ctx = { ...component.data() }
  for (const [key, method] of Object.entries(component.methods)) ctx[key] = method.bind(ctx)
  for (const [key, getter] of Object.entries(component.computed)) Object.defineProperty(ctx, key, { get: () => getter.call(ctx), configurable: true })
  return { ctx, component }
}

export function serviceContext(handler, sessions = {}) {
  const calls = []
  const storage = new Map(['customer', 'courier'].map(role => [`water_session_${role}`, { token: sessions[role] || role, expiresAt: new Date(Date.now() + 3600000).toISOString() }]))
  const source = readFileSync(new URL('../services/waterApi.js', import.meta.url), 'utf8').replaceAll('import.meta.env', 'testEnv').replace('export const waterApi =', 'globalThis.waterApi =').replace('export { API_BASE_URL }', '')
  const context = vm.createContext({ testEnv: { VITE_WATER_API_URL: 'http://127.0.0.1/api' }, console, uni: {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast() {}, reLaunch() {},
    request: options => {
      const call = { path: new URL(options.url).pathname, params: Object.fromEntries(new URL(options.url).searchParams), token: options.header.Authorization?.replace('Bearer ', '') }
      calls.push(call)
      Promise.resolve().then(() => handler(call)).then(data => options.success({ statusCode: 200, data: { code: 0, data } }), error => options.success({ statusCode: error.status || 503, data: { code: error.status || 503, message: error.message } }))
    },
  } })
  vm.runInContext(source, context)
  return { api: context.waterApi, calls, storage }
}

export function pagedFixture(rows, { params }) {
  const filtered = rows.filter(row => !params.status || row.status === params.status)
  if (!params.page) return filtered.slice(0, 300)
  const page = Number(params.page), pageSize = Math.min(200, Number(params.pageSize) || 20)
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize }
}

export const order = (id, status = '已完成', extra = {}) => ({ id, status, customer: id, product: '验收桶装水', quantity: 1, amount: 10, address: '隔离测试地址', createdAt: '2026-09-01T00:00:00Z', timeline: [], ...extra })
