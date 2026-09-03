<template>
	<view class="mobile-header" :class="{ dark: dark, transparent: transparent }">
		<view class="status-bar"><text>9:41</text><text class="status-icons">▮▮▮ ᯤ ▰</text></view>
		<view class="nav-bar">
			<view class="nav-side left" @click="$emit('back')"><text v-if="back">‹</text></view>
			<text class="nav-title">{{ title }}</text>
			<view class="nav-side capsule"><text>•••</text><text class="capsule-line"></text><text>○</text></view>
		</view>
	</view>
</template>

<script>
export default {
	name: 'MobileHeader',
	props: {
		title: { type: String, default: '' },
		back: { type: Boolean, default: true },
		dark: { type: Boolean, default: false },
		transparent: { type: Boolean, default: false }
	}
}
</script>

<style scoped>
.mobile-header { position: relative; z-index: 20; color: #172f29; background: rgba(255,255,255,.97); }
.mobile-header.transparent { background: transparent; }
.mobile-header.dark { color: #fff; background: #173d35; }
.status-bar { height: 54rpx; padding: 14rpx 28rpx 0; display: flex; align-items: center; justify-content: space-between; font-size: 20rpx; font-weight: 600; }
.status-icons { font-size: 17rpx; letter-spacing: 1rpx; }
.nav-bar { height: 82rpx; padding: 0 22rpx; display: grid; grid-template-columns: 112rpx 1fr 112rpx; align-items: center; }
.nav-side.left { font-size: 52rpx; line-height: 1; }
.nav-title { overflow: hidden; font-size: 29rpx; font-weight: 600; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.capsule { height: 48rpx; padding: 0 13rpx; display: flex; align-items: center; justify-content: space-between; border: 1rpx solid rgba(20,52,44,.2); border-radius: 26rpx; font-size: 19rpx; }
.dark .capsule { border-color: rgba(255,255,255,.32); background: rgba(255,255,255,.1); }
.capsule-line { width: 1rpx; height: 24rpx; background: currentColor; opacity: .2; }
</style>
