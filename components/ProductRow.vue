<template>
	<view class="product-row" @click="$emit('select')">
		<view class="product-visual"><WaterJug size="small" :label="name" :spec="spec" :src="imageUrl" /></view>
		<view class="product-copy"><text class="product-name">{{ name }}</text><text class="product-spec">{{ spec }}</text><text class="product-note" v-if="note">{{ note }}</text><text class="product-price">¥{{ price }}</text></view>
		<button class="add-button" @click.stop="$emit('add')">＋</button>
	</view>
</template>

<script>
import WaterJug from './WaterJug.vue'
export default {
	name: 'ProductRow', components: { WaterJug },
	props: { name: String, spec: String, note: String, price: [String,Number], imageUrl: String },
	computed: { shortLabel() { return (this.name || '山泉').slice(0, 2) } }
}
</script>

<style scoped>
.product-row { min-height: 176rpx; padding: 18rpx 16rpx; display: grid; grid-template-columns: 116rpx minmax(0,1fr) 48rpx; align-items: center; gap: 14rpx; border: 1rpx solid #edf1ef; border-radius: 18rpx; background: #fff; }
.product-visual { width: 116rpx; height: 140rpx; display: flex; align-items: center; justify-content: center; border-radius: 12rpx; background: #f4f7f6; }
.product-copy { min-width: 0; }
.product-copy text { display: block; }
.product-name { color: #253a33; font-size: 25rpx; font-weight: 500; line-height: 1.5; }
.product-spec,.product-note { margin-top: 4rpx; color: #7b8782; font-size: max(12px,21rpx); line-height: 1.45; }
.product-note { display: none!important; }
.product-price { margin-top: 14rpx; color: #e45138; font-size: 26rpx; font-weight: 600; font-variant-numeric: tabular-nums; }
.add-button { align-self: end; width: 48rpx; height: 56rpx; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 50%; color: #fff; background: radial-gradient(circle at center,#087062 0 17rpx,transparent 18rpx); font-size: 29rpx; line-height: 1; }
.add-button::after { border: 0; }
</style>
