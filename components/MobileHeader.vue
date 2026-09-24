<template>
	<view class="mobile-header" :class="{ dark: dark, transparent: transparent }" :style="{ paddingTop: layout.statusHeight + 'px' }">
		<view class="nav-bar" :style="{ height: layout.navHeight + 'px', paddingLeft: layout.sideWidth + 'px', paddingRight: layout.sideWidth + 'px' }">
			<button v-if="back" class="nav-back" aria-label="返回" @click="$emit('back')"><view class="back-chevron" /></button>
			<text class="nav-title">{{ title }}</text>
		</view>
	</view>
</template>

<script>
import { navigationMetrics } from '../services/navigation.js'

export default {
	name: 'MobileHeader',
	emits: ['back', 'layout'],
	data() { return { layout: navigationMetrics() } },
	props: {
		title: { type: String, default: '' },
		back: { type: Boolean, default: true },
		dark: { type: Boolean, default: false },
		transparent: { type: Boolean, default: false }
	},
	watch: { dark() { this.refresh() }, title() { this.refresh() }, back() { this.refresh() } },
	mounted() {
		this.refresh()
		if (typeof uni.onWindowResize === 'function') uni.onWindowResize(this.refresh)
	},
	beforeUnmount() {
		if (typeof uni.offWindowResize === 'function') uni.offWindowResize(this.refresh)
	},
	methods: {
		refresh() {
			let info = {}, capsule = null, native = false
			// #ifdef MP-WEIXIN
			native = true
			try { info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync() } catch { /* use safe device defaults */ }
			try { capsule = uni.getMenuButtonBoundingClientRect() } catch { /* older base libraries may omit capsule geometry */ }
			// #endif
			this.layout = navigationMetrics(info, capsule, native)
			if (!native && !this.title && !this.back) this.layout = { ...this.layout, navHeight: 0, headerHeight: 0 }
			this.$emit('layout', this.layout.headerHeight)
			if (typeof uni.setNavigationBarColor === 'function') uni.setNavigationBarColor({ frontColor: this.dark ? '#ffffff' : '#000000', backgroundColor: this.dark ? '#173d35' : '#f3f6f3' })
		}
	}
}
</script>

<style scoped>
.mobile-header { position: relative; z-index: 20; flex-shrink: 0; width: 100%; color: #172f29; background: #fbfcfa; }
.mobile-header.transparent { background: transparent; }
.mobile-header.dark { color: #fff; background: #173d35; }
.mobile-header.dark.transparent { background: transparent; }
.nav-bar { position: relative; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.nav-title { display: block; width: 100%; overflow: hidden; font-size: 16px; font-weight: 600; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.nav-back { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin: 0; padding: 0; border: 0; border-radius: 10px; color: inherit; background: transparent; }
.nav-back::after { border: 0; }
.nav-back:active { transform: translateY(-50%); background: rgba(104,170,155,.12); }
.back-chevron { width: 11px; height: 11px; margin-left: 5px; border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); }
</style>
