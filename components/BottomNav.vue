<template>
	<view class="bottom-nav">
		<view v-for="item in items" :key="item.id" class="nav-item" :class="{ active: active === item.id }" @click="$emit('change', item.id)">
			<view class="bottom-icon"><AppIcon :name="item.icon" size="38rpx" :tone="active === item.id ? 'brand' : 'muted'" /></view>
			<text class="nav-label">{{ item.label }}</text><text v-if="item.badge" class="bottom-badge">{{ item.badge }}</text>
		</view>
	</view>
</template>

<script>
import AppIcon from './AppIcon.vue'
export default {
	name: 'BottomNav', components: { AppIcon },
	props: { active: { type: String, default: 'home' }, variant: { type: String, default: 'user' }, badge: { type: [Number,String], default: 0 } },
	computed: {
		items() {
			if (this.variant === 'delivery') return [
				{ id: 'workbench', label: '工作台', icon: 'home' }, { id: 'orders', label: '订单', icon: 'order', badge: this.badge || '' }, { id: 'messages', label: '消息', icon: 'message' }, { id: 'mine', label: '我的', icon: 'user' }
			]
			return [
				{ id: 'home', label: '首页', icon: 'home' }, { id: 'category', label: '分类', icon: 'grid' }, { id: 'cart', label: '购物车', icon: 'cart', badge: this.badge || '' }, { id: 'profile', label: '我的', icon: 'user' }
			]
		}
	}
}
</script>

<style scoped>
.bottom-nav { position: fixed; z-index: 40; left: 0; right: 0; bottom: 0; height: calc(112rpx + env(safe-area-inset-bottom)); padding: 10rpx 20rpx env(safe-area-inset-bottom); display: grid; grid-template-columns: repeat(4,1fr); border-top: 1rpx solid #dce6e2; background: rgba(251,252,250,.98); box-shadow: 0 -10rpx 28rpx rgba(24,61,51,.055); }
.nav-item { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6rpx; color: #7d8c87; }
.nav-item.active { color: #0b5949; font-weight: 650; }
.bottom-icon { width: 44rpx; height: 40rpx; display: grid; place-items: center; }
.nav-label { font-size: 20rpx; line-height: 1; letter-spacing: .2rpx; }
.bottom-badge { position: absolute; top: 1rpx; right: 25%; min-width: 28rpx; height: 28rpx; padding: 0 7rpx; display: grid; place-items: center; border: 2rpx solid #fff; border-radius: 16rpx; color: #fff; background: #d6574b; font-size: 15rpx; }
</style>
