<template>
	<view class="product-row" @click="$emit('select')">
		<view class="product-visual"><WaterJug size="small" :label="shortLabel" /></view>
		<view class="product-copy"><text class="product-name">{{ name }}</text><text class="product-spec">{{ spec }}</text><text class="product-note" v-if="note">{{ note }}</text><text class="product-price">¥{{ price }}</text></view>
		<button class="add-button" @click.stop="$emit('add')">＋</button>
	</view>
</template>

<script>
import WaterJug from './WaterJug.vue'
export default {
	name: 'ProductRow', components: { WaterJug },
	props: { name: String, spec: String, note: String, price: [String,Number] },
	computed: { shortLabel() { return (this.name || '山泉').slice(0, 2) } }
}
</script>

<style scoped>
.product-row { min-height: 154rpx; padding: 17rpx 18rpx; display: grid; grid-template-columns: 104rpx 1fr 48rpx; align-items: center; gap: 16rpx; border-bottom: 1rpx solid #e8eeeb; background: #fff; }
.product-visual { width: 104rpx; height: 118rpx; display: flex; align-items: center; justify-content: center; border-radius: 10rpx; background: linear-gradient(145deg,#f6faf8,#eef5f2); }
.product-copy text { display: block; }.product-name { color: #17352d; font-size: 26rpx; font-weight: 600; }.product-spec,.product-note { margin-top: 6rpx; color: #71827c; font-size: 20rpx; }.product-price { margin-top: 10rpx; color: #d85e52; font-size: 25rpx; font-weight: 700; }
.add-button { width: 42rpx; height: 42rpx; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; background: #08705a; font-size: 28rpx; line-height: 1; }
</style>
