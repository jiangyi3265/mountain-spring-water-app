<template>
	<view class="qr" :style="{ width: size, height: size }" role="img" :aria-label="`签收二维码 ${value}`">
		<view v-for="(row, r) in matrix" :key="r" class="qr-row">
			<view v-for="(cell, c) in row" :key="c" class="qr-cell" :class="{ on: cell }"></view>
		</view>
	</view>
</template>

<script>
import { encodeQr } from '../services/qr.js'
export default {
	name: 'QrCode',
	props: { value: { type: String, required: true }, size: { type: String, default: '320rpx' } },
	computed: {
		matrix() { try { return encodeQr(this.value) } catch { return [] } }
	}
}
</script>

<style scoped>
.qr { display: flex; flex-direction: column; background: #fff; border-radius: 12rpx; box-sizing: border-box; }
.qr-row { display: flex; flex: 1; }
.qr-cell { flex: 1; background: #fff; }
.qr-cell.on { background: #17342c; }
</style>
