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
	name: 'PayOptions', components: { AppIcon },
	props: { modelValue: { type: String, default: 'wechat' }, compact: { type: Boolean, default: false } },
	emits: ['update:modelValue'],
	data() {
		return { items: [
			{ id: 'wechat', icon: 'message', name: '微信支付', note: '需配置正式微信商户号' },
			{ id: 'balance', icon: 'wallet', name: '余额支付', note: '提交时按真实账户余额校验' },
			{ id: 'ticket', icon: 'ticket', name: '纸质水票支付', note: '核销抵扣规则待配置', disabled: true },
			{ id: 'cod', icon: 'order', name: '货到付款', note: '账务状态流程待配置', disabled: true }
		] }
	},
	methods:{select(item){if(!item.disabled)this.$emit('update:modelValue',item.id)}}
}
</script>

<style scoped>
.pay-option{min-height:94rpx;display:flex;align-items:center;border-bottom:1rpx solid #e8efec}.pay-option:last-child{border-bottom:0}.pay-icon{width:52rpx;height:52rpx;margin-right:18rpx;display:grid;place-items:center;border-radius:15rpx;background:#e5f0ec}.pay-icon.balance{background:#f3eadb}.pay-icon.ticket{background:#e3eeee}.pay-icon.cod{background:#f4eee5}.pay-option>view:nth-child(2){flex:1;display:flex;flex-direction:column;gap:5rpx}.pay-option .ui-strong{font-size:24rpx;font-weight:650}.pay-option .ui-small{color:#7b8984;font-size:19rpx}.pay-radio{width:34rpx;height:34rpx;display:grid;place-items:center;border:2rpx solid #c5d1cd;border-radius:50%;color:transparent;font-size:19rpx}.pay-radio.on{color:#fff;border-color:#0f725d;background:#0f725d}.pay-option.unavailable{opacity:.48}.pay-option.unavailable .pay-radio{display:none}
</style>
