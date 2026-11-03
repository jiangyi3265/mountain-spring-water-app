import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile } from 'node:fs/promises'
import { createFixture, evidence } from './order-pagination-fixture.mjs'
import { pageContext, serviceContext } from './order-pagination-harness.mjs'

test('真实隔离API：角色归属＋状态分页＋页面方法查旧任务/历史＋跨端接单状态', async t => {
  const f = await createFixture('api')
  t.after(f.close)
  const { api, calls } = serviceContext(async ({ path, params, token }) => {
    const response = await fetch(`${f.base}${path.slice(4)}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } })
    const payload = await response.json()
    if (response.status >= 400) throw Object.assign(new Error(payload.message), { status: response.status })
    return payload.data
  }, Object.fromEntries(['courier', 'customer'].map(role => [role, f.sessions[role].token])))
  const courier = pageContext('delivery', api).ctx, customer = pageContext('order', api).ctx
  courier.screen = 'workbench'; courier.online = true; customer.screen = 'orders'
  await courier.loadOrders()
  assert.equal(courier.ordersError, '')
  assert.equal(courier.activeOrderCount, 208)
  assert.ok(courier.orders.find(o => o.id === f.pendingId))
  assert.ok(courier.orders.find(o => o.id === f.heldId).fulfillmentHoldReason)
  assert.equal(courier.nextOrder.id, f.deliveringId)
  assert.equal(courier.screen, 'workbench')
  courier.orderTab = '已完成'; await courier.resetOrderPages()
  while (courier.historyHasMore) await courier.loadMoreOrders()
  assert.equal(courier.filteredOrders.length, 325)
  await customer.loadOrders()
  while (customer.ordersHasMore) await customer.loadMoreOrders()
  const actualCount = f.db.prepare('SELECT count(*) count FROM orders WHERE customer_id=?').get(f.customerId).count
  assert.equal(customer.orders.length, actualCount)
  assert.ok(!customer.orders.some(o => o.id.startsWith('OTHER-OWNER')))
  assert.ok(!courier.orders.some(o => o.id.startsWith('OTHER-OWNER')))
  customer.activeTab = '待配送'; await customer.resetOrderPages()
  while (customer.ordersHasMore) await customer.loadMoreOrders()
  assert.equal(customer.orders.filter(o => o.id === f.pendingId).length, 1)
  assert.ok(customer.orders.every(o => o.status === '待配送'))
  await f.ok(`/orders/${f.pendingId}/accept`, 'POST', {}, 'courier')
  await courier.loadOrders(); await customer.loadOrders()
  assert.equal(courier.orders.find(o => o.id === f.pendingId).status, '配送中')
  assert.ok(!customer.visibleOrders.some(o => o.id === f.pendingId))
  customer.activeTab = '配送中'; await customer.resetOrderPages()
  assert.ok(customer.visibleOrders.some(o => o.id === f.pendingId))
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(f.pendingId).status, '配送中')
  for (const role of ['customer', 'courier']) {
    const result = await f.ok('/orders?status=待配送&page=1&pageSize=200&customerId=seed-customer-2&courierId=courier-002', 'GET', undefined, role)
    assert.ok(result.items.every(o => o.status === '待配送' && !o.id.startsWith('OTHER-OWNER')))
    assert.equal((await f.request('/orders/OTHER-OWNER-0000', 'GET', undefined, role)).status, 403)
  }
  assert.equal((await f.request('/orders?page=1&status=待配送', 'GET', undefined, 'anonymous')).status, 401)
  assert.ok(calls.filter(c => c.path === '/api/orders').every(c => Number(c.params.page) >= 1))
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})

test('IR-M01/M02真实HTTP：迟到详情/取消/支付/收货不串单，新提醒接单及撤单改派核验',async()=>{
  const f=await createFixture('selection-edges-R2'),report={startedAt:new Date().toISOString(),environment:'actual page methods + real loopback HTTP/SQLite; controlled response timing; no browser/device/production payment',cases:[]}
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
  const makeApi=()=>serviceContext(async ({path,params,token})=>{
    const response=await fetch(`${f.base}${path.slice(4)}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${token}`}}),payload=await response.json()
    if(response.status>=400)throw Object.assign(new Error(payload.message),{status:response.status})
    return payload.data
  },Object.fromEntries(['courier','customer'].map(role=>[role,f.sessions[role].token]))).api
  const create=key=>f.ok('/orders','POST',{sku:'water-18_9l',quantity:1,payment:'货到付款',idempotencyKey:key},'customer')
  const snapshot=(a,b)=>f.db.prepare('SELECT id,status,courier_id,receipt_confirmed_at FROM orders WHERE id IN (?,?) ORDER BY id').all(a,b)
  const run=async(id,fn)=>{const observations={};try{await fn(observations);report.cases.push({id,status:'PASS',observations})}catch(error){report.cases.push({id,status:'FAIL',observations,error:error.stack});throw error}}
  try{
    for(const clicked of ['cancel','pay'])await run(`IR-M01-late-A-GET-${clicked}-exact-B`,async o=>{
      const a=await create(`edge-late-${clicked}-A`),b=await create(`edge-late-${clicked}-B`),api=makeApi(),entered=deferred(),release=deferred(),cancelled=[]
      api.getOrder=async id=>{const data=await f.ok(`/orders/${id}`,'GET',undefined,'customer');if(id===a.id){entered.resolve();await release.promise}return data}
      api.cancelOrder=api.payOrder=async id=>{cancelled.push(id);return f.ok(`/orders/${id}/${clicked}`,'POST',{},'customer')}
      const {ctx}=pageContext('order',api);ctx.startSync=()=>{};ctx.selectOrder(a)
      const loading=ctx.loadOrders();await entered.promise;ctx.selectOrder(b);release.resolve();await loading
      assert.equal(ctx.selectedOrder.id,b.id);await ctx[clicked==='cancel'?'cancelSelectedOrder':'paySelectedOrder']()
      o.cancelRequests=cancelled;o.selected=ctx.selectedOrder.id;o.persisted=snapshot(a.id,b.id)
      assert.deepEqual(cancelled,[b.id]);assert.equal(f.app.store.get(a.id).status,'待付款');assert.equal(f.app.store.get(b.id).status,clicked==='cancel'?'已取消':'待配送')
    })
    for(const kind of ['cancel','pay','confirm'])await run(`IR-M01-${kind}-A-response-after-select-B`,async o=>{
      let a=await create(`edge-${kind}-A`);const b=await create(`edge-${kind}-B`)
      if(kind==='confirm'){
        await f.ok(`/orders/${a.id}/pay`,'POST',{},'customer');await f.ok(`/orders/${a.id}/assign`,'POST',{courierId:f.courierId});await f.ok(`/orders/${a.id}/accept`,'POST',{},'courier');await f.ok(`/orders/${a.id}/complete`,'POST',{signMethod:'manual'},'courier');a=await f.ok(`/orders/${a.id}`,'GET',undefined,'customer')
      }
      const api=makeApi(),entered=deferred(),release=deferred(),writes=[]
      const operation=async id=>{writes.push(id);const result=await f.ok(`/orders/${id}/${kind==='confirm'?'confirm-receipt':kind}`,'POST',{},'customer');entered.resolve();await release.promise;return result}
      api.getOrder=id=>f.ok(`/orders/${id}`,'GET',undefined,'customer');api.cancelOrder=operation;api.payOrder=operation;api.confirmReceipt=operation
      const {ctx}=pageContext('order',api);ctx.startSync=()=>{};ctx.selectOrder(a)
      const pending=ctx[{cancel:'cancelSelectedOrder',pay:'paySelectedOrder',confirm:'confirmSelectedReceipt'}[kind]]()
      await entered.promise;ctx.selectOrder(b);release.resolve();await pending
      o.requests=writes;o.selected=ctx.selectedOrder.id;o.screen=ctx.screen;o.persisted=snapshot(a.id,b.id)
      assert.deepEqual(writes,[a.id]);assert.equal(ctx.selectedOrder.id,b.id);assert.equal(ctx.screen,'detail');assert.equal(f.app.store.get(b.id).status,'待付款')
      if(kind==='cancel')assert.equal(f.app.store.get(a.id).status,'已取消')
      if(kind==='pay')assert.equal(f.app.store.get(a.id).status,'待配送')
      if(kind==='confirm')assert.ok(f.app.store.get(a.id).receiptConfirmedAt)
    })
    await run('IR-M02-older-new-assignment-exact-accept',async o=>{
      f.db.prepare('UPDATE orders SET courier_id=NULL,courier_name=NULL WHERE courier_id=?').run(f.courierId)
      const a=await create('edge-alert-old-A'),b=await create('edge-alert-existing-B')
      for(const row of [a,b])await f.ok(`/orders/${row.id}/pay`,'POST',{},'customer')
      f.db.prepare("UPDATE orders SET created_at='2026-09-01T00:00:00Z' WHERE id=?").run(a.id)
      await f.ok(`/orders/${b.id}/assign`,'POST',{courierId:f.courierId})
      const api=makeApi(),accepted=[];api.acceptOrder=async id=>{accepted.push(id);return f.ok(`/orders/${id}/accept`,'POST',{},'courier')}
      const {ctx}=pageContext('delivery',api);ctx.startSync=()=>{};ctx.screen='workbench';ctx.online=true
      await ctx.loadOrders();await f.ok(`/orders/${a.id}/assign`,'POST',{courierId:f.courierId});await ctx.loadOrders()
      o.shown=ctx.pendingOrder?.id;assert.equal(o.shown,a.id);await ctx.acceptOrder()
      o.acceptRequests=accepted;o.persisted=snapshot(a.id,b.id);assert.deepEqual(accepted,[a.id]);assert.equal(f.app.store.get(b.id).status,'待配送');assert.equal(f.app.store.get(a.id).status,'配送中')
    })
    const replacementCourier=await f.ok('/admin/couriers','POST',{name:'同站改派验收员',phone:'19900006666',stationId:'station-001',password:'IsolatedOnly!2026'})
    for(const change of ['cancel','reassign','reassign-after-check'])await run(`IR-M02-${change}-does-not-accept-other-order`,async o=>{
      const a=await create(`edge-${change}-target`);await f.ok(`/orders/${a.id}/pay`,'POST',{},'customer')
      const api=makeApi(),accepted=[];let race=false
      // Existing API forbids reassigning an assigned order. Model ownership revocation in isolated SQL, then exercise real HTTP authorization.
      const reassign=async()=>{f.db.prepare('UPDATE orders SET courier_id=?,courier_name=? WHERE id=?').run(replacementCourier.id,replacementCourier.name,a.id);o.reassignmentFixture='isolated SQL owner change; not a successful admin reassign API'}
      api.acceptOrder=async id=>{accepted.push(id);if(race)await reassign();return f.ok(`/orders/${id}/accept`,'POST',{},'courier')}
      const {ctx}=pageContext('delivery',api);ctx.startSync=()=>{};ctx.screen='workbench';ctx.online=true
      try{
        await ctx.loadOrders();await f.ok(`/orders/${a.id}/assign`,'POST',{courierId:f.courierId});await ctx.loadOrders();assert.equal(ctx.pendingOrder.id,a.id)
        if(change==='cancel')await f.ok(`/orders/${a.id}/cancel`,'POST',{},'customer')
        else if(change==='reassign')await reassign();else race=true
        await ctx.acceptOrder();o.acceptRequests=accepted;o.target=f.app.store.get(a.id);o.remainingAlert=ctx.pendingOrder?.id||null
        assert.deepEqual(accepted,change==='reassign-after-check'?[a.id]:[]);assert.notEqual(f.app.store.get(a.id).status,'配送中');assert.notEqual(ctx.pendingOrder?.id,a.id)
      }finally{ctx.stopCountdown()}
    })
  }finally{
    report.finishedAt=new Date().toISOString();await writeFile(`${evidence}/selection-edge-api-${Date.now()}.json`,JSON.stringify(report,null,2));await f.close()
  }
})
