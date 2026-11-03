import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compile } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import postcss from 'postcss'
import * as Vue from 'vue'
import { navigationMetrics } from '../services/navigation.js'

test('客户登录样式先导入 auth.css，再声明配送入口样式，避免构建忽略 @import', () => {
  const source = readFileSync(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parseSfc(source)
  assert.deepEqual(errors, [])
  const inlineStyles = descriptor.styles.filter(style => !style.src)
  assert.ok(inlineStyles.length > 0)
  const statements = postcss.parse(inlineStyles[0].content).nodes.filter(node => node.type !== 'comment')
  const first = statements[0]
  assert.equal(first?.type, 'atrule', '首条有效 CSS 语句必须是 auth.css 导入，不能是新增样式规则')
  assert.equal(first.name, 'import')
  assert.equal(first.params.replace(/^['"]|['"]$/g, ''), './auth.css')
  assert.ok(statements.findIndex(node => node.type === 'rule' && node.selector === '.courier-login') > 0, '保留配送入口样式并置于导入之后')
  for (const style of inlineStyles) {
    let ruleSeen = false
    for (const node of postcss.parse(style.content).nodes) {
      if (node.type === 'comment') continue
      if (node.type === 'atrule' && node.name === 'import') assert.equal(ruleSeen, false, '所有 @import 都必须位于样式规则之前')
      else if (!(node.type === 'atrule' && (node.name === 'charset' || (node.name === 'layer' && !node.nodes)))) ruleSeen = true
    }
  }
})

for (const [name, status, width, top, height, left] of [
  ['Android', 24, 375, 30, 32, 278],
  ['iPhone 刘海屏', 44, 390, 50, 32, 293],
  ['iPhone 灵动岛', 59, 393, 65, 32, 296],
  ['小屏紧凑胶囊', 20, 320, 24, 32, 225],
]) {
  test(`${name} 标题中心与真实胶囊对齐，并留出右侧空间`, () => {
    const metrics = navigationMetrics({ statusBarHeight: status, windowWidth: width }, { top, height, left }, true)
    assert.equal(metrics.statusHeight + metrics.navHeight / 2, top + height / 2)
    assert.equal(metrics.headerHeight, status + metrics.navHeight)
    assert.ok(width - metrics.sideWidth <= left - 8)
  })
}

test('H5不绘制假的系统状态栏，API缺失或胶囊异常时保留安全间距', () => {
  assert.deepEqual(navigationMetrics(), { statusHeight: 0, navHeight: 44, headerHeight: 44, sideWidth: 52 })
  assert.equal(navigationMetrics({}, null, true).headerHeight, 64)
  assert.equal(navigationMetrics({ statusBarHeight: 0 }, null, true).headerHeight, 44)
  assert.equal(navigationMetrics({ statusBarHeight: 44 }, { top: 0, height: 0, left: 0 }, true).headerHeight, 88)
  const source = readFileSync(new URL('../components/MobileHeader.vue', import.meta.url), 'utf8')
  const template = source.split('</template>')[0]
  assert.doesNotMatch(template, /9:41|status-icons|capsule-line|•••|▮/)
  assert.match(source, /getMenuButtonBoundingClientRect/)
  assert.match(source, /offWindowResize/)
})

// Render the real templates and invoke their click handlers; no server or login fixture is used.
function componentFixture(path, { env = {}, uni = {}, api = {} } = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const script = source.split('<script>')[1].split('</script>')[0]
  const imports = [...script.matchAll(/^import (\w+) from /gm)].map(match => match[1])
  const component = new Function('uni', 'waterApi', 'navigationMetrics', 'env', ...imports,
    script.replace(/^import .*$/gm, '').replaceAll('import.meta.env', 'env').replace('export default', 'return'))(uni, api, navigationMetrics, env)
  const ctx = { ...component.data(), $emit() {} }
  for (const [name, prop] of Object.entries(component.props || {})) ctx[name] = prop.default
  for (const [name, method] of Object.entries(component.methods || {})) ctx[name] = method.bind(ctx)
  for (const [name, getter] of Object.entries(component.computed || {})) Object.defineProperty(ctx, name, { get: () => getter.call(ctx) })
  const template = source.slice(source.indexOf('<template>') + 10, source.lastIndexOf('</template>'))
  const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true, isCustomElement: () => true }).code)(Vue)
  return { ctx, component, render: () => render(ctx, []) }
}
function nodes(vnode) {
  if (!vnode || typeof vnode !== 'object') return []
  return [vnode, ...(Array.isArray(vnode.children) ? vnode.children.flatMap(nodes) : [])]
}
function label(vnode) {
  return typeof vnode.children === 'string' ? vnode.children : (Array.isArray(vnode.children) ? vnode.children.map(label).join('') : '')
}
function clickText(fixture, text) {
  const target = nodes(fixture.render()).find(node => typeof node.props?.onClick === 'function' &&
    (label(node) === text || nodes(node).some(child => child.type === 'text' && label(child) === text)))
  assert.ok(target, `真实模板中存在可点击入口：${text}`)
  return target.props.onClick()
}

test('客户登录和我的入口进入已注册配送页面；配送登录和我的均返回客户首页', () => {
  const routes = []
  const uni = { reLaunch: ({ url }) => routes.push(url) }
  const customer = componentFixture('../pages/index/index.vue', { uni })
  customer.ctx.screen = 'auth'
  clickText(customer, '配送员登录')
  // 2026-09-30 起直接进工作台：已有配送会话不必重新登录（每次重登都会多签发令牌）；无会话时由配送页回落到登录页（见下一条测试）
  assert.equal(routes.pop(), '/pages/delivery/index?screen=workbench')
  customer.ctx.screen = 'profile'
  clickText(customer, '配送工作台')
  assert.equal(routes.pop(), '/pages/delivery/index?screen=workbench')
  const courier = componentFixture('../pages/delivery/index.vue', { uni })
  for (const screen of ['login', 'mine']) {
    courier.ctx.screen = screen
    clickText(courier, '返回客户首页')
    assert.equal(routes.pop(), '/pages/index/index?screen=home')
  }
  const pages = JSON.parse(readFileSync(new URL('../pages.json', import.meta.url), 'utf8')).pages.map(page => page.path)
  assert.ok(pages.includes('pages/delivery/index'))
  assert.ok(pages.includes('pages/index/index'))
})

test('认证提交中不切换身份页面；工作台入口仍要求配送员会话', () => {
  const uni = { reLaunch: () => assert.fail('认证中不可跳转') }
  const customer = componentFixture('../pages/index/index.vue', { uni })
  customer.ctx.authSubmitting = true; customer.ctx.openDelivery('login')
  customer.ctx.authSubmitting = false; customer.ctx.wechatSubmitting = true; customer.ctx.openDelivery()
  const courier = componentFixture('../pages/delivery/index.vue', { uni, api: { getConfig: async () => ({}), hasSession: role => { assert.equal(role, 'courier'); return false } } })
  courier.ctx.loginLoading = true; courier.ctx.openCustomerHome()
  courier.component.onLoad.call(courier.ctx, { screen: 'workbench' })
  assert.equal(courier.ctx.screen, 'login')
})

test('配送页离开时执行现有轮询与倒计时清理', () => {
  const courier = componentFixture('../pages/delivery/index.vue')
  const stopped = []
  courier.ctx.stopSync = () => stopped.push('sync')
  courier.ctx.stopCountdown = () => stopped.push('countdown')
  courier.component.onUnload.call(courier.ctx)
  assert.equal(courier.ctx.pageDisposed, true)
  assert.deepEqual(stopped, ['sync', 'countdown'])
})

for (const flag of [undefined, '', 'false', 'TRUE', true, 'true']) {
  test(`仅明确字符串 VITE_WATER_DEMO=true 显示字幕（本例 ${String(flag)}）`, () => {
    const header = componentFixture('../components/MobileHeader.vue', { env: { VITE_WATER_DEMO: flag } })
    for (const title of ['', '商品详情']) {
      header.ctx.title = title
      const rendered = nodes(header.render())
      assert.equal(rendered.some(node => node.props?.class === 'nav-demo'), flag === 'true')
      if (flag === 'true') assert.ok(rendered.some(node => label(node) === '演示 · 虚拟资产'))
      assert.deepEqual(header.ctx.layout, navigationMetrics())
    }
  })
}

test('演示字幕不改变原生导航高度、返回按钮及胶囊预留空间', () => {
  const info = { statusBarHeight: 44, windowWidth: 390 }
  const capsule = { top: 50, height: 32, left: 293 }
  const uni = { getWindowInfo: () => info, getMenuButtonBoundingClientRect: () => capsule }
  for (const flag of ['false', 'true']) {
    const header = componentFixture('../components/MobileHeader.vue', { uni, env: { VITE_WATER_DEMO: flag } })
    header.ctx.title = '订单详情'; header.ctx.refresh()
    assert.deepEqual(header.ctx.layout, navigationMetrics(info, capsule, true))
    const rendered = nodes(header.render())
    const nav = rendered.find(node => node.props?.class === 'nav-bar')
    assert.deepEqual(nav.props.style, { height: '44px', paddingLeft: '105px', paddingRight: '105px' })
    assert.ok(rendered.find(node => node.props?.class === 'nav-back'))
    assert.ok(rendered.find(node => node.props?.class === 'nav-heading'))
  }
})
