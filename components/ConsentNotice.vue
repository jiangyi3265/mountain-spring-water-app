<template>
  <view class="consent-notice" :class="{ 'for-courier': courier }">
    <view class="consent-row">
      <checkbox-group class="consent-check-group" @change="changeConsent">
        <label class="consent-toggle" aria-label="同意用户服务协议和隐私政策">
          <checkbox value="agree" :checked="checked" :disabled="disabled" color="#0b4f40" />
        </label>
      </checkbox-group>
      <view class="consent-copy">
        <text>我已阅读并同意</text>
        <navigator class="legal-link" url="/pages/legal/index?type=terms">《用户服务协议》</navigator>
        <text>和</text>
        <navigator class="legal-link" url="/pages/legal/index?type=privacy">《隐私政策》</navigator>
      </view>
    </view>
    <text class="consent-purpose">{{ courier ? '手机号用于配送身份验证，任务信息用于接单与送达。' : '微信标识用于登录或创建账号，手机号用于密码登录验证，收货信息用于配送。' }}未同意仍可浏览商品。</text>
  </view>
</template>

<script>
export default {
  name: 'ConsentNotice',
  props: { checked: { type: Boolean, default: false }, disabled: { type: Boolean, default: false }, courier: { type: Boolean, default: false } },
  emits: ['update:checked'],
  methods: {
    changeConsent(event) { if (!this.disabled) this.$emit('update:checked', event.detail.value.includes('agree')) }
  }
}
</script>

<style scoped>
.consent-notice { margin: 18px 0 0; color: #50675c; text-align: left; }
.consent-notice.for-courier { padding: 8px 10px 12px; border-radius: 8px; background: #fbfcf8; }
.consent-row { display: flex; align-items: flex-start; gap: 4px; }
.consent-check-group { flex: 0 0 44px; }
.consent-toggle { display: flex; align-items: center; justify-content: center; width: 44px; min-height: 44px; }
.consent-copy { flex: 1; min-width: 0; font-size: 13px; line-height: 44px; }
.legal-link { display: inline; margin: 0; padding: 12px 0; min-height: 44px; border: 0; border-radius: 3px; color: #0b6653; background: transparent; font-size: 13px; line-height: 20px; text-decoration: underline; text-underline-offset: 3px; white-space: normal; }
.legal-link::after { border: 0; }
.legal-link:focus-visible { outline: 2px solid #0b6653; outline-offset: 2px; }
.consent-purpose { display: block; padding-left: 48px; font-size: 12px; line-height: 1.7; color: #63796e; }
</style>
