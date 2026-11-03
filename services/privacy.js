export const PRIVACY_VERSION = '2026-10-24'
export const CONSENT_MESSAGE = '请先阅读并勾选同意《用户服务协议》和《隐私政策》'

export function openLegalDocument(type) {
  uni.navigateTo({ url: `/pages/legal/index?type=${type === 'terms' ? 'terms' : 'privacy'}` })
}

// Only called after an explicit, initially unchecked choice. No phone, password
// or WeChat identifier is kept in this receipt.
export function rememberConsent(role) {
  const receipt = { version: PRIVACY_VERSION, agreedAt: new Date().toISOString() }
  uni.setStorageSync(`water_privacy_consent_${role}`, receipt)
  return receipt
}

// Older versions did not present these documents. Ask those sessions to log in
// again after reading them, before any authenticated page request is made.
export function clearUnconsentedSessions() {
  for (const role of ['customer', 'courier']) {
    const receipt = uni.getStorageSync(`water_privacy_consent_${role}`)
    if (receipt?.version !== PRIVACY_VERSION) uni.removeStorageSync(`water_session_${role}`)
  }
}
