<template>
	<view class="pay-options">
		<view v-for="item in items" :key="item.id" class="pay-option" :class="{unavailable:item.disabled}" @click="select(item)">
			<view class="pay-icon" :class="item.id"><AppIcon :name="item.icon" size="28rpx" /></view>
			<view><text class="ui-strong">{{ item.name }}</text><text class="ui-small" v-if="!compact">{{ item.note }}</text></view>
			<text class="pay-radio" :class="{ on: modelValue === item.id }">✓</text>
		</view>
	</view>
</template>

<script>
import AppIcon from './AppIcon.vue'
export default {
	name: 'PayOptions',
	components: { AppIcon },
	props: {
		modelValue: { type: String, default: 'wechat' },
		compact: { type: Boolean, default: false },
		/** 应付金额为 0（水票全额抵扣）时只显示水票支付 */
		ticketOnly: { type: Boolean, default: false },
		/** 服务端配置：是否已接入微信支付 / 是否开发模式模拟支付 */
		wechatPay: { type: Boolean, default: false },
		wechatPayMessage: { type: String, default: '在线支付暂未开通' },
		simulatedPayments: { type: Boolean, default: false },
		/** 非空时禁用微信支付并显示原因（如账号未绑定微信 openid，建单后无法预下单） */
		wechatBlockedMessage: { type: String, default: '' },
		balance: { type: Number, default: 0 },
		payable: { type: Number, default: 0 }
	},
	emits: ['update:modelValue'],
	computed: {
		items() {
			if (this.ticketOnly) return [{ id: 'ticket', icon: 'ticket', name: '水票支付', note: '已用水票全额抵扣，无需付款', disabled: false }]
			const wechatDisabled = Boolean(this.wechatBlockedMessage) || (!this.wechatPay && !this.simulatedPayments)
			const balanceDisabled = this.balance < this.payable
			return [
				{ id: 'wechat', icon: 'wallet', name: '微信支付', note: this.wechatBlockedMessage || (this.wechatPay ? '微信安全支付' : this.simulatedPayments ? '本地联调模拟支付' : this.wechatPayMessage), disabled: wechatDisabled },
				{ id: 'balance', icon: 'wallet', name: '余额支付', note: balanceDisabled ? `余额 ¥${this.balance.toFixed(2)} 不足` : `余额 ¥${this.balance.toFixed(2)}`, disabled: balanceDisabled },
				{ id: 'cod', icon: 'order', name: '货到付款', note: '送水员送达时现金或当面扫码收款', disabled: false }
			]
		}
	},
	methods:{select(item){if(!item.disabled)this.$emit('update:modelValue',item.id)}}
}
</script>

<style scoped>
.pay-options { display: flex; flex-direction: column; gap: 10rpx; }
.pay-option { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 6rpx; border-bottom: 1rpx solid #edf1ef; }
.pay-option:last-child { border-bottom: 0; }
.pay-option > view:nth-child(2) { flex: 1; display: flex; flex-direction: column; gap: 4rpx; }
.pay-icon { width: 56rpx; height: 56rpx; display: grid; place-items: center; border-radius: 14rpx; background: #e8f3ee; }
.pay-radio { width: 36rpx; height: 36rpx; display: grid; place-items: center; border: 2rpx solid #c9d6d1; border-radius: 50%; color: transparent; font-size:max(12px, 22rpx); }
.pay-radio.on { color: #fff; border-color: #0b5949; background: #0b5949; }
.unavailable { opacity: .5; }
</style>
