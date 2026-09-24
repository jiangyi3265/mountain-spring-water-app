<template>
	<image class="app-icon" :class="tone" :style="iconStyle" :src="iconSource" mode="aspectFit" />
</template>

<script>
import bell from '../static/icons/bell.svg?raw'
import bottle from '../static/icons/bottle.svg?raw'
import camera from '../static/icons/camera.svg?raw'
import cart from '../static/icons/cart.svg?raw'
import check from '../static/icons/check.svg?raw'
import clock from '../static/icons/clock.svg?raw'
import coupon from '../static/icons/coupon.svg?raw'
import cup from '../static/icons/cup.svg?raw'
import gift from '../static/icons/gift.svg?raw'
import grid from '../static/icons/grid.svg?raw'
import heart from '../static/icons/heart.svg?raw'
import help from '../static/icons/help.svg?raw'
import home from '../static/icons/home.svg?raw'
import lamp from '../static/icons/lamp.svg?raw'
import lock from '../static/icons/lock.svg?raw'
import map from '../static/icons/map.svg?raw'
import message from '../static/icons/message.svg?raw'
import order from '../static/icons/order.svg?raw'
import phone from '../static/icons/phone.svg?raw'
import pin from '../static/icons/pin.svg?raw'
import points from '../static/icons/points.svg?raw'
import qr from '../static/icons/qr.svg?raw'
import search from '../static/icons/search.svg?raw'
import settings from '../static/icons/settings.svg?raw'
import shield from '../static/icons/shield.svg?raw'
import ticket from '../static/icons/ticket.svg?raw'
import towel from '../static/icons/towel.svg?raw'
import truck from '../static/icons/truck.svg?raw'
import umbrella from '../static/icons/umbrella.svg?raw'
import user from '../static/icons/user.svg?raw'
import wallet from '../static/icons/wallet.svg?raw'
import eye from '../static/icons/eye.svg?raw'
import eyeOff from '../static/icons/eye-off.svg?raw'
import wechat from '../static/icons/wechat.svg?raw'

const iconSources = { bell, bottle, camera, cart, check, clock, coupon, cup, gift, grid, heart, help, home, lamp, lock, map, message, order, phone, pin, points, qr, search, settings, shield, ticket, towel, truck, umbrella, user, wallet, eye, 'eye-off': eyeOff, wechat }

export default {
	name: 'AppIcon',
	props: {
		name: { type: String, required: true },
		size: { type: [String, Number], default: 24 },
		tone: { type: String, default: 'brand' }
	},
	computed: {
		iconSource() {
			const source = iconSources[this.name] || help
			return `data:image/svg+xml,${encodeURIComponent(source)}`
		},
		iconStyle() {
			const value = typeof this.size === 'number' ? `${this.size}rpx` : this.size
			return { width: value, height: value }
		}
	}
}
</script>

<style scoped>
.app-icon { display: block; flex: 0 0 auto; }
.app-icon.muted { opacity: .52; filter: saturate(.3); }
.app-icon.light { filter: brightness(0) invert(1); }
.app-icon.warm { filter: sepia(1) saturate(.75) hue-rotate(350deg) brightness(.9); }
</style>
