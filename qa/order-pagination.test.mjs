import assert from 'node:assert/strict'
import test from 'node:test'
import { order, pagedFixture, pageContext, serviceContext } from './order-pagination-harness.mjs'

function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('IR-M01：A详情迟到不能替换B，也不能让取消请求发给A', async () => {
  const a=order('A','待付款'), b=order('B','待付款'), entered=deferred(), release=deferred(), cancelled=[]
  const {ctx}=pageContext('order', {listOrders:async()=>({items:[a,b],total:2,page:1,pageSize:20}),getOrder:async id=>{if(id==='A'){entered.resolve();await release.promise}return id==='A'?a:b},cancelOrder:async id=>{cancelled.push(id);return {...b,status:'已取消'}}})
  ctx.startSync=()=>{};ctx.screen='detail';ctx.selectOrder(a)
  const loading=ctx.loadOrders();await entered.promise;ctx.selectOrder(b);release.resolve();await loading
  assert.equal(ctx.selectedOrder.id,'B')
  await ctx.cancelSelectedOrder();assert.deepEqual(cancelled,['B'])
})

test('IR-M02：旧创建的新派单A提醒和接单目标必须为A，不得取已有B', async () => {
  let rows=[order('B','待配送')];const accepted=[]
  const {api}=serviceContext(call=>pagedFixture(rows,call))
  api.acceptOrder=async id=>{accepted.push(id);rows=rows.map(o=>o.id===id?{...o,status:'配送中'}:o);return rows.find(o=>o.id===id)}
  const {ctx}=pageContext('delivery',api);ctx.startSync=()=>{};ctx.screen='workbench';ctx.online=true
  await ctx.loadOrders();rows.push(order('A','待配送'));await ctx.loadOrders()
  assert.equal(ctx.screen,'alert');assert.equal(ctx.pendingOrder.id,'A')
  await ctx.acceptOrder();assert.deepEqual(accepted,['A'])
})

for(const change of ['A-B-A','unload','refresh'])test(`IR-M01：${change}使旧详情代次失效`,async t=>{
  const stale=order('A','待付款',{customer:'旧快照'}),fresh={...stale,customer:'新选择'},entered=deferred(),release=deferred();let reads=0
  const {ctx,component}=pageContext('order',{listOrders:async()=>({items:[fresh],total:1,page:1,pageSize:20}),getOrder:async()=>{if(++reads===1){entered.resolve();await release.promise;return stale}return fresh}})
  t.after(()=>ctx.stopSync());ctx.screen='detail';ctx.selectedOrder=fresh
  const pending=ctx.loadOrders();await entered.promise
  if(change==='A-B-A'){ctx.startSync=()=>{};ctx.selectOrder(order('B'));ctx.selectOrder(fresh)}
  if(change==='unload')component.onUnload.call(ctx)
  if(change==='refresh')ctx.startSync()
  release.resolve();await pending
  assert.equal(ctx.selectedOrder.customer,'新选择');assert.equal(ctx.selectedOrder.id,'A')
  if(change==='refresh')assert.equal(reads,2,'刷新后重新读取而非复用旧详情')
})

for(const operation of ['cancelSelectedOrder','paySelectedOrder','confirmSelectedReceipt']){
  for(const phase of ['write-response','list-followup'])test(`IR-M01：${operation} ${phase}迟到不能覆盖B或跳走`,async()=>{
    const a=order('A',operation==='confirmSelectedReceipt'?'已完成':'待付款',{payment:'货到付款'}),b=order('B','待付款'),entered=deferred(),release=deferred(),writes=[]
    let holdDetail=false
    const write=async id=>{writes.push(id);if(phase==='write-response'){entered.resolve();await release.promise}else holdDetail=true;return {...a,status:'已完成'}}
    const {ctx}=pageContext('order',{listOrders:async()=>({items:[a,b],total:2,page:1,pageSize:20}),getOrder:async id=>{if(holdDetail){holdDetail=false;entered.resolve();await release.promise}return id==='A'?a:b},cancelOrder:write,confirmReceipt:write})
    ctx.settleOrder=order=>write(order.id);ctx.startSync=()=>{};ctx.selectOrder(a)
    const pending=ctx[operation]();await entered.promise;ctx.selectOrder(b);release.resolve();await pending
    assert.deepEqual(writes,['A']);assert.equal(ctx.selectedOrder.id,'B');assert.equal(ctx.screen,'detail');assert.equal(ctx.submitting,false)
  })
}

test('IR-M01：取消成功后的同ID旧GET不能把已取消状态改回待付款',async()=>{
  const old=order('A','待付款'),entered=deferred(),release=deferred()
  const {ctx}=pageContext('order',{listOrders:async()=>({items:[old],total:1,page:1,pageSize:20}),getOrder:async()=>{entered.resolve();await release.promise;return old},cancelOrder:async()=>({...old,status:'已取消'})})
  ctx.startSync=()=>{};ctx.selectOrder(old);const loading=ctx.loadOrders();await entered.promise
  await ctx.cancelSelectedOrder();release.resolve();await loading
  assert.equal(ctx.selectedOrder.status,'已取消')
})

test('IR-M02：多新单队列固定提醒对象，撤单/改派剔除后绝不接其他单',async t=>{
  let rows=[order('B','待配送')];const accepted=[]
  const {api}=serviceContext(call=>pagedFixture(rows,call));api.acceptOrder=async id=>{accepted.push(id);throw new Error('不应接单')}
  const {ctx}=pageContext('delivery',api);t.after(()=>ctx.stopCountdown());ctx.startSync=()=>{};ctx.screen='workbench';ctx.online=true
  await ctx.loadOrders();rows.push(order('A','待配送'),order('C','待配送'));await ctx.loadOrders()
  assert.equal(ctx.pendingOrder.id,'A');await ctx.loadOrders();assert.equal(ctx.pendingOrder.id,'A')
  rows=rows.filter(row=>row.id!=='A');await ctx.acceptOrder()
  assert.deepEqual(accepted,[]);assert.equal(ctx.pendingOrder.id,'C')
  ctx.dismissAlert();assert.equal(ctx.screen,'workbench');await ctx.loadOrders();assert.equal(ctx.screen,'workbench')
})

test('IR-M02：接单核验中队列A-B-A或卸载，旧点击不继续POST；连点只核验一次',async t=>{
  for(const change of ['A-B-A','unload']){
    let rows=[order('B','待配送')],delay=false;const entered=deferred(),release=deferred(),accepted=[]
    const {api}=serviceContext(async call=>{if(delay&&call.params.status==='待配送'){delay=false;entered.resolve();await release.promise}return pagedFixture(rows,call)})
    api.acceptOrder=async id=>{accepted.push(id);return order(id,'配送中')}
    const {ctx,component}=pageContext('delivery',api);t.after(()=>ctx.stopCountdown());ctx.startSync=()=>{};ctx.screen='workbench';ctx.online=true
    await ctx.loadOrders();rows.push(order('A','待配送'));await ctx.loadOrders();delay=true
    const pending=ctx.acceptOrder();await entered.promise;await ctx.acceptOrder()
    if(change==='A-B-A'){ctx.setAlertQueue(['B']);ctx.setAlertQueue(['A'])}else component.onUnload.call(ctx)
    release.resolve();await pending;assert.deepEqual(accepted,[]);assert.equal(ctx.alertAccepting,false)
  }
})

for(const operation of ['cancelSelectedOrder','paySelectedOrder','confirmSelectedReceipt'])test(`IR-M01：${operation}响应跨卸载或A-B-A不能恢复旧选择快照`,async()=>{
  for(const change of ['unload','A-B-A']){
    const a=order('A',operation==='confirmSelectedReceipt'?'已完成':'待付款',{payment:'货到付款',customer:'初始'}),entered=deferred(),release=deferred()
    const write=async()=>{entered.resolve();await release.promise;return {...a,status:'已完成',customer:'旧响应'}}
    const {ctx,component}=pageContext('order',{cancelOrder:write,confirmReceipt:write})
    ctx.startSync=()=>{};ctx.settleOrder=write;ctx.selectOrder(a)
    const pending=ctx[operation]();await entered.promise
    if(change==='unload')component.onUnload.call(ctx);else{ctx.selectOrder(order('B'));ctx.selectOrder({...a,customer:'重新选择A'})}
    release.resolve();await pending
    assert.equal(ctx.selectedOrder.customer,change==='unload'?'初始':'重新选择A');assert.equal(ctx.screen,'detail')
  }
})

test('同类送水员签收迟到响应不能覆盖后来选择B或把B页面跳走',async()=>{
  const a=order('A','配送中'),b=order('B','配送中'),entered=deferred(),release=deferred(),completed=[]
  const {ctx}=pageContext('delivery',{completeOrder:async id=>{completed.push(id);entered.resolve();await release.promise;return {...a,status:'已完成'}}})
  ctx.startSync=()=>{};ctx.selectOrder(a);ctx.open('sign');ctx.confirmed=true // 签收需送水员核对订单后显式勾选确认
  const pending=ctx.finishSign();await entered.promise;ctx.selectOrder(b);release.resolve();await pending
  assert.deepEqual(completed,['A']);assert.equal(ctx.selectedOrder.id,'B');assert.equal(ctx.screen,'delivery-detail')
})

test('IR-M02：精确接单POST未决时改选B，迟到成功不覆盖B，重复点击不重复POST',async t=>{
  let rows=[order('B','待配送')];const entered=deferred(),release=deferred(),accepted=[]
  const {api}=serviceContext(call=>pagedFixture(rows,call));api.acceptOrder=async id=>{accepted.push(id);entered.resolve();await release.promise;return order(id,'配送中')}
  const {ctx}=pageContext('delivery',api);t.after(()=>ctx.stopCountdown());ctx.startSync=()=>{};ctx.screen='workbench';ctx.online=true
  await ctx.loadOrders();rows.push(order('A','待配送'));await ctx.loadOrders()
  const pending=ctx.acceptOrder();await entered.promise;await ctx.acceptOrder();ctx.selectOrder(rows[0]);release.resolve();await pending
  assert.deepEqual(accepted,['A']);assert.equal(ctx.selectedOrder.id,'B');assert.equal(ctx.screen,'delivery-detail')
})

test('同类售后提交：授权等待中改选B，不把A的表单或附件提交到B',async()=>{
  const a=order('A','已完成'),b=order('B','已完成'),entered=deferred(),release=deferred(),writes=[]
  const {ctx}=pageContext('order',{createAftersale:async value=>writes.push(value)})
  ctx.startSync=()=>{};ctx.selectOrder(a);ctx.refundAmount='1'
  ctx.requestSubscriptions=async()=>{entered.resolve();await release.promise}
  const pending=ctx.submitRefund();await entered.promise;ctx.selectOrder(b);release.resolve();await pending
  assert.deepEqual(writes,[]);assert.equal(ctx.selectedOrder.id,'B');assert.equal(ctx.screen,'detail')
})

test('列表兼容调用逐页取完：客户首页计数和送水员任务不截断于300单', async () => {
  const rows = Array.from({ length: 423 }, (_, i) => order(`history-${i}`))
  const h = serviceContext(call => pagedFixture(rows, call))
  for (const method of ['listOrders', 'listCourierOrders']) assert.equal((await h.api[method]()).length, 423)
  assert.ok(h.calls.every(call => Number(call.params.page) >= 1))
  assert.deepEqual([...new Set(h.calls.map(call => call.token))], ['customer', 'courier'])
})

test('F03：历史超过300，所有待配送、配送中和暂停任务完整可达', async () => {
  const rows = [...Array.from({ length: 320 }, (_, i) => order(`history-${i}`)), ...Array.from({ length: 225 }, (_, i) => order(`pending-${i}`, '待配送')), order('old-delivering', '配送中'), order('held', '配送中', { fulfillmentHoldReason: '退货暂停配送' })]
  const h = serviceContext(call => pagedFixture(rows, call)), { ctx } = pageContext('delivery', h.api)
  ctx.screen = 'workbench'; ctx.online = true
  await ctx.loadOrders()
  assert.equal(ctx.activeOrderCount, 227)
  assert.equal(ctx.deliveryStats.pending, 225)
  assert.equal(ctx.deliveryStats.delivering, 2, '状态统计包含暂停任务，下一单仍排除暂停')
  assert.ok(ctx.orders.some(row => row.id === 'held'))
  assert.equal(ctx.nextOrder.id, 'old-delivering')
  assert.equal(ctx.screen, 'workbench', '首次同步不能弹新单提醒')
  ctx.orderTab = '已完成'
  await ctx.resetOrderPages()
  while (ctx.historyHasMore) await ctx.loadMoreOrders()
  assert.equal(ctx.filteredOrders.length, 320)
  assert.equal(new Set(ctx.orders.map(row => row.id)).size, ctx.orders.length)
})

test('F07：空闲首单、清空后下一单提醒；首次进入与暂停不误提醒', async () => {
  let rows = []
  const { api } = serviceContext(call => pagedFixture(rows, call)), { ctx } = pageContext('delivery', api)
  ctx.screen = 'workbench'; ctx.online = true
  await ctx.loadOrders(); assert.equal(ctx.screen, 'workbench')
  rows = [order('first', '待配送')]
  await ctx.loadOrders(); assert.equal(ctx.screen, 'alert')
  ctx.screen = 'workbench'; rows = []
  await ctx.loadOrders()
  rows = [order('second', '待配送')]
  await ctx.loadOrders(); assert.equal(ctx.screen, 'alert')
  ctx.screen = 'workbench'; ctx.online = false; rows.push(order('paused', '待配送'))
  await ctx.loadOrders(); assert.equal(ctx.screen, 'workbench')
  ctx.online = true; await ctx.loadOrders(); assert.equal(ctx.screen, 'workbench', '暂停期间同步过的旧任务不误报新单')
  rows.push(order('third', '待配送'))
  await ctx.loadOrders(); assert.equal(ctx.screen, 'alert')
  const initial = pageContext('delivery', api).ctx
  initial.online = true; initial.screen = 'workbench'
  await initial.loadOrders(); assert.equal(initial.screen, 'workbench')
})

test('客户状态筛选、历史加载更多和全历史搜索能到达第300单之后', async () => {
  const rows = [...Array.from({ length: 325 }, (_, i) => order(`history-${i}`)), order('old-pending', '待配送')]
  const { api } = serviceContext(call => pagedFixture(rows, call)), { ctx } = pageContext('order', api)
  ctx.screen = 'orders'; await ctx.loadOrders()
  assert.ok(ctx.orders.length < rows.length)
  while (ctx.ordersHasMore) await ctx.loadMoreOrders()
  assert.equal(ctx.orders.length, 326)
  ctx.activeTab = '待配送'; await ctx.resetOrderPages()
  assert.deepEqual(ctx.visibleOrders.map(row => row.id), ['old-pending'])
  ctx.activeTab = '全部'; ctx.orderKeyword = 'history-324'; await ctx.resetOrderPages()
  assert.deepEqual(ctx.visibleOrders.map(row => row.id), ['history-324'])
})

test('分页异常或中途失败不得返回截断数组，避免首页数量显示为全部', async () => {
  const rows = Array.from({ length: 220 }, (_, i) => order(`row-${i}`))
  for (const kind of ['network', 'duplicate', 'empty', 'legacy', 'changed-total']) {
    const { api } = serviceContext(call => {
      const result = pagedFixture(rows, call)
      if (Number(call.params.page) > 1) {
        if (kind === 'network') throw new Error('隔离网络故障')
        if (kind === 'duplicate') result.items = rows.slice(0, 100)
        if (kind === 'empty') result.items = []
        if (kind === 'legacy') return rows.slice(0, 100)
        if (kind === 'changed-total') result.total += 1
      }
      return result
    })
    await assert.rejects(api.listOrders(), /故障|分页|列表发生变化/, kind)
  }
})

for (const name of ['order', 'delivery']) {
  test(`${name}：加载更多重复点击仅执行一次，中途失败保留原页并可重试`, async () => {
    const rows = Array.from({ length: 45 }, (_, i) => order(`row-${i}`))
    let failPage2 = false, release
    const { api, calls } = serviceContext(async call => {
      if (call.params.page === '2' && failPage2) {
        await new Promise(resolve => { release = resolve })
        throw new Error('隔离第二页失败')
      }
      return pagedFixture(rows, call)
    })
    const { ctx } = pageContext(name, api)
    ctx.screen = 'orders'; await ctx.loadOrders()
    const initial = ctx.orders.map(row => row.id)
    failPage2 = true
    const first = ctx.loadMoreOrders()
    await ctx.loadMoreOrders()
    while (!release) await new Promise(resolve => setImmediate(resolve))
    release(); await first
    assert.deepEqual(ctx.orders.map(row => row.id), initial)
    assert.match(ctx.ordersError, /第二页失败/)
    assert.equal(calls.filter(call => call.params.page === '2').length, 1)
    failPage2 = false; await ctx.loadMoreOrders()
    assert.equal(ctx.orders.length, 40)
    rows.unshift(order('inserted'))
    await ctx.loadMoreOrders()
    assert.equal(ctx.orders.length, 46)
    assert.equal(new Set(ctx.orders.map(row => row.id)).size, 46)
    await ctx.loadOrders()
    assert.equal(ctx.orders.length, 46, '轮询不重置已加载历史')
  })

  test(`${name}：切换筛选后的迟到响应不能覆盖新筛选，重新进入能继续查旧单`, async () => {
    const rows = [order('complete'), order('pending', '待配送')]
    let release, delay = true
    const { api } = serviceContext(async call => {
      if (delay && !call.params.status) { delay = false; await new Promise(resolve => { release = resolve }) }
      return pagedFixture(rows, call)
    })
    const { ctx } = pageContext(name, api)
    ctx.screen = 'orders'
    const first = ctx.loadOrders()
    while (!release) await new Promise(resolve => setImmediate(resolve))
    if (name === 'order') ctx.activeTab = '待配送'; else ctx.orderTab = '已完成'
    await ctx.resetOrderPages(); release(); await first
    assert.deepEqual((name === 'order' ? ctx.visibleOrders : ctx.filteredOrders).map(row => row.id), [name === 'order' ? 'pending' : 'complete'])
    const again = pageContext(name, api).ctx
    again.screen = 'orders'; await again.loadOrders()
    assert.equal(again.orders.length, 2)
    assert.equal(again.screen, 'orders')
  })
}

test('F07：首次密码登录有存量任务不提醒；中途失败不吞掉下一单提醒', async () => {
  let rows = [order('existing', '待配送')], fail = false
  const { api } = serviceContext(call => { if (fail) throw new Error('隔离同步失败'); return pagedFixture(rows, call) })
  const { ctx } = pageContext('delivery', { ...api, getConfig: async () => ({ demoAuth: false }), loginWithPassword: async () => ({ profile: {} }), getCourierProfile: async () => ({ online: true }) }, { setStorageSync() {} })
  ctx.authConsent = true; ctx.phone = '13812345678'; ctx.password = 'LocalFixture!'; ctx.startSync = () => {}
  await ctx.login()
  assert.equal(ctx.screen, 'workbench')
  rows.push(order('new', '待配送')); fail = true; await ctx.loadOrders()
  assert.equal(ctx.screen, 'workbench'); assert.deepEqual(ctx.knownPendingIds, ['existing'])
  fail = false; await ctx.loadOrders(); assert.equal(ctx.screen, 'alert')
  const onlyHistory = pageContext('delivery', serviceContext(call => pagedFixture([order('done')], call)).api).ctx
  await onlyHistory.loadOrders()
  assert.equal(onlyHistory.nextOrder, undefined, '已完成历史不能成为下一单')
})
