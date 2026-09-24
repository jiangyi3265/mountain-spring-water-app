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
	try { uni.removeStorageSync(storageKey(role)) } catch (error) { console.warn('[session-clear]', error) }
	try { uni.setStorageSync(`${AUTH_REQUIRED_KEY}_${role}`, '1') } catch (error) { console.warn('[auth-flag]', error) }
}

function saveAuthRequest(role, startRequest) {
  if (logoutRequests.has(role)) return Promise.reject(new Error('退出处理中，请稍后登录'))
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

function authRequired(role) {
	try { return uni.getStorageSync(`${AUTH_REQUIRED_KEY}_${role}`) === '1' } catch { return false }
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
				if (!silent) uni.showToast({ title: error.message, icon: 'none' })
				reject(error)
			},
			fail(cause) {
				const error = new Error('协同服务暂时不可用，请稍后重试')
				error.cause = cause
				if (!silent) uni.showToast({ title: error.message, icon: 'none' })
				reject(error)
			},
		})
	})
}

async function getConfig(force = false) {
	if (configCache && !force) return configCache
	if (!configRequest) {
		configRequest = rawRequest('/config', { silent: true })
			.then(config => { configCache = config; return config })
			.catch(() => ({ demoAuth: false, simulatedPayments: false, wechatLogin: false, wechatPay: false }))
			.finally(() => { configRequest = null })
	}
	return configRequest
}

let loginNavigationPending = false
function showLogin(role) {
  const route = role === 'courier' ? 'pages/delivery/index' : 'pages/index/index'
  const screen = role === 'courier' ? 'login' : 'auth'
  if (loginNavigationPending) return
  loginNavigationPending = true
  uni.reLaunch({ url: `/${route}?screen=${screen}`, complete: () => { loginNavigationPending = false } })
}

/** 首页可原地显示登录表单；其他页面需要切换到对应角色的登录页。 */
const hooks = { onAuthRequired: showLogin }

async function login(role, credentials = {}, force = false) {
  if (logoutRequests.has(role)) throw new Error('退出处理中，请稍后登录')
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

/**
 * @param {string} path
 * @param {{ method?: UniApp.RequestOptions['method'], data?: any, role?: string, silent?: boolean, retry?: boolean }} options
 */
async function request(path, { method = 'GET', data, role = 'customer', silent = false, retry = true } = {}) {
	let session
	try {
		session = await login(role)
	} catch (error) {
		if (/** @type {any} */ (error).code === 'AUTH_REQUIRED') hooks.onAuthRequired(role)
		throw error
	}
	try {
		return await rawRequest(path, { method, data, token: session.token, silent })
	} catch (error) {
		if (retry && /** @type {Error & { statusCode?: number }} */ (error).statusCode === 401) {
			try { uni.removeStorageSync(storageKey(role)) } catch (cause) { console.warn('[session-clear]', cause) }
			return request(path, { method, data, role, silent, retry: false })
		}
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

export const waterApi = {
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
	authRequired,
	login,
	loginWithPassword: (role, phone, password) => login(role, { phone, password }, true),
    register: data => saveAuthRequest('customer', () => rawRequest('/auth/register', { method: 'POST', data, silent: true })),
    wechatLogin: data => saveAuthRequest('customer', () => rawRequest('/auth/wechat', { method: 'POST', data, silent: true })),
	changePassword: (role, oldPassword, newPassword) => request(role === 'courier' ? '/courier/password' : '/account/password', { method: 'PUT', data: { oldPassword, newPassword }, role }),
	getProfile: role => readSession(role)?.profile || null,
    logout,
    clearLocalSession: clearSession,
	// ---- 账户 ----
	updateAccount: data => request('/account', { method: 'PUT', data }),
	exchangePoints: couponId => request('/points/exchange', { method: 'POST', data: { couponId } }),
	getReferral: () => request('/account/referral', { silent: true }),
	listAvailableTickets: sku => request(`/account/tickets/available${queryString({ sku })}`, { silent: true }),
	/** 上传本地图片，返回 { url } */
	uploadImage: async (filePath, role = 'customer') => {
		const data = await readFileAsBase64(filePath)
		if (data.length > 2 * 1024 * 1024 * 1.4) throw new Error('图片不能超过 2MB')
		return request('/uploads', { method: 'POST', data: { data }, role })
	},
	// ---- 在线充值 ----
	listRechargePackages: () => rawRequest('/recharge/packages', { silent: true }),
	createRecharge: data => request('/recharges', { method: 'POST', data }),
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
	listOrders: params => request(`/orders${queryString(params)}`, { silent: true }),
	listCourierOrders: params => request(`/orders${queryString(params)}`, { role: 'courier', silent: true }),
	getOrder: id => request(`/orders/${encodeURIComponent(id)}`, { silent: true }),
	/** 服务端报价：商品金额、水票抵扣、优惠券、配送费与应付金额，与下单同一套计价 */
	previewOrder: data => request('/orders/preview', { method: 'POST', data, silent: true }),
	createOrder: data => request('/orders', { method: 'POST', data }),
	payOrder: (id, data) => request(`/orders/${encodeURIComponent(id)}/pay`, { method: 'POST', data }),
	wechatPrepay: orderId => request('/payments/wechat/prepay', { method: 'POST', data: { orderId } }),
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
	claimCoupon: id => request(`/coupons/${encodeURIComponent(id)}/claim`, { method: 'POST' }),
	listAftersales: () => request('/aftersales', { silent: true }),
	createAftersale: data => request('/aftersales', { method: 'POST', data }),
}

export { API_BASE_URL }
