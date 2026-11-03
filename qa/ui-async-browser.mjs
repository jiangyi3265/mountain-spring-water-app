// Run against an existing loopback H5 server. Every API request is forwarded to this
// process's disposable SQLite/API; no live endpoint or private credential is used.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
assert.equal(process.version,'v24.16.0')
const target=process.env.MOBILE_URL||process.env.ORDER_QA_URL
assert.ok(target,'Set MOBILE_URL or ORDER_QA_URL to an existing loopback H5 server')
const parsed=new URL(target)
assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)&&parsed.protocol==='http:','Loopback HTTP H5 only')
const origin=parsed.origin
assert.equal((await fetch(origin)).status,200)
const root=new URL(existsSync(new URL('../../water-api/server.mjs',import.meta.url))?'../../':'../../../',import.meta.url)
const out=pathToFileURL(resolve(process.env.QA_EVIDENCE_DIR||join(fileURLToPath(root),'.qa-runtime/audit-20260929/ui-review'),`mobile-async-browser/${Date.now()}-${process.pid}`)+'/')
await mkdir(out,{recursive:true})
const require=createRequire(new URL('桶装水/package.json',root));let chromium
try{({chromium}=require('playwright'))}catch{({chromium}=require(`${process.env.APPDATA}/npm/node_modules/playwright`))}
for(const key of Object.keys(process.env))if(/^(WATER_API_|WECHAT_|OSS_|AMAP_|TENCENT_)/.test(key))delete process.env[key]
process.env.NODE_ENV='test'
const {createWaterApi}=await import(new URL('water-api/server.mjs',root))
const {createWechatClient,createGeocoder,createOssClient}=await import(new URL('water-api/lib/integrations.mjs',root))
const password='UiAsyncBrowser!2026'
const app=await createWaterApi({dataFile:fileURLToPath(new URL('isolated.sqlite',out)),tokenSecret:'ui-async-browser-disposable-signing-key-20260929',defaultPassword:password,seedDemoData:true,demoAuthEnabled:true,simulatedPaymentsEnabled:false,ruoyiVerifyUrl:'',integrations:{wechat:createWechatClient({}),oss:createOssClient({}),geocoder:createGeocoder({})}})
await new Promise(done=>app.server.listen(0,'127.0.0.1',done))
const base=`http://127.0.0.1:${app.server.address().port}/api`,sessions={}
const report={startedAt:new Date().toISOString(),node:process.version,origin,environment:'actual loopback H5 + actual isolated API/SQLite; synthetic accounts; no production/device/money operations',cases:[],requests:[],console:[],pageErrors:[],requestFailures:[],externalStubs:[]}
let browser,page,context,gate=null,deliveryRace=null,expectStockConflict=false,failNextPay=false,navigation=false,serial=0,currentCase='setup'
const expectedErrors=new Set()
const expectedConsoleResponses=[]
function expectedResponse(record,body){
  record.case=currentCase;record.responseBody=body
  expectedConsoleResponses.push({requestIndex:report.requests.indexOf(record),path:record.path.split('?')[0],status:record.status,case:record.case,phase:record.phase||record.expected,consumed:false})
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
async function waitForGate(promise){let timer;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Expected browser request did not reach its timing gate')),15000)})])}finally{clearTimeout(timer)}}
async function ok(path,method='GET',data,role='customer'){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(sessions[role]?{Authorization:`Bearer ${sessions[role].token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)})
  const payload=await response.json();assert.ok(response.status<300,`${path}: ${response.status} ${payload.message}`);return payload.data
}
async function go(route){navigation=true;try{await page.goto(`${origin}/?uiAsync=${++serial}#${route}`,{waitUntil:'domcontentloaded'})}finally{navigation=false}}
async function shot(name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:true})}
async function newPage(){
  if(context)await context.close()
  context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(url.pathname.startsWith('/api/')){
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'}
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
      if(failNextPay&&/\/orders\/[^/]+\/pay$/.test(url.pathname)){
        failNextPay=false;expectedErrors.add(url.pathname)
        const body=JSON.stringify({code:503,message:'浏览器回归注入：付款暂时不可用'}),record={path:url.pathname,method:req.method(),status:503,expected:'injected one payment failure before commit'}
        report.requests.push(record);expectedResponse(record,body)
        return route.fulfill({status:503,contentType:'application/json',headers,body})
      }
      if(deliveryRace&&url.pathname===`/api/orders/${deliveryRace.id}`&&req.method()==='GET')await deliveryRace.allowDetail.promise
      const response=await fetch(base+url.pathname.slice(4)+url.search,{method:req.method(),headers:{'Content-Type':'application/json',...(req.headers().authorization?{Authorization:req.headers().authorization}:{})},body:['GET','HEAD'].includes(req.method())?undefined:req.postData()})
      const body=await response.text(),record={path:url.pathname+url.search,method:req.method(),status:response.status}
      if(response.status===403&&expectedErrors.has(url.pathname))record.expected='revoked courier detail is correctly forbidden'
      if(currentCase==='M01-zero-stock-correct-same-key'&&expectStockConflict&&response.status===409&&['/api/orders','/api/orders/preview'].includes(url.pathname)){record.expected='real zero-stock rejection before any order exists';record.phase=url.pathname==='/api/orders'?'zero-stock-create':'zero-stock-correction-quote'}
      report.requests.push(record)
      if(record.expected)expectedResponse(record,body)
      if(deliveryRace&&url.pathname==='/api/orders'&&url.searchParams.get('status')==='待配送'&&!deliveryRace.captured){deliveryRace.captured=true;record.expected='held old assigned-order list before revocation';deliveryRace.arrived.resolve();await deliveryRace.release.promise}
      if(gate&&gate.path===url.pathname&&!gate.captured){gate.captured=true;record.expected='held old account response';gate.arrived.resolve();await gate.release.promise}
      await route.fulfill({status:response.status,body,contentType:'application/json',headers})
      return
    }
    if(url.origin===origin||url.protocol==='data:')return route.continue()
    report.externalStubs.push({host:url.hostname,path:url.pathname,type:req.resourceType()})
    // Never contact optional third-party SDK/assets during isolated UI regression.
    return route.fulfill({status:200,body:'',contentType:req.resourceType()==='script'?'application/javascript':'text/plain'})
  })
  page=await context.newPage();page.setDefaultTimeout(15000)
  page.on('pageerror',error=>report.pageErrors.push(error.message))
  page.on('console',message=>{if(['error','warning'].includes(message.type())){
    const entry={type:message.type(),text:message.text(),url:message.location().url,expected:false};let path='';try{path=new URL(entry.url).pathname}catch{}
    const match=entry.text.match(/^Failed to load resource: the server responded with a status of (\d{3})\b/)
    const expected=match&&expectedConsoleResponses.find(row=>!row.consumed&&row.path===path&&row.status===Number(match[1]))
    if(expected){expected.consumed=true;entry.expected=true;entry.requestIndex=expected.requestIndex;entry.case=expected.case;entry.phase=expected.phase}
    report.console.push(entry)
  }})
  page.on('requestfailed',req=>report.requestFailures.push({path:new URL(req.url()).pathname,error:req.failure()?.errorText,expectedNavigationAbort:navigation&&req.failure()?.errorText==='net::ERR_ABORTED'}))
}
async function login(phone){await page.locator('#auth-phone input').fill(phone);await page.locator('#auth-password input').fill(password);if(await page.locator('.uni-checkbox-input svg').count()===0)await page.locator('.consent-toggle').click();await page.locator('.auth-submit').click();await page.locator('.auth-submit').waitFor({state:'hidden'})}
async function buy(){
  await go('/pages/index/index');await page.locator('.product-card').filter({hasText:'18.9L'}).first().click()
  await page.getByText('立即购买',{exact:true}).click();await page.locator('.screen-confirm').waitFor()
  await page.locator('.pay-option').filter({hasText:'余额支付'}).click()
  await page.getByText('提交订单',{exact:true}).click();await page.locator('.screen-checkout').waitFor()
}
async function failedCheckout(){
  await buy();failNextPay=true
  const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST')
  await page.getByText(/^确认支付 ¥/).click();const response=await created;assert.equal(response.status(),201);const order=(await response.json()).data
  await page.getByText('继续原订单',{exact:true}).waitFor()
  await page.waitForFunction(()=>![...document.querySelectorAll('uni-button')].some(x=>x.textContent==='正在同步订单…'))
  assert.equal(await page.locator('.pay-options').count(),0,'payment selector must not change an already created order')
  return order
}
async function runCase(id,fn){currentCase=id;try{const facts=await fn();report.cases.push({id,status:'PASS',...facts});console.log(id+' PASS')}catch(error){report.cases.push({id,status:'FAIL',error:error.stack});await shot(id+'-failure').catch(()=>{});throw error}}
try{
  for(const role of ['admin','customer','courier'])sessions[role]=await ok('/auth/demo-login','POST',{role,...(role==='courier'?{phone:'13812345678'}:{})},'')
  const account=await ok('/account')
  const B=await ok('/auth/register','POST',{name:'独立回归乙',phone:'13700009876',password,address:'隔离测试地址乙 2 栋',stationId:'station-001'},'')
  browser=await chromium.launch({headless:true})
  await newPage();await go('/pages/index/index?screen=auth');await login(sessions.customer.profile.phone)
  await runCase('M01-continue-original',async()=>{
    const before=app.store.db.prepare('SELECT COUNT(*) n FROM orders').get().n
    const original=await failedCheckout();await shot('payment-recovery-original')
    await page.getByText('继续原订单',{exact:true}).click();await page.getByText('支付成功',{exact:true}).first().waitFor()
    const after=app.store.get(original.id);assert.equal(after.payStatus,'已支付')
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM orders').get().n,before+1)
    await shot('payment-continued-success');return{orderId:original.id,ordersCreated:1,payStatus:after.payStatus}
  })
  await runCase('M01-cancel-before-change',async()=>{
    const original=await failedCheckout()
    await page.getByText('取消原待付款单并重新选择',{exact:true}).click()
    await page.locator('.uni-modal__btn_primary').click()
    await page.locator('.screen-confirm .pay-options').waitFor()
    assert.equal(app.store.get(original.id).status,'已取消')
    await page.locator('.pay-option').filter({hasText:'货到付款'}).click()
    await page.getByText('提交订单',{exact:true}).click()
    const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST')
    await page.getByText(/^确认支付 ¥/).click();const replacement=(await (await created).json()).data
    await page.getByText('下单成功',{exact:true}).waitFor()
    assert.notEqual(replacement.id,original.id);assert.equal(app.store.get(replacement.id).status,'待配送')
    const sum=app.store.db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM order_inventory_allocations WHERE order_id IN (?,?) AND status IN ('预占','已扣减')").get(original.id,replacement.id).n
    assert.equal(sum,1);await shot('payment-changed-after-cancel');return{canceled:original.id,replacement:replacement.id,liveAllocation:sum}
  })
  await runCase('M01-zero-stock-correct-same-key',async()=>{
    await buy()
    app.store.db.prepare("UPDATE warehouse_stock SET quantity=0 WHERE sku_id IN (SELECT id FROM product_skus WHERE code='water-18_9l')").run()
    expectStockConflict=true
    const rejected=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST')
    await page.getByText(/^确认支付 ¥/).click();const conflict=await rejected;assert.equal(conflict.status(),409)
    const original=conflict.request().postDataJSON(),before=report.requests.filter(r=>r.path==='/api/orders'&&r.method==='POST').length
    await page.getByText('取消原待付款单并重新选择',{exact:true}).click();await page.locator('.uni-modal__btn_primary').click()
    await page.locator('.screen-confirm .pay-options').waitFor()
    assert.equal(report.requests.filter(r=>r.path==='/api/orders'&&r.method==='POST').length,before,'cancel/no-order action is read-only')
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM orders WHERE idempotency_key=?').get(original.idempotencyKey).n,0)
    await shot('zero-stock-editable-no-order')
    expectStockConflict=false
    app.store.db.prepare("UPDATE warehouse_stock SET quantity=20 WHERE sku_id IN (SELECT id FROM product_skus WHERE code='water-18_9l')").run()
    const stockBefore=app.store.db.prepare("SELECT SUM(quantity) n FROM warehouse_stock WHERE sku_id IN (SELECT id FROM product_skus WHERE code='water-18_9l')").get().n
    await go('/pages/order/index?screen=confirm');await page.locator('.screen-confirm .pay-options').waitFor()
    await page.locator('.pay-option').filter({hasText:'货到付款'}).click();await page.getByText('提交订单',{exact:true}).click()
    const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST')
    await page.getByText(/^确认支付 ¥/).click();const response=await created;assert.equal(response.status(),201)
    assert.equal(response.request().postDataJSON().idempotencyKey,original.idempotencyKey)
    await page.getByText('下单成功',{exact:true}).waitFor()
    const order=(await response.json()).data
    assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM orders WHERE idempotency_key=?').get(original.idempotencyKey).n,1)
    const allocated=app.store.db.prepare("SELECT SUM(quantity) n FROM order_inventory_allocations WHERE order_id=? AND status IN ('预占','已扣减')").get(order.id).n
    const stockAfter=app.store.db.prepare("SELECT SUM(quantity) n FROM warehouse_stock WHERE sku_id IN (SELECT id FROM product_skus WHERE code='water-18_9l')").get().n
    assert.equal(allocated,1);assert.equal(stockBefore-stockAfter,1)
    await shot('zero-stock-corrected-same-key');return{orderId:order.id,stockConflict:409,cancelCreateRequests:0,sameKeyAfterReload:true,liveAllocation:allocated,stockDecrement:stockBefore-stockAfter}
  })
  await runCase('M02-account-switch-late-response',async()=>{
    await newPage();await go('/pages/index/index?screen=auth')
    gate={path:'/api/account',arrived:deferred(),release:deferred(),captured:false}
    await login(sessions.customer.profile.phone);await waitForGate(gate.arrived.promise)
    await page.locator('.bottom-nav .nav-item').filter({hasText:'我的'}).click()
    await page.locator('.profile-menu').getByText('设置',{exact:true}).click()
    await page.locator('.uni-actionsheet__cell').getByText('退出登录',{exact:true}).click()
    await page.locator('.uni-modal__btn_primary').click();await page.locator('.auth-submit').waitFor()
    await login('13700009876');await page.locator('.bottom-nav .nav-item').filter({hasText:'我的'}).click()
    await page.locator('.profile-user').getByText('独立回归乙',{exact:true}).waitFor()
    const done=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account'&&r.request().method()==='GET')
    gate.release.resolve();await done;gate=null
    await page.waitForFunction(()=>document.querySelector('.profile-user')?.textContent.includes('独立回归乙'))
    // Wait for the fulfilled old response's promise/microtasks and a painted frame.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.match(await page.locator('.profile-user').innerText(),/独立回归乙/)
    assert.doesNotMatch(await page.locator('.profile-user').innerText(),new RegExp(account.name))
    await shot('account-B-after-A-late-response');return{visibleAccount:'独立回归乙',accountId:B.profile.id,oldResponseReleased:true}
  })
  await runCase('D01-unassign-before-stale-list-response',async()=>{
    const order=await ok('/orders','POST',{idempotencyKey:'ui-async-courier',items:[{sku:'water-18_9l',quantity:1}],payment:'货到付款',address:account.address})
    await ok(`/orders/${order.id}/pay`,'POST',{payment:'货到付款'});await ok(`/orders/${order.id}/assign`,'POST',{courierId:sessions.courier.profile.id},'admin')
    await newPage();await go('/pages/delivery/index')
    await page.locator('.login-form input').nth(0).fill('13812345678');await page.locator('.login-form input').nth(1).fill(password);if(await page.locator('.uni-checkbox-input svg').count()===0)await page.locator('.consent-toggle').click();await page.getByText('登录工作台',{exact:true}).click()
    await page.locator('.bottom-nav .nav-item').filter({hasText:'订单'}).click();await page.locator('.segment-row').getByText('待配送',{exact:true}).click()
    await page.locator('.simple-order').filter({hasText:account.name}).first().click()
    await page.getByText('接单并开始配送',{exact:true}).waitFor()
    deliveryRace={id:order.id,arrived:deferred(),allowDetail:deferred(),release:deferred(),captured:false}
    await waitForGate(deliveryRace.arrived.promise)
    expectedErrors.add(`/api/orders/${order.id}`)
    await ok(`/orders/${order.id}/unassign`,'POST',{reason:'isolated browser regression'},'admin')
    deliveryRace.allowDetail.resolve()
    await page.getByText('该订单已撤回、改派或不可访问，请返回任务列表',{exact:true}).waitFor({timeout:15000})
    assert.equal(await page.getByText('接单并开始配送',{exact:true}).count(),0)
    assert.equal(app.store.get(order.id).courierId,null)
    await shot('courier-revoked-before-old-list')
    const oldList=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&new URL(r.url()).searchParams.get('status')==='待配送')
    deliveryRace.release.resolve();await oldList;deliveryRace=null
    await page.getByText('返回任务列表',{exact:true}).click()
    await page.waitForFunction(name=>![...document.querySelectorAll('.simple-order')].some(x=>x.textContent.includes(name)),account.name)
    assert.equal(await page.locator('.simple-order').filter({hasText:account.name}).count(),0)
    await shot('courier-stale-list-cannot-restore-task');return{orderId:order.id,canAccept:false,detailRevokedBeforeListReleased:true,staleTaskVisible:false}
  })
  report.unexpectedHttp=report.requests.filter(r=>r.status>=400&&!r.expected)
  report.unexpectedConsole=report.console.filter(r=>r.type==='error'&&!r.expected)
  report.unexpectedFailures=report.requestFailures.filter(r=>!r.expectedNavigationAbort)
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.unexpectedHttp,[]);assert.deepEqual(report.unexpectedConsole,[]);assert.deepEqual(report.unexpectedFailures,[])
  report.status='PASS'
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;console.error(error.stack)}finally{
  gate?.release.resolve()
  deliveryRace?.allowDetail.resolve();deliveryRace?.release.resolve()
  await browser?.close();await new Promise(done=>app.server.close(done))
  report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2))
  console.log('Browser evidence: '+fileURLToPath(out))
}
