import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

assert.equal(process.version, 'v24.16.0')
const root = fileURLToPath(new URL(existsSync(new URL('../../water-api/server.mjs', import.meta.url)) ? '../../' : '../../../', import.meta.url))
const sourceRoot = resolve(process.env.UI_MOBILE_SOURCE_ROOT || join(root, '桶装水'))
const evidenceRoot = resolve(process.env.QA_EVIDENCE_DIR || join(root, '.qa-runtime/audit-20260929/ui-review'), `mobile-async-tests/${Date.now()}-${process.pid}`)
mkdirSync(evidenceRoot, { recursive: true })
const read = path => readFileSync(join(sourceRoot, path), 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b }); return { promise,resolve,reject } }
function page(name, api, uni = {}) {
  const body=read(`pages/${name}/index.vue`).split('<script>')[1].split('</script>')[0]
  const imports=[...body.matchAll(/^import (\w+) from /gm)].map(match=>match[1])
  const component=new Function('uni','waterApi',...imports,body.replace(/^import .*$/gm,'').replace('export default','return'))({showToast(){},pageScrollTo(){},getStorageSync(){},setStorageSync(){},removeStorageSync(){},...uni},api)
  const ctx={...component.data()}
  for(const [key,method] of Object.entries(component.methods))ctx[key]=method.bind(ctx)
  for(const [key,getter] of Object.entries(component.computed))Object.defineProperty(ctx,key,{get:()=>getter.call(ctx)})
  return {ctx,component}
}
function service(handler, storage = new Map()) {
  const calls=[],toasts=[],navigation=[]
  const uni={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,copy(value)),removeStorageSync:key=>storage.delete(key),showToast:({title})=>toasts.push(title),reLaunch:options=>{navigation.push(options.url);options.complete?.()},pageScrollTo(){},request:options=>{
    const url=new URL(options.url),call={path:url.pathname.slice(4),params:Object.fromEntries(url.searchParams),method:options.method,data:options.data,token:options.header.Authorization?.replace('Bearer ','')};calls.push(call)
    Promise.resolve().then(()=>handler(call)).then(r=>options.success({statusCode:r.status??200,data:r.body??{code:0,data:r.data??r}}),error=>options.fail({errMsg:error.message}))
  }}
  const context=vm.createContext({console,uni,testEnv:{VITE_WATER_API_URL:'http://127.0.0.1/api'}})
  vm.runInContext(read('services/waterApi.js').replaceAll('import.meta.env','testEnv').replace('export const waterApi =','globalThis.waterApi =').replace('export { API_BASE_URL }',''),context)
  return {api:context.waterApi,storage,calls,toasts,uni,navigation}
}
const session=(token,id=token)=>({token,expiresAt:new Date(Date.now()+3600000).toISOString(),profile:{id}})
let fixtureNo=0
async function fixture(t) {
  for(const key of Object.keys(process.env))if(/^(WATER_API_|WECHAT_|OSS_|AMAP_|TENCENT_)/.test(key))delete process.env[key]
  process.env.NODE_ENV='test'
  const {createWaterApi}=await import(pathToFileURL(join(root,'water-api/server.mjs')))
  const {createWechatClient,createGeocoder,createOssClient}=await import(pathToFileURL(join(root,'water-api/lib/integrations.mjs')))
  const app=await createWaterApi({dataFile:join(evidenceRoot,`${++fixtureNo}.sqlite`),tokenSecret:'candidate-mobile-disposable-test-secret-20260929',defaultPassword:'CandidateOnly!2026',seedDemoData:true,demoAuthEnabled:true,simulatedPaymentsEnabled:false,ruoyiVerifyUrl:'',integrations:{wechat:createWechatClient({}),oss:createOssClient({}),geocoder:createGeocoder({})}})
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done))
  t.after(()=>new Promise(done=>app.server.close(done)))
  const base=`http://127.0.0.1:${app.server.address().port}/api`,sessions={}
  async function http(path,method='GET',body,role='customer'){
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(sessions[role]?{Authorization:`Bearer ${sessions[role].token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}
  }
  async function ok(...args){const r=await http(...args);assert.ok(r.status<300,`${args[0]} ${r.status} ${r.body.message}`);return r.body.data}
  for(const role of ['customer','admin','courier'])sessions[role]=await ok('/auth/demo-login','POST',{role,...(role==='courier'?{phone:'13812345678'}:{})},'')
  const account=await ok('/account')
  const storage=new Map(Object.entries(sessions).map(([role,s])=>[`water_session_${role}`,s]))
  const forward=async call=>{
    const r=await fetch(base+call.path+'?'+new URLSearchParams(call.params),{method:call.method,headers:{'Content-Type':'application/json',...(call.token?{Authorization:`Bearer ${call.token}`}:{})},body:call.data===undefined?undefined:JSON.stringify(call.data)});return {status:r.status,body:await r.json()}
  }
  return {app,http,ok,account,sessions,storage,forward,db:app.store.db}
}
async function checkout(f, client) {
  const {ctx}=page('order',client.api,client.uni)
  ctx.screen='checkout';ctx.account=f.account;ctx.payMethod='balance';ctx.deliveryWindow=''
  ctx.checkout={station:f.account.stationName,fromCart:false,items:[{sku:'water-18_9l',name:'测试水',qty:1,price:29.95,spec:'18.9L'}]}
  ctx.quote=await client.api.previewOrder({items:[{sku:'water-18_9l',quantity:1}],tickets:[]})
  ctx.startSync=()=>{};ctx.stopSync=()=>{}
  return ctx
}
const injected=message=>({status:503,body:{code:503,message}})
const rowsForKeys=(f,keys)=>keys.map(key=>f.db.prepare('SELECT id,status,pay_status FROM orders WHERE idempotency_key=?').get(key)).filter(Boolean)

test('M01: changing payment requires confirmed cancellation; one replacement order, only one live allocation',async t=>{
  const f=await fixture(t);let fail=true
  const c=service(call=>{if(fail&&/\/pay$/.test(call.path)){fail=false;return injected('payment unavailable')}return f.forward(call)},f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment()
  const first=c.calls.find(c=>c.path==='/orders'&&c.method==='POST').data
  assert.equal(rowsForKeys(f,[first.idempotencyKey])[0].status,'待付款')
  if(ctx.cancelPendingCheckout)await ctx.cancelPendingCheckout()
  ctx.payMethod='cod';ctx.screen='checkout';await ctx.submitPayment()
  assert.equal(ctx.currentOrder?.payment,'货到付款','after the explicit cancel-and-change path, COD must be usable')
  const keys=[...new Set(c.calls.filter(c=>c.path==='/orders'&&c.method==='POST').map(c=>c.data.idempotencyKey))]
  assert.equal(keys.length,2)
  const orders=rowsForKeys(f,keys);assert.equal(orders[0].status,'已取消');assert.equal(orders[1].status,'待配送')
  const live=orders.reduce((sum,row)=>sum+f.db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM order_inventory_allocations WHERE order_id=? AND status IN ('预占','已扣减')").get(row.id).n,0)
  assert.equal(live,1,'canceled intent must release stock before another one is created')
})

test('M01: lost create response + SKU delisting recovers the committed order without POST replay',async t=>{
  const f=await fixture(t);let drop=true
  const c=service(async call=>{const r=await f.forward(call);if(drop&&call.path==='/orders'&&call.method==='POST'){drop=false;throw new Error('create response lost after commit')}return r},f.storage)
  const a=await checkout(f,c);await a.submitPayment()
  const b=await checkout(f,c);b.remark='edited while result was unknown'
  f.db.prepare("UPDATE product_skus SET status='下架' WHERE code='water-18_9l'").run()
  const original=c.calls.find(c=>c.path==='/orders'&&c.method==='POST').data
  assert.equal((await f.http('/orders','POST',original)).status,400,'POST recovery cannot bypass current catalog validation')
  await b.submitPayment()
  const calls=c.calls.filter(c=>c.path==='/orders'&&c.method==='POST')
  assert.equal(calls.length,1,'read-only recovery must avoid replaying a committed create')
  assert.ok(c.calls.some(c=>c.path==='/orders/recovery'&&c.params.idempotencyKey===original.idempotencyKey))
  assert.equal(b.currentOrder?.payStatus,'已支付')
  assert.equal(rowsForKeys(f,[calls[0].data.idempotencyKey]).length,1)
})

test('M01: recovery reports no order after pre-commit transport loss; retry keeps the exact original key and snapshot',async t=>{
  const f=await fixture(t);let drop=true
  const c=service(call=>{if(drop&&call.path==='/orders'&&call.method==='POST'){drop=false;throw new Error('request lost before commit')}return f.forward(call)},f.storage)
  const a=await checkout(f,c);await a.submitPayment()
  const b=await checkout(f,c);b.remark='edited';await b.submitPayment()
  const calls=c.calls.filter(c=>c.path==='/orders'&&c.method==='POST')
  assert.equal(calls.length,2);assert.deepEqual(copy(calls[0].data),copy(calls[1].data))
  assert.equal(b.currentOrder?.payStatus,'已支付');assert.equal(rowsForKeys(f,[calls[0].data.idempotencyKey]).length,1)
})

test('M01: failed recovery or rejected retry cannot release an uncertain earlier key',async t=>{
  const f=await fixture(t);let attempt=0,failRecovery=false
  const c=service(call=>{
    if(failRecovery&&call.path==='/orders/recovery')return injected('recovery unavailable')
    if(call.path==='/orders'&&call.method==='POST'){attempt++;if(attempt===1)throw new Error('unknown transport outcome');return {status:400,body:{code:400,message:'stock changed'}}}
    return f.forward(call)
  },f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment();const key=ctx.pendingCheckout?.payload.idempotencyKey
  assert.ok(key);failRecovery=true;await ctx.submitPayment();assert.equal(attempt,1,'failed read must not fall back to a write')
  assert.equal(ctx.pendingCheckout.payload.idempotencyKey,key)
  failRecovery=false;await ctx.submitPayment();assert.equal(attempt,2)
  assert.equal(ctx.pendingCheckout.payload.idempotencyKey,key,'400 on retry cannot rule out a late original commit')
})

test('M01: real zero-stock 409 can return to editable checkout without POST, retaining the key across reload and correction',async t=>{
  const f=await fixture(t),c=service(f.forward,f.storage),ctx=await checkout(f,c)
  f.db.prepare("UPDATE warehouse_stock SET quantity=0 WHERE sku_id IN (SELECT id FROM product_skus WHERE code='water-18_9l')").run()
  await ctx.submitPayment()
  const first=c.calls.find(c=>c.path==='/orders'&&c.method==='POST').data
  assert.equal(rowsForKeys(f,[first.idempotencyKey]).length,0)
  assert.ok(ctx.pendingCheckout,'409 retains the unknown intent')
  await ctx.cancelPendingCheckout()
  assert.equal(c.calls.filter(c=>c.path==='/orders'&&c.method==='POST').length,1,'cancel/no-order lookup must not create an order')
  assert.equal(ctx.pendingCheckout?.editable,true);assert.equal(ctx.screen,'confirm')
  assert.equal(f.storage.get('water_pending_checkout_'+f.account.id)?.payload.idempotencyKey,first.idempotencyKey)
  const alternative=f.db.prepare("SELECT code,spec FROM product_skus WHERE status='上架' AND code!='water-18_9l' ORDER BY code LIMIT 1").get()
  const {ctx:b}=page('order',c.api,c.uni);b.account=f.account;b.screen='confirm';b.startSync=()=>{};b.stopSync=()=>{};b.restorePendingCheckout()
  b.checkout.items=[{sku:alternative.code,spec:alternative.spec,name:'有库存的替代商品',qty:1,price:0}];b.payMethod='cod';b.remark='corrected product and payment while original stock stays zero';await b.refreshQuote();await b.submitPayment()
  const calls=c.calls.filter(c=>c.path==='/orders'&&c.method==='POST')
  assert.equal(calls.length,2);assert.equal(calls[1].data.idempotencyKey,first.idempotencyKey)
  assert.equal(calls[1].data.payment,'货到付款');assert.equal(calls[1].data.items[0].sku,alternative.code);assert.equal(calls[1].data.remark,'corrected product and payment while original stock stays zero')
  assert.equal(b.currentOrder?.status,'待配送');assert.equal(rowsForKeys(f,[first.idempotencyKey]).length,1)
  assert.equal(f.db.prepare("SELECT SUM(quantity) n FROM order_inventory_allocations WHERE order_id=? AND status IN ('预占','已扣减')").get(b.currentOrder.id).n,1)
})

test('M01: a late original commit after no-order correction is recovered for explicit review, never charged using the edited method',async t=>{
  const f=await fixture(t);let drop=true
  const c=service(call=>{if(drop&&call.path==='/orders'&&call.method==='POST'){drop=false;throw new Error('original request still in transit')}return f.forward(call)},f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment()
  const first=c.calls.find(c=>c.path==='/orders'&&c.method==='POST').data
  await ctx.cancelPendingCheckout();assert.equal(ctx.pendingCheckout?.editable,true)
  const late=await f.ok('/orders','POST',first)
  ctx.payMethod='cod';ctx.remark='different correction';await ctx.submitPayment()
  assert.equal(ctx.pendingCheckout?.orderId,late.id);assert.equal(ctx.pendingCheckout?.payload.payment,'余额支付')
  assert.equal(c.calls.filter(c=>c.path==='/orders'&&c.method==='POST').length,1)
  assert.equal(c.calls.filter(c=>/\/pay$/.test(c.path)).length,0,'recovered old terms need explicit confirmation')
  await ctx.submitPayment();assert.equal(ctx.currentOrder?.id,late.id);assert.equal(ctx.currentOrder?.payStatus,'已支付')
  assert.equal(rowsForKeys(f,[first.idempotencyKey]).length,1)
})

test('M01: original commits between an empty recovery read and corrected POST; the reused key rejects a duplicate and recovers original terms',async t=>{
  const f=await fixture(t);let drop=true,commitAfterRead=false,first,late
  const c=service(async call=>{
    if(drop&&call.path==='/orders'&&call.method==='POST'){drop=false;first=copy(call.data);throw new Error('original still in transit')}
    const response=await f.forward(call)
    if(commitAfterRead&&call.path==='/orders/recovery'){commitAfterRead=false;assert.equal(response.body.data.order,null);late=await f.ok('/orders','POST',first)}
    return response
  },f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment();await ctx.cancelPendingCheckout()
  assert.equal(ctx.pendingCheckout?.editable,true);ctx.payMethod='cod';commitAfterRead=true;await ctx.submitPayment()
  assert.equal(ctx.currentOrder,null);assert.equal(ctx.pendingCheckout.payload.idempotencyKey,first.idempotencyKey)
  assert.equal(rowsForKeys(f,[first.idempotencyKey]).length,1)
  const attempts=c.calls.filter(c=>c.path==='/orders'&&c.method==='POST');assert.equal(attempts.length,2);assert.equal(attempts[1].data.idempotencyKey,first.idempotencyKey)
  await ctx.submitPayment();assert.equal(ctx.pendingCheckout.orderId,late.id);assert.equal(ctx.pendingCheckout.payload.payment,'余额支付')
  assert.equal(c.calls.some(c=>/\/pay$/.test(c.path)),false)
  await ctx.submitPayment();assert.equal(ctx.currentOrder.id,late.id)
  assert.equal(f.db.prepare("SELECT SUM(quantity) n FROM order_inventory_allocations WHERE order_id=? AND status IN ('预占','已扣减')").get(late.id).n,1)
})

test('M01: lost cancellation response is recovered; never create another order until readback says canceled',async t=>{
  const f=await fixture(t);let failPay=true,dropCancel=true
  const c=service(async call=>{if(failPay&&/\/pay$/.test(call.path)){failPay=false;return injected('pay failed')}const r=await f.forward(call);if(dropCancel&&/\/cancel$/.test(call.path)){dropCancel=false;throw new Error('cancel response lost after commit')}return r},f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment()
  assert.equal(typeof ctx.cancelPendingCheckout,'function')
  await ctx.cancelPendingCheckout();assert.ok(ctx.pendingCheckout,'uncertain cancel must retain recovery state')
  assert.equal(c.calls.filter(c=>c.path==='/orders'&&c.method==='POST').length,1)
  await ctx.cancelPendingCheckout();assert.equal(ctx.pendingCheckout,null)
  assert.equal(c.calls.filter(c=>c.path==='/orders'&&c.method==='POST').length,1)
  assert.equal(c.calls.filter(c=>/\/cancel$/.test(c.path)).length,1,'already canceled readback needs no second cancel')
})

test('M01: late confirmed payment blocks cancel/change, continuing original performs no second charge',async t=>{
  const f=await fixture(t);let fail=true
  const c=service(call=>{if(fail&&/\/pay$/.test(call.path)){fail=false;return injected('pay failed')}return f.forward(call)},f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment()
  const key=c.calls.find(c=>c.path==='/orders'&&c.method==='POST').data.idempotencyKey,id=rowsForKeys(f,[key])[0].id
  await f.ok(`/orders/${id}/pay`,'POST',{payment:'余额支付'})
  assert.equal(typeof ctx.cancelPendingCheckout,'function')
  await ctx.cancelPendingCheckout();assert.ok(ctx.pendingCheckout)
  assert.equal(c.calls.some(c=>/\/cancel$/.test(c.path)),false)
  await ctx.submitPayment();assert.equal(ctx.currentOrder.id,id);assert.equal(ctx.currentOrder.payStatus,'已支付')
  assert.equal(c.calls.filter(c=>/\/pay$/.test(c.path)).length,1,'the original injected failure is the only UI pay attempt')
  assert.equal(c.calls.filter(c=>c.path==='/orders'&&c.method==='POST').length,1)
})

test('M01: isolated storage keeps another account pending intent; finishing one never deletes the other',async t=>{
  const f=await fixture(t);let fail=true
  const c=service(call=>{if(fail&&/\/pay$/.test(call.path)){fail=false;return injected('pay failed')}return f.forward(call)},f.storage)
  const ctx=await checkout(f,c);await ctx.submitPayment()
  const otherKey='water_pending_checkout_another-customer',other={payload:{idempotencyKey:'another-key'}};f.storage.set(otherKey,other)
  assert.ok(f.storage.has('water_pending_checkout_'+f.account.id),'pending intent must survive page destruction')
  await ctx.submitPayment();assert.equal(ctx.screen,'success')
  assert.deepEqual(f.storage.get(otherKey),other);assert.equal(f.storage.has('water_pending_checkout_'+f.account.id),false)
})

test('M01 control: successful retry of identical intent remains same order; changed-key content protection stays 409',async t=>{
  const f=await fixture(t);const payload={idempotencyKey:'same-key-control',items:[{sku:'water-18_9l',quantity:1}],payment:'货到付款',address:f.account.address}
  const first=await f.ok('/orders','POST',payload),second=await f.ok('/orders','POST',payload)
  assert.equal(second.id,first.id)
  const rejected=await f.http('/orders','POST',{...payload,payment:'余额支付'});assert.equal(rejected.status,409)
})

// Parameterized late-data tests assert actual business fields and error state, not implementation text.
const readCases=[
  {name:'首页账户/票数/订单数/券数/推荐',page:'index',method:'loadProfile',endpoints:['getAccount','listTickets','listOrders','listAftersales','listCoupons','getReferral'],values:n=>[{id:n,name:n,balance:n==='A'?100:200,stationName:''},[{status:'可用'}],[{status:'待付款'}],[],[{customerCouponId:n,customerStatus:'未使用'}],{referralCode:n}],field:ctx=>[ctx.account.id,ctx.referral.referralCode,ctx.profileError]},
  {name:'会员账户/流水/优惠券',page:'member',method:'loadAssets',endpoints:['getAccount','listAccountTransactions','listCoupons'],values:n=>[{id:n,name:n},[{id:n,accountType:'余额',changeAmount:100,balanceAfter:100}], [{couponId:n}]],field:ctx=>[ctx.account.id,ctx.balanceRecords[0]?.id,ctx.coupons[0]?.couponId,ctx.assetError]},
  {name:'会员水票',page:'member',method:'loadTickets',endpoints:['listTickets'],values:n=>[[{code:n,ticketType:'电子票',status:'可用'}]],field:ctx=>[ctx.tickets[0]?.code,ctx.ticketError]},
  {name:'充值套餐和记录',page:'member',method:'loadRecharge',endpoints:['listRechargePackages','listRecharges'],values:n=>[[{id:n}],[{id:n}]],field:ctx=>[ctx.rechargePackages[0]?.id,ctx.recharges[0]?.id]},
  {name:'结算账户/地址',page:'order',method:'loadAccount',endpoints:['getAccount'],values:n=>[{id:n,name:n,address:n+' address'}],field:ctx=>[ctx.account.id,ctx.account.address,ctx.accountError]},
  {name:'结算可用水票',page:'order',method:'loadTickets',endpoints:['listAvailableTickets'],values:n=>[[{code:n}]],field:ctx=>[ctx.availableTickets[0]?.code]},
  {name:'结算优惠券',page:'order',method:'loadCoupons',endpoints:['listCoupons'],values:n=>[[{couponId:n}]],field:ctx=>[ctx.coupons[0]?.couponId]},
  {name:'售后进度',page:'order',method:'loadAftersales',endpoints:['listAftersales'],values:n=>[[{id:n}]],field:ctx=>[ctx.aftersales[0]?.id,ctx.aftersalesError]},
  {name:'报价金额/券票',page:'order',method:'refreshQuote',endpoints:['previewOrder'],values:n=>[{amount:n==='A'?10:20,items:[{skuCode:'S',unitPrice:n==='A'?10:20}]}],field:ctx=>[ctx.quote?.amount,ctx.checkout.items[0].price,ctx.quoteError]},
]
for(const c of readCases)for(const oldResult of ['success','error'])test(`M02: ${c.name} ignores old-account ${oldResult} after new account loaded`,async()=>{
  let identity='A';const gate=deferred()
  const api={hasSession:()=>true,canRestoreSession:async()=>true,captureSession:()=>identity,isCurrentSession:s=>s===identity}
  c.endpoints.forEach((name,i)=>api[name]=()=>identity==='A'?gate.promise.then(()=>c.values('A')[i]):Promise.resolve(c.values('B')[i]))
  const {ctx}=page(c.page,api);ctx.checkout={station:'station',items:[{sku:'S',qty:1,price:10}]};ctx.screen='profile'
  const old=ctx[c.method]();await flush();identity='B';await ctx[c.method]();const expected=copy(c.field(ctx))
  if(oldResult==='success')gate.resolve();else gate.reject(new Error('old account timeout'))
  await old;assert.deepEqual(copy(c.field(ctx)),expected)
})

test('M02: logout with an unfinished profile cannot revive guest state even without a subsequent load',async()=>{
  const gate=deferred();let loggedIn=true,epoch=0,modalTask
  const api={hasSession:()=>loggedIn,canRestoreSession:async()=>loggedIn,captureSession:()=>epoch,isCurrentSession:s=>s===epoch,getAccount:()=>gate.promise,listTickets:async()=>[],listOrders:async()=>[],listAftersales:async()=>[],listCoupons:async()=>[],getReferral:async()=>({}),logout:async()=>{loggedIn=false;epoch++}}
  const {ctx}=page('index',api,{showActionSheet:o=>o.success({tapIndex:1}),showModal:o=>{modalTask=o.success({confirm:true})}})
  ctx.screen='profile';const old=ctx.loadProfile();ctx.openSettings();await modalTask;gate.resolve({id:'A',name:'old A',stationName:''});await old
  assert.equal(ctx.guest,true);assert.equal(ctx.profileLoaded,false);assert.equal(ctx.account.name,'')
})

test('M02: retained checkout cannot submit account A address or pending order after switching to B',async()=>{
  let identity='A',writes=0
  const storage=new Map(),api={captureSession:()=>identity,isCurrentSession:s=>s===identity,getAccount:async()=>({id:identity,address:identity+' address'}),createOrder:async()=>{writes++}}
  const {ctx}=page('order',api,{getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value)})
  ctx.screen='checkout';await ctx.loadAccount()
  const original={payload:{idempotencyKey:'A-uncertain'},checkout:{items:[{sku:'A',qty:1}]}}
  ctx.pendingCheckout=original;storage.set('water_pending_checkout_A',original)
  identity='B';await ctx.submitPayment();await flush()
  assert.equal(writes,0);assert.equal(ctx.account.id,'B');assert.equal(ctx.pendingCheckout,null)
  assert.equal(storage.get('water_pending_checkout_A').payload.idempotencyKey,'A-uncertain')
})

test('M02: late 401 from A never clears B token, retries under B or navigates to login',async()=>{
  const gate=deferred(),store=new Map([['water_session_customer',session('A')]])
  const c=service(call=>call.path==='/config'?{demoAuth:false}:gate.promise,store)
  const task=c.api.getAccount(),caught=task.catch(error=>error);await flush()
  store.set('water_session_customer',session('B'));gate.resolve({status:401,body:{code:401,message:'old A expired'}})
  const result=await caught
  assert.equal(result.code,'STALE_SESSION');assert.equal(store.get('water_session_customer').token,'B')
  assert.equal(c.calls.filter(c=>c.path==='/account').length,1);assert.deepEqual(c.navigation,[])
})

test('M02: service rejects a protected late success after clearLocalSession',async()=>{
  const gate=deferred(),store=new Map([['water_session_customer',session('A')]])
  const c=service(()=>gate.promise,store),result=c.api.listTickets().catch(error=>error);await flush();c.api.clearLocalSession('customer');gate.resolve([{code:'private A ticket'}])
  assert.equal((await result).code,'STALE_SESSION');assert.equal(c.api.hasSession('customer'),false)
})

test('D01: actual unassign removes currently selected detail and all actionable delivery state',async t=>{
  const f=await fixture(t)
  const o=await f.ok('/orders','POST',{idempotencyKey:'courier-unassign',items:[{sku:'water-18_9l',quantity:1}],payment:'货到付款',address:f.account.address})
  await f.ok(`/orders/${o.id}/pay`,'POST',{payment:'货到付款'});await f.ok(`/orders/${o.id}/assign`,'POST',{courierId:f.sessions.courier.profile.id},'admin')
  const c=service(f.forward,f.storage),{ctx}=page('delivery',c.api,c.uni);ctx.startSync=()=>{};ctx.stopSync=()=>{};ctx.courierProfile=await c.api.getCourierProfile()
  await ctx.loadOrders();ctx.selectOrder(ctx.orders.find(row=>row.id===o.id));assert.equal(ctx.canAcceptSelected,true)
  ctx.collectTickets=[{code:'test-ticket'}];ctx.confirmed=true;ctx.proofLocalPath='old-photo'
  await f.ok(`/orders/${o.id}/unassign`,'POST',{reason:'isolated regression'},'admin');await ctx.loadOrders()
  assert.equal(ctx.selectedOrder,null);assert.equal(ctx.canAcceptSelected,false);assert.equal(ctx.confirmed,false);assert.equal(ctx.proofLocalPath,'');assert.deepEqual(ctx.collectTickets,[])
  assert.match(ctx.selectionError,/撤回|改派|不可访问/)
  const before=c.calls.filter(c=>/\/accept$/.test(c.path)).length;await ctx.acceptSelectedOrder();assert.equal(c.calls.filter(c=>/\/accept$/.test(c.path)).length,before)
})

test('D01: history outside loaded page retains valid detail; selected-detail transport failure does not invent revocation',async()=>{
  let fail=false
  const old={id:'historical',status:'已完成',amount:10},api={listCourierOrders:async params=>params.page?{items:[],page:1,pageSize:20,total:0}:[],getCourierOrder:async()=>{if(fail)throw Object.assign(new Error('temporary offline'),{statusCode:503});return old}}
  const {ctx}=page('delivery',api);ctx.startSync=()=>{};ctx.stopSync=()=>{};ctx.selectOrder(old)
  await ctx.loadOrders();assert.equal(ctx.selectedOrder.id,old.id);assert.equal(ctx.selectedOrder.status,'已完成')
  fail=true;await ctx.loadOrders();assert.equal(ctx.selectedOrder.id,old.id);assert.match(ctx.ordersError,/temporary offline/)
})

test('D01: late 403 for selected A cannot clear a newer selection B',async()=>{
  const gate=deferred(),A={id:'A',status:'待配送',amount:10},B={id:'B',status:'待配送',amount:10}
  gate.promise.catch(()=>{}) // The original source never asks for detail; retain a clean control run.
  const api={listCourierOrders:async params=>params.page?{items:[B],total:1,page:1,pageSize:20}:params.status==='待配送'?[B]:[],getCourierOrder:()=>gate.promise}
  const {ctx}=page('delivery',api);ctx.startSync=()=>{};ctx.stopSync=()=>{};ctx.selectOrder(A)
  const loading=ctx.loadOrders();await flush();ctx.selectOrder(B);gate.reject(Object.assign(new Error('A unassigned'),{statusCode:403}));await loading
  assert.equal(ctx.selectedOrder.id,'B');assert.equal(ctx.canAcceptSelected,true)
})

test('D01: real detail 403 purges stale active/history/alert rows; old row cannot reopen, reassignment needs fresh readable detail',async t=>{
  const f=await fixture(t),o=await f.ok('/orders','POST',{idempotencyKey:'courier-stale-lists',items:[{sku:'water-18_9l',quantity:1}],payment:'货到付款',address:f.account.address})
  await f.ok(`/orders/${o.id}/pay`,'POST',{payment:'货到付款'});await f.ok(`/orders/${o.id}/assign`,'POST',{courierId:f.sessions.courier.profile.id},'admin')
  const c=service(f.forward,f.storage),{ctx}=page('delivery',c.api,c.uni);ctx.startSync=()=>{};ctx.stopSync=()=>{};ctx.courierProfile=await c.api.getCourierProfile()
  await ctx.loadOrders();const stale=copy(ctx.orders.find(row=>row.id===o.id));ctx.selectOrder(stale);ctx.pendingAlertIds=[o.id]
  const actualList=c.api.listCourierOrders
  c.api.listCourierOrders=async params=>params.page?{items:[stale],page:1,pageSize:20,total:1}:params.status==='待配送'?[stale]:[]
  await f.ok(`/orders/${o.id}/unassign`,'POST',{reason:'stale list timing regression'},'admin')
  await ctx.loadOrders()
  assert.equal(ctx.selectedOrder,null);assert.equal(ctx.activeOrders.some(row=>row.id===o.id),false);assert.equal(ctx.historyOrders.some(row=>row.id===o.id),false)
  assert.equal(ctx.pendingAlertIds.includes(o.id),false);assert.equal(ctx.knownPendingIds.includes(o.id),false)
  ctx.open('orders');ctx.selectOrder(stale);assert.equal(ctx.selectedOrder,null);assert.equal(ctx.canAcceptSelected,false)
  await ctx.acceptSelectedOrder();assert.equal(c.calls.some(c=>/\/accept$/.test(c.path)),false)
  await f.ok(`/orders/${o.id}/assign`,'POST',{courierId:f.sessions.courier.profile.id},'admin');c.api.listCourierOrders=actualList
  const detailsBefore=c.calls.filter(c=>c.path===`/orders/${o.id}`&&c.method==='GET').length
  await ctx.loadOrders();assert.ok(c.calls.filter(c=>c.path===`/orders/${o.id}`&&c.method==='GET').length>detailsBefore,'positive detail revalidation is required after revocation')
  ctx.selectOrder(ctx.orders.find(row=>row.id===o.id));assert.equal(ctx.canAcceptSelected,true)
})

test('D01: detail 403 immediately disables the selected order before older pending-list responses arrive',async()=>{
  const gate=deferred(),A={id:'A',status:'待配送',amount:10}
  const api={listCourierOrders:async params=>params.page?{items:[A],total:1,page:1,pageSize:20}:params.status==='待配送'?gate.promise:[],getCourierOrder:async()=>{throw Object.assign(new Error('revoked'),{statusCode:403})}}
  const {ctx}=page('delivery',api);ctx.startSync=()=>{};ctx.stopSync=()=>{};ctx.activeOrders=[A];ctx.historyOrders=[A];ctx.selectOrder(A)
  const loading=ctx.loadOrders();await flush()
  try{assert.equal(ctx.selectedOrder,null,'403 must invalidate selection without waiting for list completion');assert.equal(ctx.canAcceptSelected,false)}finally{gate.resolve([A]);await loading}
  assert.deepEqual(ctx.orders,[]);ctx.selectOrder(A);assert.equal(ctx.selectedOrder,null);assert.equal(ctx.canAcceptSelected,false)
})
