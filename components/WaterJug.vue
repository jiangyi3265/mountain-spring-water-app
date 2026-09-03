<template>
	<view class="jug-wrap" :class="size">
		<view class="jug-cap"></view>
		<view class="jug-neck"></view>
		<view class="jug-body">
			<view class="jug-rib rib-one"></view><view class="jug-rib rib-two"></view><view class="jug-rib rib-three"></view>
			<view class="jug-label"><text class="drop">◉</text><text>{{ label }}</text></view>
			<view class="jug-shine"></view>
		</view>
		<view class="jug-base"></view>
	</view>
</template>

<script>
export default {
	name: 'WaterJug',
	props: {
		size: { type: String, default: 'medium' },
		label: { type: String, default: '山泉' }
	}
}
</script>

<style scoped>
.jug-wrap { position: relative; width: 128rpx; height: 176rpx; flex: 0 0 auto; filter: drop-shadow(0 13rpx 14rpx rgba(39,89,100,.16)); }
.jug-wrap.small { width: 82rpx; height: 112rpx; }.jug-wrap.large { width: 290rpx; height: 390rpx; }
.jug-cap { position: absolute; z-index: 4; top: 0; left: 39%; width: 22%; height: 8%; border-radius: 5rpx 5rpx 2rpx 2rpx; background: linear-gradient(90deg,#07543f,#3f9b89,#07543f); }
.jug-neck { position: absolute; z-index: 3; top: 6%; left: 34%; width: 32%; height: 15%; border: 2rpx solid rgba(52,131,150,.35); border-radius: 8rpx 8rpx 3rpx 3rpx; background: linear-gradient(90deg,rgba(221,247,251,.75),rgba(117,188,204,.38),rgba(238,252,255,.78)); }
.jug-body { position: absolute; inset: 17% 6% 5%; overflow: hidden; border: 2rpx solid rgba(75,146,164,.3); border-radius: 28% 28% 20% 20% / 15% 15% 18% 18%; background: linear-gradient(90deg,rgba(235,251,253,.92),rgba(127,194,210,.45) 30%,rgba(226,248,251,.92) 55%,rgba(102,175,194,.42) 78%,rgba(241,253,255,.9)); box-shadow: inset 10rpx 0 16rpx rgba(255,255,255,.5), inset -8rpx 0 12rpx rgba(36,131,156,.14); }
.jug-rib { position: absolute; left: 5%; right: 5%; height: 4%; border-top: 2rpx solid rgba(44,125,147,.2); border-bottom: 1rpx solid rgba(255,255,255,.8); }.rib-one { top: 12%; }.rib-two { top: 71%; }.rib-three { top: 82%; }
.jug-label { position: absolute; z-index: 2; left: 4%; right: 4%; top: 35%; height: 30%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg,#0d6a58,#208777); border-top: 3rpx solid rgba(255,255,255,.75); border-bottom: 3rpx solid rgba(255,255,255,.75); font-size: 19rpx; font-weight: 700; letter-spacing: 2rpx; }.small .jug-label { font-size: 12rpx; }.large .jug-label { font-size: 34rpx; }
.drop { font-size: .72em; opacity: .9; }
.jug-shine { position: absolute; top: 2%; bottom: 3%; left: 15%; width: 11%; border-radius: 50%; background: linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent); transform: skewX(-8deg); }
.jug-base { position: absolute; z-index: 0; bottom: 0; left: 18%; width: 64%; height: 7%; border-radius: 50%; background: rgba(45,118,137,.26); }
</style>
