const API_BASE_URL = (import.meta.env.VITE_WATER_API_URL || 'http://127.0.0.1:18090/api').replace(/\/$/, '')
const loginRequests = new Map()

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

function writeSession(role, session) {
	uni.setStorageSync(storageKey(role), session)
	return session
}

function clearSession(role) {
	try { uni.removeStorageSync(storageKey(role)) } catch (error) { console.warn('[session-clear]', error) }
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
			timeout: 8000,
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

async function login(role, credentials = {}, force = false) {
	if (!force) {
		const cached = readSession(role)
		if (cached) return cached
	}
	if (loginRequests.has(role)) return loginRequests.get(role)
	const promise = rawRequest('/auth/demo-login', { method: 'POST', data: { role, ...credentials }, silent: true })
		.then(session => writeSession(role, session))
		.finally(() => loginRequests.delete(role))
	loginRequests.set(role, promise)
	return promise
}

/**
 * @param {string} path
 * @param {{ method?: UniApp.RequestOptions['method'], data?: any, role?: string, silent?: boolean, retry?: boolean }} options
 */
async function request(path, { method = 'GET', data, role = 'customer', silent = false, retry = true } = {}) {
	const session = await login(role)
	try {
		return await rawRequest(path, { method, data, token: session.token, silent })
	} catch (error) {
		if (retry && /** @type {Error & { statusCode?: number }} */ (error).statusCode === 401) {
			clearSession(role)
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
	baseUrl: API_BASE_URL,
	/** 把接口返回的相对图片地址补成完整地址 */
	fileUrl: path => (!path ? '' : /^https?:/.test(path) ? path : `${API_BASE_URL.replace(/\/api$/, '')}${path}`),
	health: () => rawRequest('/health', { silent: true }),
	updateAccount: data => request('/account', { method: 'PUT', data }),
	exchangePoints: couponId => request('/points/exchange', { method: 'POST', data: { couponId } }),
	/** 上传本地图片，返回 { url } */
	uploadImage: async (filePath, role = 'customer') => {
		const data = await readFileAsBase64(filePath)
		if (data.length > 2 * 1024 * 1024 * 1.4) throw new Error('图片不能超过 2MB')
		return request('/uploads', { method: 'POST', data: { data }, role })
	},
	courierRedeemTicket: data => request('/courier/ticket-redemptions', { method: 'POST', data, role: 'courier' }),
	listCatalogProducts: categoryId => rawRequest(`/catalog/products${categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ''}`, { silent: true }),
	listCatalogCategories: () => rawRequest('/catalog/categories', { silent: true }),
	listCatalogStations: () => rawRequest('/catalog/stations', { silent: true }),
	login,
	getProfile: role => readSession(role)?.profile || null,
	logout: role => clearSession(role),
	listOrders: params => request(`/orders${queryString(params)}`, { silent: true }),
	listCourierOrders: params => request(`/orders${queryString(params)}`, { role: 'courier', silent: true }),
	getOrder: id => request(`/orders/${encodeURIComponent(id)}`, { silent: true }),
	createOrder: data => request('/orders', { method: 'POST', data }),
	payOrder: (id, data) => request(`/orders/${encodeURIComponent(id)}/pay`, { method: 'POST', data }),
	cancelOrder: (id, data = {}) => request(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', data }),
	acceptOrder: id => request(`/orders/${encodeURIComponent(id)}/accept`, { method: 'POST', role: 'courier' }),
	completeOrder: (id, data) => request(`/orders/${encodeURIComponent(id)}/complete`, { method: 'POST', data, role: 'courier' }),
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
