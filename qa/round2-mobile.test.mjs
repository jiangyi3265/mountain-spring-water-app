// 2026-09-30 第二轮独立复核（真机登录、小程序兼容、演示入口）发现问题的移动端回归。
// 页面方法与服务层均执行项目源码（pageContext / realService），不复制实现。
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { chooseFromList, MORE_LABEL } from '../services/actionSheet.js'
import { pageContext, order } from './order-pagination-harness.mjs'
import { realService, settle } from './review-fixes-harness.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setTimeout(resolve))

test('选项超过 6 个时分页显示（微信 showActionSheet 最多 6 项），选择结果对应原列表下标；取消与失败分别处理', async () => {
  const sheets = []
  const sheet = options => sheets.push(options)
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const chosen = chooseFromList(seven, { sheet })
  assert.deepEqual(sheets[0].itemList, ['a', 'b', 'c', 'd', 'e', MORE_LABEL])
  assert.ok(sheets[0].itemList.length <= 6)
  sheets[0].success({ tapIndex: 5 })
  assert.deepEqual(sheets[1].itemList, ['f', 'g'])
  sheets[1].success({ tapIndex: 1 })
  assert.equal(await chosen, 6)
  const six = chooseFromList(seven.slice(0, 6), { sheet })
  assert.deepEqual(sheets[2].itemList, seven.slice(0, 6), 'six items fit in one sheet without paging')
  sheets[2].fail({ errMsg: 'showActionSheet:fail cancel' })
  assert.equal(await six, -1)
  const broken = chooseFromList(['x'], { sheet })
  sheets[3].fail({ errMsg: 'showActionSheet:fail parameter error' })
  await assert.rejects(broken, /选项打开失败/)
})

test('订单页：凌晨时段有 7 个配送时段也能选中最后一个；此前在微信里点击没有任何反应', async () => {
  const sheets = []
  const { ctx } = pageContext('order', {}, { showActionSheet: options => sheets.push(options) })
  ctx.deliveryWindows = ['今天 09:00–10:00', '今天 10:00–11:00', '今天 11:00–12:00', '今天 14:00–15:00', '今天 15:00–16:00', '今天 16:00–17:00', '今天 17:00–18:00']
  ctx.chooseWindow()
  assert.equal(sheets[0].itemList.length, 6)
  sheets[0].success({ tapIndex: 5 }); sheets[1].success({ tapIndex: 1 }); await tick()
  assert.equal(ctx.deliveryWindow, '今天 17:00–18:00')
})

test('订单页：订阅消息深链接带订单号直接打开该订单（走真实 onLoad/onShow 与自动同步）；“我的”入口的分类参数在小程序里手动解码', async () => {
  // 未列出的接口一律返回空结果，页面其余加载照常进行
  const known = {
    getOrder: async id => order(id, '配送中'),
    listOrders: async params => (params?.page ? { items: [], total: 0, page: params.page, pageSize: 20 } : []),
    getConfig: async () => ({}),
  }
  const api = new Proxy(known, { get: (target, name) => target[name] || (async () => ({})) })
  const storage = { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} }
  const deepLink = pageContext('order', api, storage)
  Object.assign(deepLink.ctx, { $nextTick: callback => callback?.(), $refs: {} })
  try {
    deepLink.component.onLoad.call(deepLink.ctx, { screen: 'detail', id: encodeURIComponent('DD20260930001') })
    deepLink.component.onShow?.call(deepLink.ctx)
    await settle()
    assert.equal(deepLink.ctx.screen, 'detail')
    assert.equal(deepLink.ctx.selectedOrder?.id, 'DD20260930001')
  } finally { deepLink.ctx.stopSync(); deepLink.ctx.pageDisposed = true }
  const tabbed = pageContext('order', api, storage)
  try {
    tabbed.component.onLoad.call(tabbed.ctx, { screen: 'orders', tab: encodeURIComponent('待配送') })
    assert.equal(tabbed.ctx.activeTab, '待配送')
  } finally { tabbed.ctx.stopSync(); tabbed.ctx.pageDisposed = true }
  assert.equal(tabbed.ctx.decodeQuery('100%'), '100%', 'malformed input falls back to the raw value')
})

test('订阅授权必须在点击回调里同步调用：触发它的三个按钮带 data-eventsync', () => {
  const template = read('pages/order/index.vue').split('<script>')[0]
  assert.equal([...template.matchAll(/data-eventsync="true" @click="submit(Payment|Refund)"/g)].length, 3)
})

test('跨角色切换：另一角色迟到的 401 不把用户拉回刚离开的角色，本角色仍正常跳转登录', () => {
  let route = 'pages/index/index'
  const service = realService(() => ({}), { globals: { getCurrentPages: () => [{ route }] } })
  service.api.showLogin('courier')
  assert.deepEqual(service.navigations, [], 'a courier 401 on the customer home does not navigate')
  service.api.showLogin('customer')
  assert.deepEqual(service.navigations, ['/pages/index/index?screen=auth'])
  route = 'pages/delivery/index'
  service.api.showLogin('customer')
  assert.equal(service.navigations.length, 1, 'a customer 401 on the courier page does not navigate')
  service.api.showLogin('courier')
  assert.equal(service.navigations.at(-1), '/pages/delivery/index?screen=login')
})

test('客户登录被拒且密码含中文/全角/空格时给出可操作的提示；普通输错不加这句', async () => {
  const api = { loginWithPassword: async () => { throw Object.assign(new Error('手机号或密码错误'), { statusCode: 401 }) } }
  const { ctx } = pageContext('index', api, { setStorageSync() {} })
  Object.assign(ctx, { authMode: 'login', authConsent: true, authForm: { ...ctx.authForm, phone: '13900000000', password: 'Demo！abc123' } })
  await ctx.submitAuth()
  assert.match(ctx.authError, /^手机号或密码错误。密码里含有中文、全角或空格字符/)
  ctx.authForm.password = 'Demo!abc124'
  await ctx.submitAuth()
  assert.equal(ctx.authError, '手机号或密码错误')
  const template = read('pages/index/index.vue').split('<script>')[0]
  assert.doesNotMatch(template, /@confirm="authMode === 'login' && submitAuth\(\)"/, 'the keyboard “done” key no longer submits (one attempt was counted twice)')
  assert.match(template, /class="courier-login"[^>]*@click="openDelivery\('workbench'\)"/, 'an existing courier session goes straight to the workbench')
})

test('配送员登录：可显示密码；被拒时弹窗说明完整原因与字符提示；启动时会话失效会停止轮询', async () => {
  const modals = []
  const api = { getConfig: async () => ({ demoAuth: false }), loginWithPassword: async () => { throw Object.assign(new Error('手机号或密码错误'), { statusCode: 401 }) } }
  const { ctx, component } = pageContext('delivery', api, { setStorageSync() {}, showModal: options => modals.push(options) })
  Object.assign(ctx, { authConsent: true, phone: '13900000002', password: 'abc 12345' })
  await ctx.login()
  assert.equal(modals.length, 1)
  assert.match(modals[0].content, /手机号或密码错误\n密码里含有中文、全角或空格字符/)
  const template = read('pages/delivery/index.vue').split('<script>')[0]
  assert.match(template, /:password="!passwordVisible"/)
  assert.match(template, /class="password-eye" role="button"/)
  // 登录表单里的第一个按钮必须是“登录工作台”（自动化脚本与读屏都按第一个按钮提交；显示密码开关不是 button）
  assert.match(template, /<view class="login-form">(?:(?!<button)[\s\S])*<button :disabled="loginLoading" @click="login">/)
  assert.match(template, /v-model="receiptCode" type="number"/, 'numeric keyboard for the 6-digit sign code (inputmode is ignored by mini programs)')
  // 启动时会话已失效：回登录页并停止轮询，不再 3 秒后自己刷新清空输入
  const stopped = []
  const expired = pageContext('delivery', { getConfig: async () => ({}), hasSession: () => true, getCourierProfile: async () => { throw Object.assign(new Error('登录凭据已失效'), { statusCode: 401 }) }, clearLocalSession: () => {} })
  expired.ctx.stopSync = () => stopped.push('stop'); expired.ctx.startSync = () => stopped.push('start')
  expired.component.onLoad.call(expired.ctx, { screen: 'workbench' }); await settle()
  assert.equal(expired.ctx.screen, 'login')
  assert.equal(stopped.at(-1), 'stop')
  void component
})

test('配送员“我的”页：退出按钮不再被底部导航遮住（紧凑三屏用弹性布局并在末尾留出导航空间）；登录页返回按钮在遮罩之上', () => {
  const source = read('pages/delivery/index.vue')
  assert.match(source, /'compact-layout':\['orders','messages','mine'\]\.includes\(screen\)/)
  assert.match(source, /\.delivery-page\.compact-layout > \.work-scroll\{flex:1;min-height:0;height:auto\}/)
  assert.match(source, /<view class="nav-spacer" aria-hidden="true"\/>\s*<\/scroll-view>/)
  assert.match(source, /\.login-screen > \.customer-home-button\{[^}]*position:relative;z-index:2\}/)
})

test('提示去重只抵消一次：接口层弹过的错误页面不重复弹，紧接着另一操作以同一句失败时照常提示', async () => {
  const toasts = []
  const service = realService(() => Promise.reject(Object.assign(new Error('服务繁忙，请稍后重试'), { status: 503 })), { sessions: { customer: 'fixture-token' }, toasts })
  await assert.rejects(service.api.cancelOrder('DD-FIXTURE'))
  const { ctx } = pageContext('order', service.api, { showToast: ({ title }) => toasts.push(title) })
  ctx.toast('服务繁忙，请稍后重试')
  assert.deepEqual(toasts, ['服务繁忙，请稍后重试'], 'the page catch does not repeat the API toast')
  ctx.toast('服务繁忙，请稍后重试')
  assert.deepEqual(toasts, ['服务繁忙，请稍后重试', '服务繁忙，请稍后重试'], 'a second failure with the same text is still shown')
})

test('小程序图片：附件写成本地文件后显示与预览（避免超过 setData 上限、预览不支持 data:）；大图上传前先压缩', async () => {
  const { toDisplaySource, removeDisplaySource, compressIfLarge, UPLOAD_SOFT_LIMIT } = await import('../services/imageFiles.js')
  const plain = await toDisplaySource('data:image/png;base64,AAAA', 'k')
  assert.deepEqual(plain, { src: 'data:image/png;base64,AAAA', tempFile: '' }, 'outside the mini program the data URL is used directly')
  const writes = [], removed = []
  globalThis.wx = { env: { USER_DATA_PATH: 'wxfile://usr' } }
  globalThis.uni = { getFileSystemManager: () => ({ writeFile: options => { writes.push(options); options.success() }, unlink: options => removed.push(options.filePath) }), compressImage: options => options.success({ tempFilePath: `${options.src}.small` }) }
  try {
    const display = await toDisplaySource('data:image/png;base64,AAAA', 'k')
    assert.match(display.src, /^wxfile:\/\/usr\/attachment-[0-9a-f]+\.png$/)
    assert.deepEqual([writes[0].data, writes[0].encoding], ['AAAA', 'base64'])
    removeDisplaySource(display.tempFile)
    assert.deepEqual(removed, [display.src])
    assert.equal(await compressIfLarge('tmp://photo.jpg', UPLOAD_SOFT_LIMIT + 1), 'tmp://photo.jpg.small')
    assert.equal(await compressIfLarge('tmp://photo.jpg', 1024), 'tmp://photo.jpg')
  } finally {
    delete globalThis.wx; delete globalThis.uni
  }
})
