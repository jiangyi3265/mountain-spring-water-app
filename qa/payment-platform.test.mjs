import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function service(platform, config) {
  // Match uni's conditional compilation for this one platform block.
  const source = readFileSync(new URL('../services/waterApi.js', import.meta.url), 'utf8')
    .replace(/\/\/ #ifdef MP-WEIXIN([\s\S]*?)\/\/ #endif/g, (_, body) => platform === 'mp-weixin' ? body : '')
    .replaceAll('import.meta.env', 'testEnv').replace('export const waterApi =', 'globalThis.waterApi =').replace('export { API_BASE_URL }', '')
  const requests = []
  const context = vm.createContext({ testEnv: {}, console, uni: {
    login() {}, requestPayment() {}, getStorageSync: () => ({ token: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), profile: { id: 'fixture' } }),
    request(options) { requests.push(options); options.success({ statusCode: 200, data: { code: 0, data: options.url.endsWith('/config') ? config : {} } }) },
    showToast() {},
  } })
  vm.runInContext(source, context)
  return { api: context.waterApi, requests }
}

test('H5即使服务端已开通支付，也不得调用充值、微信建单或预下单接口', async () => {
  const { api, requests } = service('h5', { wechatPay: true, wechatLogin: true, onlineRecharge: true, simulatedPayments: false })
  const config = await api.getConfig()
  assert.equal(config.wechatPay, false); assert.equal(config.wechatLogin, false); assert.equal(config.onlineRecharge, false)
  await assert.rejects(api.createRecharge({ amount: 1, idempotencyKey: 'blocked' }), /小程序/)
  await assert.rejects(api.createOrder({ payment: '微信支付' }), /小程序/)
  await assert.rejects(api.wechatPrepay('existing-order'), /小程序/)
  assert.ok(requests.every(request => request.url.endsWith('/config')))
})

test('小程序保留真实支付能力，开发模拟不能覆盖已配置的真实支付', async () => {
  const { api } = service('mp-weixin', { wechatPay: true, wechatLogin: true, onlineRecharge: true, simulatedPayments: true })
  const config = await api.getConfig()
  assert.equal(config.wechatPay, true); assert.equal(config.wechatLogin, true); assert.equal(config.onlineRecharge, true)
  assert.equal(config.simulatedPayments, false)
})

test('隔离H5联调可模拟支付，未开通支付仍不可充值', async () => {
  const simulated = service('h5', { wechatPay: false, onlineRecharge: true, simulatedPayments: true })
  assert.equal((await simulated.api.getConfig()).onlineRecharge, true)
  await simulated.api.createRecharge({ amount: 1, idempotencyKey: 'fixture' })
  assert.ok(simulated.requests.some(request => request.url.endsWith('/recharges')))
  const disabled = service('mp-weixin', { wechatPay: false, simulatedPayments: false, onlineRecharge: false })
  await assert.rejects(disabled.api.createRecharge({ amount: 1 }), /未开通|未配置/)
})

test('充值请求丢失响应后，刷新重进以同一幂等键恢复；成功后才允许新一笔', async () => {
  const storage = new Map(), payloads = [], messages = []
  const source = readFileSync(new URL('../pages/member/index.vue', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0]
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast: value => messages.push(value.title) }
  const api = { createRecharge: async value => {
    payloads.push(value)
    if(payloads.length===1)throw new Error('response lost')
    return { recharge: { id:'CZ1',state:'已支付' }, simulated:false }
  }, getRecharge: async () => ({ id:'CZ1',state:'已支付',amount:1,bonus:0 }) }
  const page = new Function('uni', 'waterApi', 'MobileHeader', 'AppIcon', source.replace(/^import .*$/gm, '').replace('export default', 'return'))(uni, api)
  const reopen = () => {
    const ctx = { ...page.data() }
    for (const [name, method] of Object.entries(page.methods)) ctx[name] = method.bind(ctx)
    ctx.appConfig.onlineRecharge=true;ctx.account.id='customer-fixture';ctx.rechargeCustom='1'
    ctx.loadAssets=async()=>{};ctx.loadRecharge=async()=>{}
    return ctx
  }
  await reopen().submitRecharge()
  assert.equal(storage.size,1)
  await reopen().submitRecharge()
  assert.equal(payloads[0].idempotencyKey,payloads[1].idempotencyKey)
  assert.equal(storage.size,0)
  assert.match(messages.at(-1),/充值成功/)
  await reopen().submitRecharge()
  assert.notEqual(payloads[2].idempotencyKey,payloads[1].idempotencyKey)
})

test('不同充值意图分别持久保存，旧页面完成不能删除新页面的恢复键', async () => {
  const storage=new Map(),pending=[],confirmations=new Map()
  const source=readFileSync(new URL('../pages/member/index.vue',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0]
  const api={createRecharge:async input=>{pending.push(input);if(input.amount===2)throw new Error('response lost');return {recharge:{id:'CZ1',state:'待支付'},simulated:true}},simulateRecharge:async()=>{}}
  const uni={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),showToast(){}}
  const page=new Function('uni','waterApi','MobileHeader','AppIcon',source.replace(/^import .*$/gm,'').replace('export default','return'))(uni,api)
  const open=amount=>{const ctx={...page.data()};for(const [name,method] of Object.entries(page.methods))ctx[name]=method.bind(ctx);ctx.appConfig.onlineRecharge=true;ctx.account.id='customer-fixture';ctx.rechargeCustom=String(amount);ctx.loadAssets=async()=>{};ctx.loadRecharge=async()=>{};ctx.waitForRecharge=()=>new Promise(resolve=>confirmations.set(amount,resolve));return ctx}
  const a=open(1).submitRecharge()
  while(!confirmations.has(1))await new Promise(resolve=>setImmediate(resolve))
  await open(2).submitRecharge()
  const secondKey=pending[1].idempotencyKey
  assert.equal(storage.size,2)
  confirmations.get(1)({state:'已支付',amount:1});await a
  assert.equal(storage.size,1)
  await open(2).submitRecharge()
  assert.equal(pending[2].idempotencyKey,secondKey)
  const ctx=open(2),key=[...storage.keys()][0]
  ctx.clearPendingRecharge(key,'older-key')
  assert.equal(storage.size,1,'同一意图更晚写入的键也不能被旧结果删除')
})
