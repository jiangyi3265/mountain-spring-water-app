// Preview and published builds both use the deployed service unless a local
// integration server is explicitly selected through VITE_WATER_API_URL.
const API_BASE_URL = (import.meta.env.VITE_WATER_API_URL || 'https://cang.oksja.cn/api').replace(/\/$/, '')
const loginRequests = new Map()
const logoutRequests = new Map()
const authEpochs = new Map()
const AUTH_REQUIRED_KEY = 'water_auth_required'
let configCache = null
let configRequest = null

function queryString(params = {}) {
	const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
	return entries.length ? `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}` : ''
}

function storageKey(role) { return `water_session_${role}` }

function readSession(role) {
	try {
		const session = uni.getStorageSync(storageKey(role))
		if (session?.token && new Date(session.expiresAt).getTime() > Date.now() + 60000) return session
	} catch {
		uni.removeStorageSync(storageKey(role))
	}
	return null
}

function writeSession(role, session, epoch = authEpochs.get(role) || 0) {
  if (epoch !== (authEpochs.get(role) || 0)) throw new Error('登录操作已取消，请重新登录')
	uni.setStorageSync(storageKey(role), session)
	try { uni.removeStorageSync(`${AUTH_REQUIRED_KEY}_${role}`) } catch (error) { console.warn('[auth-flag]', error) }
	return session
}

function clearSession(role) {
  authEpochs.set(role, (authEpochs.get(role) || 0) + 1)
	try { uni.removeStorageSync(storageKey(role)) } catch (error) { console.warn('[session-clear]', error) }
	try { uni.setStorageSync(`${AUTH_REQUIRED_KEY}_${role}`, '1') } catch (error) { console.warn('[auth-flag]', error) }
}

function saveAuthRequest(role, startRequest) {
  if (logoutRequests.has(role)) return Promise.reject(new Error('退出处理中，请稍后登录'))
  authEpochs.set(role, (authEpochs.get(role) || 0) + 1)
  const epoch = authEpochs.get(role) || 0
  return startRequest().then(session => writeSession(role, session, epoch))
}

function logout(role) {
  if (logoutRequests.has(role)) return logoutRequests.get(role)
  authEpochs.set(role, (authEpochs.get(role) || 0) + 1)
  const task = (async () => {
    const session = uni.getStorageSync(storageKey(role))
    if (session?.token) {
      try { await rawRequest('/auth/logout', { method: 'POST', token: session.token, silent: true }) }
      catch (error) { if (error.statusCode !== 401) throw error }
    }
    clearSession(role)
  })().finally(() => logoutRequests.delete(role))
  logoutRequests.set(role, task)
  return task
}

function captureSession(role = 'customer') {
  return { role, epoch: authEpochs.get(role) || 0, token: uni.getStorageSync(storageKey(role))?.token || null }
}
function isCurrentSession(identity) {
  if (identity.epoch !== (authEpochs.get(identity.role) || 0)) return false
  const token = uni.getStorageSync(storageKey(identity.role))?.token || null
  // No initial token allows an automatic local-demo login, but explicit login advances epoch.
  return !identity.token || identity.token === token
}
function staleSessionError() {
  return Object.assign(new Error('登录身份已变化，已忽略旧请求'), { code: 'STALE_SESSION' })
}

function authRequired(role) {
	try { return uni.getStorageSync(`${AUTH_REQUIRED_KEY}_${role}`) === '1' } catch { return false }
}

/** 访客浏览：没有有效会话、也不能自动（本地联调演示）登录时返回 false，调用方据此跳过受保护接口而不触发登录跳转。 */
async function canRestoreSession(role) {
	if (readSession(role)) return true
	const config = await getConfig()
	return Boolean(config.demoAuth) && !authRequired(role)
}

/**
 * @param {string} path
 * @param {{ method?: UniApp.RequestOptions['method'], data?: any, token?: string, silent?: boolean }} options
 * @returns {Promise<any>}
 */
function rawRequest(path, { method = 'GET', data, token, silent = false } = {}) {
	return new Promise((resolve, reject) => {
		const header = { 'Content-Type': 'application/json' }
		if (token) header.Authorization = `Bearer ${token}`
		uni.request({
			url: `${API_BASE_URL}${path}`,
			method,
			data,
			timeout: 12000,
			header,
			success(response) {
				const payload = /** @type {{ code?: number, data?: any, message?: string }} */ (response.data)
				if (response.statusCode >= 200 && response.statusCode < 300 && payload?.code === 0) return resolve(payload.data)
				const error = /** @type {Error & { statusCode: number }} */ (new Error(payload?.message || `接口请求失败（${response.statusCode}）`))
				error.statusCode = response.statusCode
				if (!silent) toastRequestError(error.message)
				reject(error)
			},
			fail(cause) {
				// 保留真机上常见的失败原因，便于区分域名未加入小程序合法域名、超时和证书问题
				const detail = String(cause?.errMsg || '')
				const reason = /domain list|合法域名/i.test(detail) ? '（域名未配置）' : /timeout|超时/i.test(detail) ? '（网络超时）' : /ssl|certificate|证书/i.test(detail) ? '（证书异常）' : ''
				if (detail) console.warn('[water-api] request failed', path, detail)
				const error = new Error(`协同服务暂时不可用，请稍后重试${reason}`)
				error.cause = cause
				if (!silent) toastRequestError(error.message)
				reject(error)
			},
		})
	})
}

function clientConfig(config) {
	let miniProgram = false
	// #ifdef MP-WEIXIN
	miniProgram = true
	// #endif
	const wechatPay = Boolean(config.wechatPay && miniProgram && typeof uni.requestPayment === 'function')
	const simulatedPayments = Boolean(config.simulatedPayments && !config.wechatPay)
	return { ...config, wechatPay, simulatedPayments,
		wechatLogin: Boolean(config.wechatLogin && miniProgram && typeof uni.login === 'function'),
		onlineRecharge: Boolean(config.onlineRecharge && (wechatPay || simulatedPayments)),
		wechatPayMessage: config.wechatPay && !wechatPay ? '请在微信小程序中使用微信支付或在线充值' : '在线支付暂未开通，请联系所属水站',
	}
}

async function requireOnlinePayment(recharge = false) {
	const config = await getConfig(true)
	if (!(recharge ? config.onlineRecharge : config.wechatPay || config.simulatedPayments)) throw new Error(config.wechatPayMessage || '在线支付暂未开通')
}

async function getConfig(force = false) {
	if (configCache && !force) return configCache
	if (!configRequest) {
		configRequest = rawRequest('/config', { silent: true })
			.then(config => { configCache = clientConfig(config); return configCache })
			.catch(() => ({ demoAuth: false, simulatedPayments: false, wechatLogin: false, wechatPay: false }))
			.finally(() => { configRequest = null })
	}
	return configRequest
}

let loginNavigationPending = false
function showLogin(role) {
  const route = role === 'courier' ? 'pages/delivery/index' : 'pages/index/index'
  const screen = role === 'courier' ? 'login' : 'auth'
  // 只在当前页面属于该角色时跳转：客户与配送员切换途中，另一角色迟到的 401 只清掉它自己的会话（调用前已清），
  // 不把用户拉回刚离开的角色；该角色下次操作时会重新要求登录。
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const current = pages[pages.length - 1]?.route
  if (current && (current === 'pages/delivery/index') !== (role === 'courier')) return
  if (loginNavigationPending) return
  loginNavigationPending = true
  uni.reLaunch({ url: `/${route}?screen=${screen}`, complete: () => { loginNavigationPending = false } })
}

/** 首页可原地显示登录表单；其他页面需要切换到对应角色的登录页。 */
const hooks = { onAuthRequired: showLogin }

async function login(role, credentials = {}, force = false) {
  if (logoutRequests.has(role)) throw new Error('退出处理中，请稍后登录')
  if (force) authEpochs.set(role, (authEpochs.get(role) || 0) + 1)
  const epoch = authEpochs.get(role) || 0
	if (!force) {
		const cached = readSession(role)
		if (cached) return cached
	}
	if (loginRequests.has(role)) return loginRequests.get(role)
	const promise = (async () => {
		const config = await getConfig()
    if (epoch !== (authEpochs.get(role) || 0)) throw new Error('登录操作已取消，请重新登录')
		if (!config.demoAuth || authRequired(role) || credentials.password) {
			if (!credentials.phone || !credentials.password) {
				const error = /** @type {Error & { code: string }} */ (new Error('请先登录'))
				error.code = 'AUTH_REQUIRED'
				throw error
			}
            return writeSession(role, await rawRequest('/auth/login', { method: 'POST', data: { role, phone: credentials.phone, password: credentials.password }, silent: true }), epoch)
		}
        return writeSession(role, await rawRequest('/auth/demo-login', { method: 'POST', data: { role, ...credentials }, silent: true }), epoch)
	})().finally(() => loginRequests.delete(role))
	loginRequests.set(role, promise)
	return promise
}

// 接口层弹出的错误提示；页面的 catch 常会再弹同一句，页面提示前先检查，避免同一错误出现两次。
let lastRequestToast = { title: '', at: 0 }
/** @param {string} title */
function toastRequestError(title) {
	lastRequestToast = { title: String(title), at: Date.now() }
	uni.showToast({ title, icon: 'none' })
}
/**
 * 1.5 秒内接口层已弹出同一句提示时返回 true，并且只抵消一次：接口层弹一次对应页面 catch 的一次，
 * 紧接着另一个操作以同一句话失败时仍会正常提示。 @param {unknown} title
 */
function recentlyToasted(title) {
	const hit = Boolean(title) && lastRequestToast.title === String(title) && Date.now() - lastRequestToast.at < 1500
	if (hit) lastRequestToast = { title: '', at: 0 }
	return hit
}

/**
 * @param {string} path
 * @param {{ method?: UniApp.RequestOptions['method'], data?: any, role?: string, silent?: boolean, retry?: boolean }} options
 */
async function request(path, { method = 'GET', data, role = 'customer', silent = false, retry = true } = {}) {
  const started = captureSession(role)
  let session
  try {
    session = await login(role)
    if (!isCurrentSession(started)) throw staleSessionError()
  } catch (error) {
    if (isCurrentSession(started) && error.code === 'AUTH_REQUIRED') hooks.onAuthRequired(role)
    throw error
  }
  const identity = captureSession(role)
  try {
    const result = await rawRequest(path, { method, data, token: session.token, silent: true })
    if (!isCurrentSession(identity)) throw staleSessionError()
    return result
  } catch (error) {
    // A second 401 of the same invalidated session may join the login-required path;
    // a late response from another identity must never delete/retry under its new token.
    const sameEpoch = identity.epoch === (authEpochs.get(role) || 0)
    const removedBy401 = sameEpoch && !uni.getStorageSync(storageKey(role))?.token && !authRequired(role)
    if (!isCurrentSession(identity) && !(error.statusCode === 401 && removedBy401)) throw staleSessionError()
    if (retry && error.statusCode === 401) {
      try { uni.removeStorageSync(storageKey(role)) } catch (cause) { console.warn('[session-clear]', cause) }
      return request(path, { method, data, role, silent, retry: false })
    }
    if (!silent && error.code !== 'STALE_SESSION') toastRequestError(error.message)
    throw error
  }
}

/**
 * 把本地图片路径读成 base64（H5 为 blob:/data: 地址，小程序为临时文件路径）
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function readFileAsBase64(filePath) {
	let task
	// #ifdef H5
	task = fetch(filePath).then(response => response.arrayBuffer()).then(buffer => {
		let binary = ''
		const bytes = new Uint8Array(buffer)
		for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
		return btoa(binary)
	})
	// #endif
	// #ifndef H5
	task = new Promise((resolve, reject) => {
		uni.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: result => resolve(String(result.data)), fail: reject })
	})
	// #endif
	return task
}

/** Order-list pagination only; never silently fall back to the truncated legacy endpoint.
 * @param {{ page?: number, pageSize?: number, status?: string }} [params]
 * @param {string} role
 * @returns {Promise<any>}
 */
async function listOrderPages(params = {}, role = 'customer') {
	const identity = captureSession(role)
	const rows = new Map()
	let page = params.page || 1, total
	for (;;) {
		const result = await request(`/orders${queryString({ ...params, page, pageSize: params.pageSize || 100 })}`, { role, silent: true })
		if (!isCurrentSession(identity)) throw staleSessionError()
		if (!Array.isArray(result?.items) || !Number.isInteger(result.total) || result.total < 0 || result.page !== page || !Number.isInteger(result.pageSize) || result.pageSize < 1 || (!result.items.length && (page - 1) * result.pageSize < result.total)) throw new Error('订单分页数据异常，请刷新重试')
		if (params.page) return result
		if (total !== undefined && total !== result.total) throw new Error('订单列表发生变化，请刷新重试')
		total = result.total
		const before = rows.size
		for (const order of result.items) rows.set(order.id, order)
		if (page * result.pageSize >= result.total) {
			if (rows.size < result.total) throw new Error('订单列表发生变化，请刷新重试')
			return [...rows.values()]
		}
		if (rows.size === before) throw new Error('订单分页没有前进，请刷新重试')
		page += 1
	}
}

export const waterApi = {
	recentlyToasted,
	captureSession,
	isCurrentSession,
	async getAttachment(path, role = 'customer') {
		if (!/^\/api\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(path)) throw new Error('附件地址不合法')
		const result = await request(`${path.slice(4)}/content`, { role, silent: true })
		return result.dataUrl
	},
	baseUrl: API_BASE_URL,
	hooks,
	showLogin,
	getConfig,
	/** 把接口返回的相对图片地址补成完整地址 */
	fileUrl: path => (!path ? '' : /^https?:/.test(path) ? path : `${API_BASE_URL.replace(/\/api$/, '')}${path}`),
	health: () => rawRequest('/health', { silent: true }),
	// ---- 认证 ----
	hasSession: role => Boolean(readSession(role)),
	canRestoreSession,
	authRequired,
	login,
	loginWithPassword: (role, phone, password) => login(role, { phone, password }, true),
    register: data => saveAuthRequest('customer', () => rawRequest('/auth/register', { method: 'POST', data, silent: true })),
    wechatLogin: data => saveAuthRequest('customer', () => rawRequest('/auth/wechat', { method: 'POST', data, silent: true })),
	// changePassword / exchangePoints / claimCoupon 的错误由页面 catch 统一提示；接口层静默，避免同一错误弹两次。
	changePassword: (role, oldPassword, newPassword) => request(role === 'courier' ? '/courier/password' : '/account/password', { method: 'PUT', data: { oldPassword, newPassword }, role, silent: true }),
	getProfile: role => readSession(role)?.profile || null,
    logout,
    clearLocalSession: clearSession,
	// ---- 账户 ----
	updateAccount: data => request('/account', { method: 'PUT', data }),
	exchangePoints: couponId => request('/points/exchange', { method: 'POST', data: { couponId }, silent: true }),
	getReferral: () => request('/account/referral', { silent: true }),
	listAvailableTickets: sku => request(`/account/tickets/available${queryString({ sku })}`, { silent: true }),
	/** 上传本地图片，返回 { url } */
	uploadImage: async (filePath, role = 'customer') => {
		const identity=captureSession(role)
		const data = await readFileAsBase64(filePath)
		if(!isCurrentSession(identity))throw staleSessionError()
		if (data.length > 2 * 1024 * 1024 * 1.4) throw new Error('图片不能超过 2MB')
		return request('/uploads', { method: 'POST', data: { data }, role })
	},
	// ---- 在线充值 ----
	listRechargePackages: () => rawRequest('/recharge/packages', { silent: true }),
	createRecharge: async data => { const identity=captureSession('customer');await requireOnlinePayment(true);if(!isCurrentSession(identity))throw staleSessionError(); return request('/recharges', { method: 'POST', data }) },
	listRecharges: () => request('/recharges', { silent: true }),
	getRecharge: id => request(`/recharges/${encodeURIComponent(id)}`, { silent: true }),
	simulateRecharge: id => request(`/recharges/${encodeURIComponent(id)}/simulate-pay`, { method: 'POST' }),
	// ---- 订阅消息授权（小程序 wx.requestSubscribeMessage 的结果） ----
	recordSubscriptions: results => request('/notifications/subscriptions', { method: 'POST', data: { results }, silent: true }),
	// ---- 送水员 ----
	/** 上门收水票：preview=true 只试算收票后的应收，不核销 */
	courierRedeemTicket: data => request('/courier/ticket-redemptions', { method: 'POST', data, role: 'courier' }),
	courierPreviewTickets: data => request('/courier/ticket-redemptions', { method: 'POST', data: { ...data, preview: true }, role: 'courier', silent: true }),
	setCourierOnline: online => request('/courier/online', { method: 'POST', data: { online }, role: 'courier' }),
	getCourierProfile: () => request('/courier/profile', { role: 'courier', silent: true }),
	// ---- 目录 ----
	/** station 传客户所属水站时，库存按该水站仓库统计（与下单预占口径一致） */
	listCatalogProducts: (categoryId, station) => rawRequest(`/catalog/products${queryString({ categoryId, station })}`, { silent: true }),
	listCatalogCategories: () => rawRequest('/catalog/categories', { silent: true }),
	listCatalogStations: () => rawRequest('/catalog/stations', { silent: true }),
	// ---- 订单 ----
	// Explicit page returns metadata; legacy array callers (including home counts) traverse every page.
	listOrders: params => listOrderPages(params, 'customer'),
	listCourierOrders: params => listOrderPages(params, 'courier'),
	getCourierOrder: id => request(`/orders/${encodeURIComponent(id)}`, { role: 'courier', silent: true }),
	recoverOrder: key => request(`/orders/recovery?idempotencyKey=${encodeURIComponent(key)}`, { silent: true }),
	getOrder: id => request(`/orders/${encodeURIComponent(id)}`, { silent: true }),
	/** 服务端报价：商品金额、水票抵扣、优惠券、配送费与应付金额，与下单同一套计价 */
	previewOrder: data => request('/orders/preview', { method: 'POST', data, silent: true }),
	createOrder: async data => { const identity=captureSession('customer');if (data.payment === '微信支付') await requireOnlinePayment();if(!isCurrentSession(identity))throw staleSessionError(); return request('/orders', { method: 'POST', data }) },
	payOrder: (id, data) => request(`/orders/${encodeURIComponent(id)}/pay`, { method: 'POST', data }),
	wechatPrepay: async orderId => { const identity=captureSession('customer');await requireOnlinePayment();if(!isCurrentSession(identity))throw staleSessionError(); return request('/payments/wechat/prepay', { method: 'POST', data: { orderId } }) },
	cancelOrder: (id, data = {}) => request(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', data }),
	confirmReceipt: id => request(`/orders/${encodeURIComponent(id)}/confirm-receipt`, { method: 'POST' }),
	acceptOrder: id => request(`/orders/${encodeURIComponent(id)}/accept`, { method: 'POST', role: 'courier' }),
	completeOrder: (id, data) => request(`/orders/${encodeURIComponent(id)}/complete`, { method: 'POST', data, role: 'courier' }),
	// ---- 水票 / 账户 / 券 / 售后 ----
	listTickets: () => request('/tickets', { silent: true }),
	bindTicket: code => request('/tickets/bind', { method: 'POST', data: { code } }),
	getAccount: () => request('/account', { silent: true }),
	listAccountTransactions: () => request('/account/transactions', { silent: true }),
	listCoupons: () => request('/coupons', { silent: true }),
	claimCoupon: id => request(`/coupons/${encodeURIComponent(id)}/claim`, { method: 'POST', silent: true }),
	listAftersales: () => request('/aftersales', { silent: true }),
	createAftersale: data => request('/aftersales', { method: 'POST', data }),
}

export { API_BASE_URL }
