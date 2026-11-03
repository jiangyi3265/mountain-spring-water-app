import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { encodeQr } from '../services/qr.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('详情立即购买不受购物车勾选影响；空购物车不得隐式购买详情商品', () => {
  const source = read('pages/index/index.vue').split('<script>')[1].split('</script>')[0].replace(/^import .*$/gm, '').replace('export default', 'return')
  const writes = [], navigations = [], messages = []
  const component = new Function('uni', 'MobileHeader', 'WaterJug', 'ProductRow', 'BottomNav', 'AppIcon', 'ConsentNotice', source)({ setStorageSync: (key, value) => writes.push({ key, value }), navigateTo: value => navigations.push(value) })
  const ctx = { screen: 'detail', detailProduct: { sku: 'detail-B', name: '商品B', price: 20 }, account: { stationName: '中央站' }, stations: [], cartStations: [{ name: '中央站', items: [{ sku: 'cart-A', checked: true, qty: 3 }] }], showToast: message => messages.push(message) }
  component.methods.openOrder.call(ctx)
  assert.deepEqual(writes[0].value.items.map(item => [item.sku, item.qty]), [['detail-B', 1]])
  assert.equal(writes[0].value.station, '中央站')
  assert.equal(writes[0].value.fromCart, false)
  ctx.screen = 'cart'; component.methods.openOrder.call(ctx)
  assert.deepEqual(writes[1].value.items.map(item => [item.sku, item.qty]), [['cart-A', 3]])
  ctx.cartStations[0].items[0].checked = false; component.methods.openOrder.call(ctx)
  ctx.screen = 'detail'; ctx.detailProduct = null; component.methods.openOrder.call(ctx)
  assert.equal(writes.length, 2); assert.equal(navigations.length, 2); assert.equal(messages.length, 2)
})

test('商城和订单接口失败时不回退到可操作的演示业务数据', () => {
  const shop = read('pages/index/index.vue')
  const order = read('pages/order/index.vue')
  assert.match(shop, /products:\s*\[\]/)
  assert.doesNotMatch(shop, /product-00[1-5]/)
  assert.match(shop, /catalogError/)
  assert.match(order, /checkout:null/)
  assert.match(order, /orders:\s*\[\]/)
  assert.doesNotMatch(order, /QD202505/)
})

test('迟到付款的已取消订单不能展示支付成功页', async () => {
  const source = read('pages/order/index.vue').split('<script>')[1].split('</script>')[0]
  const method = source.match(/async waitForPayment\(orderId\)\{([^\n]+)\},/)[1]
  const wait = new Function('waterApi', `return async function(orderId){${method}}`)({ getOrder: async () => ({ status: '已取消', payStatus: '已支付', paymentRecoveryStatus: '待退款' }) })
  await assert.rejects(() => wait('cancelled'), /订单已取消.*退款核对/)
})

test('微信绑定只接受既有密码账号且真实支付只由支付流程确认', () => {
  const shop = read('pages/index/index.vue')
  const order = read('pages/order/index.vue')
  assert.match(shop, /if\(bindingWechat\)\{const code=await this\.freshWechatCode\(\);await waterApi\.wechatLogin\(\{code,phone:form\.phone,password:form\.password\}\)/)
  assert.match(shop, /openWechatBinding\(\)/)
  assert.match(shop, /wechatLogin\(\{ code: res\.code \}\)/)
  assert.doesNotMatch(shop, /if\(bindingWechat\)\{let newlyRegistered|newlyRegistered=true/)
  assert.doesNotMatch(shop, /wechatLogin\(\{code:this\.pendingWechatCode,\.\.\.payload\}\)/)
  assert.doesNotMatch(shop, /wechatLogin\(\{[^}]*name:|wechatLogin\(\{[^}]*address:/)
  assert.match(order, /waterApi\.wechatPrepay\(order\.id\)/)
  assert.match(order, /uni\.requestPayment/)
  assert.match(order, /waitForPayment/)
})

test('水票、签收码和客户确认收货均连接真实接口', () => {
  const order = read('pages/order/index.vue')
  const delivery = read('pages/delivery/index.vue')
  assert.match(order, /waterApi\.listAvailableTickets/)
  assert.match(order, /tickets:this\.selectedTickets/)
  assert.match(order, /payment=this\.ticketOnly\?'水票支付'/)
  assert.match(order, /if\(payment==='水票支付'\)return order/)
  assert.doesNotMatch(order, /Number\(order\.amount\)===0[^\n]+payOrder/)
  assert.match(order, /waterApi\.confirmReceipt/)
  assert.match(order, /<QrCode[^>]+receiptCode/)
  assert.match(delivery, /available:true[^\n]+id:'scan'|id:'scan'[^\n]+available:true/)
  assert.match(delivery, /payload\.receiptCode=this\.receiptCode\.trim\(\)/)
})

test('送水员使用密码认证且接单状态以服务端结果为准', () => {
  const delivery = read('pages/delivery/index.vue')
  assert.match(delivery, /waterApi\.loginWithPassword\('courier'/)
  assert.match(delivery, /await waterApi\.setCourierOnline\(requested\)/)
  assert.match(delivery, /this\.online=Boolean\(profile\.online\)/)
  assert.doesNotMatch(delivery, /water_courier_online/)
  assert.match(delivery, /todayOrders\(\)/)
})

test('客户签收二维码包含四模块静区且可被标准解码器还原', async () => {
  const value = '483921'
  const matrix = encodeQr(value)
  assert.ok(matrix.length >= 29)
  assert.ok(matrix.slice(0, 4).every(row => row.every(cell => !cell)), '顶部应有 4 模块静区')
  assert.ok(matrix.every(row => row.slice(0, 4).every(cell => !cell)), '左侧应有 4 模块静区')

  const scale = 8
  const width = matrix.length * scale
  const rgba = Buffer.alloc(width * width * 4, 255)
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix.length; column += 1) {
      if (!matrix[row][column]) continue
      for (let y = row * scale; y < (row + 1) * scale; y += 1) {
        for (let x = column * scale; x < (column + 1) * scale; x += 1) {
          const offset = (y * width + x) * 4
          rgba[offset] = 0
          rgba[offset + 1] = 0
          rgba[offset + 2] = 0
        }
      }
    }
  }
  const require = createRequire(import.meta.url)
  const QrCodeReader = require('qrcode-reader')
  const decoded = await new Promise((resolveDecoded, rejectDecoded) => {
    const reader = new QrCodeReader()
    reader.callback = (error, result) => error ? rejectDecoded(error) : resolveDecoded(result.result)
    reader.decode({ width, height: width, data: rgba })
  })
  assert.equal(decoded, value)
})
