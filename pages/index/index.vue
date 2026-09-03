<template>
	<view class="shop-page" :class="'screen-' + screen">
		<template v-if="screen === 'home'">
			<MobileHeader :back="false" title="" transparent />
			<view class="home-top">
				<view class="location-row" @click="openAddress"><AppIcon name="pin" size="26rpx"/><text class="location-name">{{ shortAddress }}</text><text class="location-arrow">⌄</text></view>
				<view class="search-bar" @click="go('search')"><AppIcon name="search" size="28rpx" tone="muted"/><text class="placeholder">搜索商品</text><button>搜索</button></view>
			</view>
			<scroll-view scroll-y class="page-scroll with-nav">
				<view class="hero-banner">
					<view class="banner-copy"><text class="banner-title">源自山泉</text><text class="banner-title">的自然纯净</text><text class="banner-sub">天然好水 · 清润安心</text><button @click="go('category')">立即订水 →</button></view>
					<WaterJug size="medium" />
					<view class="banner-dots"><text class="ui-i"></text><text class="ui-i active"></text><text class="ui-i"></text></view>
				</view>
				<view class="quick-actions card">
					<view v-for="action in quickActions" :key="action.label" @click="go(action.target)"><view class="quick-icon" :class="action.tone"><AppIcon :name="action.icon" size="31rpx" :tone="action.tone==='gold'?'warm':'brand'"/></view><text>{{ action.label }}</text></view>
				</view>
				<view class="section-title"><text>热销推荐</text><text class="more" @click="go('category')">更多 ›</text></view>
				<view class="product-grid">
					<view class="product-card" v-for="product in products.slice(0, 2)" :key="product.name" @click="selectProduct(product)">
						<view class="product-image"><WaterJug /></view><text class="grid-name">{{ product.name }}</text><text class="grid-spec">{{ product.spec }}</text><view class="grid-price"><text>¥{{ product.price }}</text><button @click.stop="addCart(product)">＋</button></view>
					</view>
				</view>
				<view class="delivery-banner"><view><text>当日订水 当日送达</text><text class="ui-small">专业配送 · 贴心到家</text></view><view class="delivery-truck"><AppIcon name="truck" size="78rpx"/></view></view>
				<view class="section-title"><text>为你推荐</text><text class="more" @click="rotateRecommend">换一批 ↻</text></view>
				<view class="recommend-list card"><ProductRow v-for="product in recommendProducts" :key="product.sku" v-bind="product" @select="selectProduct(product)" @add="addCart(product)" /></view>
			</scroll-view>
			<BottomNav active="home" :badge="cartCount" @change="handleBottom" />
		</template>

		<template v-else-if="screen === 'category'">
			<MobileHeader title="商品分类" :back="false" />
			<view class="category-layout with-nav-height">
				<scroll-view scroll-y class="category-side"><view v-for="(category,index) in categories" :key="category" :class="{ active: categoryIndex === index }" @click="categoryIndex = index"><text>{{ category }}</text></view></scroll-view>
				<scroll-view scroll-y class="category-products"><view class="category-heading"><text>{{ categories[categoryIndex] }}</text><text class="ui-small">共 {{ categoryProducts.length }} 件商品</text></view><view class="category-card"><ProductRow v-for="product in categoryProducts" :key="product.sku" v-bind="product" @select="selectProduct(product)" @add="addCart(product)" /></view><view class="shipping-tip"><AppIcon name="truck" size="30rpx"/><view><text>满60元免配送费</text><text class="ui-small">未满60元，配送费5元</text></view></view></scroll-view>
			</view>
			<BottomNav active="category" :badge="cartCount" @change="handleBottom" />
		</template>

		<template v-else-if="screen === 'detail'">
			<MobileHeader title="商品详情" @back="go('category')" />
			<scroll-view scroll-y class="page-scroll detail-scroll">
				<view class="detail-hero"><view class="mountain-mist"></view><WaterJug size="large" /><view class="image-count">1/5</view></view>
				<view class="detail-info card-flat"><text class="detail-price">¥{{ detailProduct.price }}</text><text class="detail-name">{{ detailProduct.name }} {{ detailProduct.spec }}</text><text class="detail-subtitle">{{ detailProduct.note }} · 品质配送</text></view>
				<view class="detail-options card-flat"><view><text>配送范围</text><text>{{ stations.length ? `${stations.map(s=>s.name).join('、')} 配送` : '按水站配送区域配送' }} ›</text></view><view @click="skuOpen = !skuOpen"><text>规格</text><text>{{ detailProduct.spec }} · 库存 {{ detailProduct.stock }} ›</text></view><view><text>存储建议</text><text>常温避光保存 ›</text></view></view>
				<view v-if="skuOpen" class="sku-panel"><text>选择规格</text><view><button v-for="product in sameCategoryProducts" :key="product.sku" :class="{active:product.sku===detailProduct.sku}" @click="selectedProduct=product">{{ product.spec }}</button></view></view>
				<view class="quality-row card-flat"><view><AppIcon name="pin" size="34rpx"/><text class="ui-small">天然水源</text></view><view><AppIcon name="shield" size="34rpx"/><text class="ui-small">严格质检</text></view><view><AppIcon name="truck" size="34rpx"/><text class="ui-small">准时送达</text></view></view>
				<view class="section-title inner"><text>为你推荐</text></view><scroll-view scroll-x class="mini-products"><view class="mini-product" v-for="product in products.slice(1,4)" :key="product.name"><WaterJug size="small"/><text>{{ product.name }}</text><text class="ui-small">{{ product.spec }}</text><text class="ui-bold">¥{{ product.price }}</text></view></scroll-view>
				<view class="detail-description"><text>水源说明</text><text class="ui-paragraph">取自天然山泉水源，经多重过滤和严格质量检测，口感清润，适合家庭日常饮用。</text></view>
			</scroll-view>
			<view class="detail-actions"><view class="action-mini" @click="go('cart')"><AppIcon name="cart" size="34rpx"/><text class="ui-small">购物车</text><text class="ui-i">{{ cartCount }}</text></view><view class="action-mini" @click="callStation"><AppIcon name="phone" size="34rpx"/><text class="ui-small">联系水站</text></view><button class="outline-button" @click="addCart(detailProduct)">加入购物车</button><button class="solid-button" @click="openOrder">立即购买</button></view>
		</template>

		<template v-else-if="screen === 'cart'">
			<MobileHeader title="购物车" :back="false" />
			<scroll-view scroll-y class="page-scroll cart-scroll with-nav">
				<view v-if="cartCount===0" class="empty-state"><AppIcon name="cart" size="72rpx" tone="muted"/><text class="ui-strong">购物车还是空的</text><text class="ui-small">去挑选一桶好水吧</text></view>
				<view class="station-cart" v-for="(station,stationIndex) in cartStations" :key="station.name"><view class="station-head"><text class="check" :class="{ active: station.checked }" @click="toggleStation(stationIndex)">✓</text><text>山泉到家 · {{ station.name }}</text><text class="ui-small">{{ station.delivery }}</text></view><view class="cart-item" v-for="(item,index) in station.items" :key="item.name"><text class="check" :class="{active:item.checked}" @click="toggleItem(stationIndex,index)">✓</text><WaterJug size="small"/><view><text class="ui-strong">{{ item.name }}</text><text class="ui-small">{{ item.spec }}</text><text class="ui-bold">¥{{ item.price }}</text><text class="remove-item" @click="removeCartItem(stationIndex,index)">删除</text></view><view class="stepper"><button @click="changeQty(stationIndex,index,-1)">－</button><text>{{ item.qty }}</text><button @click="changeQty(stationIndex,index,1)">＋</button></view></view></view>
				<view class="section-title inner"><text>为你推荐</text></view><scroll-view scroll-x class="mini-products cart-recommend"><view class="mini-product" v-for="product in products.slice(1,4)" :key="product.name"><WaterJug size="small"/><text>{{ product.name }}</text><text class="ui-small">{{ product.spec }}</text><text class="ui-bold">¥{{ product.price }}</text></view></scroll-view>
			</scroll-view>
			<view class="cart-settle"><text class="check" :class="{active:allCartSelected}" @click="toggleAllCart">✓</text><text>全选</text><view><text class="ui-small">合计：</text><text class="ui-strong">¥{{ cartTotal }}</text><text>以结算页优惠为准</text></view><button :disabled="selectedCartCount===0" @click="openOrder">去结算({{ selectedCartCount }})</button></view>
			<BottomNav active="cart" :badge="cartCount" @change="handleBottom" />
		</template>

		<template v-else-if="screen === 'search'">
			<MobileHeader title="" @back="go('home')" />
			<view class="search-page-bar"><view><AppIcon name="search" size="27rpx" tone="muted"/><input v-model="keyword" placeholder="搜索商品" confirm-type="search" @confirm="doSearch"/><text v-if="keyword" @click="keyword=''">×</text></view><button @click="doSearch">搜索</button></view>
			<scroll-view scroll-y class="page-scroll search-scroll">
				<view class="recent-search"><view class="section-title"><text>最近搜索</text><text class="more" @click="recent=[]">♲</text></view><view class="chips"><text v-for="item in recent" :key="item" @click="keyword=item;doSearch()">{{ item }}</text></view></view>
				<view class="section-title"><text>{{ searchDone ? '搜索结果' : '热门推荐' }}</text><text class="more">{{ filteredProducts.length }} 件商品</text></view>
				<view class="search-results card"><ProductRow v-for="product in filteredProducts" :key="product.name" v-bind="product" @select="selectProduct(product)" @add="addCart(product)" /></view>
				<view v-if="!filteredProducts.length" class="empty-state"><AppIcon name="search" size="72rpx" tone="muted"/><text class="ui-strong">没有找到相关商品</text><text class="ui-small">换个关键词试试</text></view>
			</scroll-view>
		</template>

		<template v-else>
			<view class="profile-hero"><MobileHeader title="" :back="false" dark transparent/><view class="profile-user"><view class="profile-avatar">{{String(account.name||'用').slice(0,1)}}</view><view><text>{{account.name||'山泉用户'}}</text><text class="ui-small">{{maskedPhone}}</text></view><text class="profile-arrow">›</text></view><view class="profile-lines"></view></view>
			<scroll-view scroll-y class="profile-content with-nav">
				<view class="member-progress card" @click="openMember('membership')"><view><text>{{ account.level || '清泉银卡' }}</text><text class="ui-small">{{ account.nextLevelGap > 0 ? `再消费 ${Number(account.nextLevelGap).toFixed(2)} 元可升级` : '已是最高等级' }} · 累计消费 ¥{{ Number(account.totalSpent || 0).toFixed(2) }}</text></view><text>查看权益 ›</text><view class="progress"><text class="ui-i" :style="{ width: levelProgress + '%' }"></text></view></view>
				<view class="asset-card card"><view @click="openMember('balance')"><text class="ui-strong">{{Number(account.balance||0).toFixed(2)}}</text><text class="ui-small">余额(元)</text></view><view @click="openMember('tickets')"><text class="ui-strong">{{ticketCount}}</text><text class="ui-small">水票(张)</text></view><view @click="openMember('points')"><text class="ui-strong">{{account.points||0}}</text><text class="ui-small">积分</text></view></view>
				<view class="order-entry card"><view class="section-title"><text>我的订单</text><text class="more" @click="openOrders">查看全部订单 ›</text></view><view class="order-status"><view v-for="status in profileOrders" :key="status.label" @click="openOrders(status.tab)"><AppIcon :name="status.icon" size="34rpx"/><text class="ui-small">{{ status.label }}</text><text class="ui-i" v-if="status.badge">{{ status.badge }}</text></view></view></view>
				<view class="profile-menu card"><view v-for="item in profileMenu" :key="item.label" @click="handleProfileMenu(item)"><AppIcon class="menu-symbol" :name="item.icon" size="29rpx"/><text>{{ item.label }}</text><text class="ui-small" v-if="menuValue(item)">{{ menuValue(item) }}</text><text class="menu-arrow">›</text></view></view>
			</scroll-view>
			<BottomNav active="profile" :badge="cartCount" @change="handleBottom" />
		</template>

		<view v-if="toast" class="mobile-toast">{{ toast }}</view>
	</view>
</template>

<script>
import MobileHeader from '../../components/MobileHeader.vue'
import WaterJug from '../../components/WaterJug.vue'
import ProductRow from '../../components/ProductRow.vue'
import BottomNav from '../../components/BottomNav.vue'
import AppIcon from '../../components/AppIcon.vue'
import { waterApi } from '../../services/waterApi.js'

export default {
	components: { MobileHeader, WaterJug, ProductRow, BottomNav, AppIcon },
	data() {
		return {
			 screen: 'home', categoryIndex: 0, skuOpen: false, selectedProduct: null, keyword: '', searchDone: false, toast: '',
			recent: ['18.9L', '550ml', '天然水', '纯净水', '苏打水'],
			categories: ['桶装水', '瓶装水'], categoryRecords: [], stations: [], account: {balance:0,points:0,name:'',phone:'',address:'',stationName:'',level:'',nextLevelGap:0,totalSpent:0}, ticketCount: 0,
			products: [
				{ id:'product-001',sku:'water-18_9l',category:'桶装水',name: '天然饮用水', spec: '18.9L / 桶', note: '天然水源', price: '20.00',stock:0 },
				{ id:'product-002',sku:'mineral-18_9l',category:'桶装水',name: '弱碱性矿泉水', spec: '18.9L / 桶', note: '矿物均衡', price: '22.00',stock:0 },
				{ id:'product-003',sku:'purified-18_9l',category:'桶装水',name: '饮用纯净水', spec: '18.9L / 桶', note: '清冽甘甜', price: '18.00',stock:0 },
				{ id:'product-004',sku:'spring-18_9l',category:'桶装水',name: '山泉水', spec: '18.9L / 桶', note: '山泉水源', price: '19.00',stock:0 },
				{ id:'product-005',sku:'bottled-550-12',category:'瓶装水',name: '饮用天然水', spec: '550ml × 12瓶', note: '便携瓶装', price: '16.00',stock:0 }
			],
			quickActions: [
				{ label: '一键订水', icon: 'cart', target: 'category', tone: 'green' }, { label: '我的水票', icon: 'ticket', target: 'tickets', tone: 'mint' }, { label: '查订单', icon: 'order', target: 'orders', tone: 'jade' }, { label: '积分商城', icon: 'gift', target: 'points', tone: 'gold' }
			],
			cartStations: [],
			orderCounts: {}, aftersaleCount: 0, couponCount: 0, recommendOffset: 0,
			profileMenu: [{ label: '我的水票', icon: 'ticket', target: 'tickets' }, { label: '我的地址', icon: 'pin', target: 'address' }, { label: '积分商城', icon: 'gift', target: 'points' }, { label: '优惠券', icon: 'coupon', target: 'points' }, { label: '客服与帮助', icon: 'help', target: 'support' }, { label: '设置', icon: 'settings', target: 'settings' }]
		}
	},
	computed: {
		detailProduct() { return this.selectedProduct || this.products[0] },
		cartCount() { return this.cartStations.reduce((sum, station) => sum + station.items.reduce((subtotal, item) => subtotal + Number(item.qty || 0), 0), 0) },
		selectedCartCount() { return this.cartStations.reduce((sum, station) => sum + station.items.filter(item => item.checked).reduce((subtotal, item) => subtotal + Number(item.qty || 0), 0), 0) },
		cartTotal() { return this.cartStations.reduce((sum, station) => sum + station.items.filter(item => item.checked).reduce((subtotal, item) => subtotal + Number(item.price) * Number(item.qty || 0), 0), 0).toFixed(2) },
		allCartSelected() { const items = this.cartStations.flatMap(station => station.items); return items.length > 0 && items.every(item => item.checked) },
		filteredProducts() {
			if (!this.searchDone || !this.keyword) return this.products
			return this.products.filter(item => (item.name + item.spec + item.note).includes(this.keyword))
		},
		categoryProducts(){const name=this.categories[this.categoryIndex];return this.products.filter(item=>item.category===name)},
		maskedPhone(){const value=String(this.account.phone||'');return value.length===11?`${value.slice(0,3)}****${value.slice(-4)}`:value},
		shortAddress(){const address=String(this.account.address||'').trim();if(!address)return '设置收货地址';return address.length>10?`${address.slice(0,10)}…`:address},
		recommendProducts(){const pool=this.products.length>2?this.products.slice(2):this.products;if(!pool.length)return [];const offset=this.recommendOffset%pool.length;return [...pool.slice(offset),...pool.slice(0,offset)]},
		sameCategoryProducts(){return this.products.filter(item=>item.category===this.detailProduct.category)},
		levelProgress(){const spent=Number(this.account.totalSpent||0);const gap=Number(this.account.nextLevelGap||0);if(gap<=0)return 100;const target=spent+gap;return target>0?Math.max(6,Math.min(100,Math.round(spent/target*100))):0},
		profileOrders(){const counts=this.orderCounts||{};return [{label:'待支付',icon:'wallet',badge:counts['待付款']||0,tab:'待付款'},{label:'待配送',icon:'order',badge:counts['待配送']||0,tab:'待配送'},{label:'配送中',icon:'truck',badge:counts['配送中']||0,tab:'配送中'},{label:'已完成',icon:'check',badge:0,tab:'已完成'},{label:'售后/退款',icon:'help',badge:this.aftersaleCount||0,tab:'全部'}]}
	},
	onLoad(query) { this.restoreCart(); this.screen = query.screen || 'home'; this.loadCatalog(); this.loadProfile() },
	onShow(){this.loadProfile()},
	methods: {
		go(target) {
			if (['tickets','points','balance','membership'].includes(target)) return this.openMember(target)
			if (target === 'orders') return this.openOrders('全部')
			this.screen = target
			uni.pageScrollTo({ scrollTop: 0, duration: 0 })
		},
		handleBottom(target) { this.go(target) },
		selectProduct(product) { this.selectedProduct = product; this.go('detail') },
		addCart(product = this.detailProduct) { if(!product?.sku)return this.showToast('商品数据同步中');let station=this.cartStations[0];if(!station){station={name:this.stations[0]?.name||'中央站',delivery:'满60免配送',checked:true,items:[]};this.cartStations.push(station)}const found = station.items.find(item => item.sku === product.sku); if (found) { found.qty += 1; found.checked = true } else { station.items.push({ ...product, qty: 1, checked: true }) } station.checked = station.items.every(item => item.checked); this.persistCart(); this.showToast('已加入购物车') },
		changeQty(stationIndex,index,delta) { const item = this.cartStations[stationIndex].items[index]; item.qty = Math.max(1,item.qty + delta); this.persistCart() },
		removeCartItem(stationIndex,index) { this.cartStations[stationIndex].items.splice(index,1); this.syncStationSelection(stationIndex); this.persistCart(); this.showToast('商品已删除') },
		toggleStation(stationIndex) { const station = this.cartStations[stationIndex]; station.checked = !station.checked; station.items.forEach(item => { item.checked = station.checked }); this.persistCart() },
		toggleItem(stationIndex,index) { const item = this.cartStations[stationIndex].items[index]; item.checked = !item.checked; this.syncStationSelection(stationIndex); this.persistCart() },
		toggleAllCart() { const checked = !this.allCartSelected; this.cartStations.forEach(station => { station.checked = checked; station.items.forEach(item => { item.checked = checked }) }); this.persistCart() },
		syncStationSelection(stationIndex) { const station = this.cartStations[stationIndex]; station.checked = station.items.length > 0 && station.items.every(item => item.checked) },
		persistCart() { uni.setStorageSync('mountain-spring-cart', this.cartStations) },
		restoreCart() { const saved = uni.getStorageSync('mountain-spring-cart'); if (Array.isArray(saved) && saved.length && saved.every(station=>Array.isArray(station.items)&&station.items.every(item=>item.sku))) this.cartStations = saved; else uni.removeStorageSync('mountain-spring-cart') },
		async loadCatalog(){try{const [categories,products,stations]=await Promise.all([waterApi.listCatalogCategories(),waterApi.listCatalogProducts(),waterApi.listCatalogStations()]);this.categoryRecords=categories;this.categories=categories.map(item=>item.name);this.products=products.map(item=>({id:item.id,sku:item.skuCode,name:item.name,category:item.categoryName,spec:item.spec,note:item.description,price:Number(item.price).toFixed(2),stock:item.stock}));this.stations=stations}catch(error){this.showToast(error.message)}},
		async loadProfile(){try{const [account,tickets,orders,aftersales,coupons]=await Promise.all([waterApi.getAccount(),waterApi.listTickets(),waterApi.listOrders(),waterApi.listAftersales(),waterApi.listCoupons()]);this.account=account;this.ticketCount=tickets.filter(item=>item.status==='可用').length;const counts={};for(const order of orders)counts[order.status]=(counts[order.status]||0)+1;this.orderCounts=counts;this.aftersaleCount=aftersales.filter(item=>['待审核','已通过'].includes(item.status)).length;this.couponCount=coupons.filter(item=>item.customerCouponId&&item.customerStatus==='未使用').length}catch(error){console.warn('[profile-sync]',error.message)}},
		menuValue(item){if(item.target==='tickets')return this.ticketCount?`${this.ticketCount} 张可用`:'';if(item.target==='address')return this.account.address?'':'未设置';if(item.target==='points')return item.label==='优惠券'&&this.couponCount?`${this.couponCount} 张可用`:'';if(item.target==='support')return this.stations[0]?.phone||'';return ''},
		handleProfileMenu(item) {
			if (item.target === 'address') return this.openAddress()
			if (item.target === 'support') return this.openSupport()
			if (item.target === 'settings') return this.openSettings()
			return this.openMember(item.target)
		},
		openAddress() { uni.navigateTo({ url: '/pages/order/index?screen=address' }) },
		callStation() { const phone = String(this.stations[0]?.phone || '').replace(/\D/g, ''); if (phone.length !== 11) return this.showToast('水站电话同步中'); if (typeof uni.makePhoneCall !== 'function') return this.showToast(`水站电话 ${phone}`); uni.makePhoneCall({ phoneNumber: phone, fail: error => { if (!/cancel/i.test(String(error && error.errMsg))) this.showToast('拨号失败') } }) },
		openSupport() { const station = this.stations[0]; const items = [station ? `拨打 ${station.name} ${station.phone}` : '拨打水站电话', '查看配送说明', '查看退款说明']; uni.showActionSheet({ itemList: items, success: res => { if (res.tapIndex === 0) return this.callStation(); if (res.tapIndex === 1) return uni.showModal({ title: '配送说明', content: '下单后由所属水站派单，送水员接单后可在订单详情查看电话；支持选择配送时段。', showCancel: false }); uni.showModal({ title: '退款说明', content: '待配送的余额支付订单可直接取消退回余额；已送达订单可在订单详情申请售后，后台审核后退款。', showCancel: false }) } }) },
		openSettings() { uni.showActionSheet({ itemList: ['清空购物车', '退出登录'], success: res => { if (res.tapIndex === 0) { this.cartStations = []; this.persistCart(); return this.showToast('购物车已清空') } uni.showModal({ title: '退出登录', content: '退出后需要重新登录才能查看订单与资产', success: result => { if (!result.confirm) return; waterApi.logout('customer'); this.cartStations = []; this.persistCart(); this.account = { balance: 0, points: 0, name: '', phone: '', address: '', stationName: '', level: '', nextLevelGap: 0, totalSpent: 0 }; this.showToast('已退出登录'); setTimeout(() => this.loadProfile(), 800) } }) } }) },
		rotateRecommend() { this.recommendOffset += 1 },
		doSearch() { this.searchDone = true; if (this.keyword && !this.recent.includes(this.keyword)) this.recent.unshift(this.keyword) },
		openOrder() { const items=this.cartStations.flatMap(station=>station.items.filter(item=>item.checked).map(item=>({...item,station:station.name})));if(!items.length){if(this.detailProduct?.sku)items.push({...this.detailProduct,qty:1,station:this.stations[0]?.name||'中央站'});else return this.showToast('请先选择结算商品')}if(items.length>1)return this.showToast('当前请分商品结算');uni.setStorageSync('mountain-spring-checkout',items[0]);uni.navigateTo({ url: '/pages/order/index?screen=confirm' }) },
		openOrders(tab) { uni.navigateTo({ url: `/pages/order/index?screen=orders${typeof tab === 'string' && tab ? `&tab=${encodeURIComponent(tab)}` : ''}` }) },
		openMember(screen) { uni.navigateTo({ url: '/pages/member/index?screen=' + screen }) },
		showToast(message) { this.toast = message; setTimeout(() => { this.toast = '' }, 1600) }
	}
}
</script>

<style scoped>
.shop-page { height: 100vh; height: 100dvh; overflow: hidden; background: #f6f7f3; color: #17352d; }
.page-scroll { height: calc(100vh - 136rpx); height: calc(100dvh - 136rpx); }
.page-scroll.with-nav { height: calc(100vh - 248rpx - env(safe-area-inset-bottom)); height: calc(100dvh - 248rpx - env(safe-area-inset-bottom)); }
.with-nav-height { height: calc(100vh - 248rpx - env(safe-area-inset-bottom)); height: calc(100dvh - 248rpx - env(safe-area-inset-bottom)); }
.home-top { padding: 0 24rpx 12rpx; background: #f6f7f3; }
.location-row { height: 56rpx; display: flex; align-items: center; gap: 8rpx; font-size: 23rpx; }
.location-icon { color: #177a63; font-size: 15rpx; }
.location-name { font-weight: 600; }
.search-bar { height: 66rpx; padding-left: 22rpx; display: grid; grid-template-columns: 32rpx 1fr 104rpx; align-items: center; border: 1rpx solid #d2e0db; border-radius: 34rpx; background: #fff; box-shadow: 0 7rpx 22rpx rgba(43,83,72,.05); }
.search-bar .placeholder { color: #9ba7a3; font-size: 23rpx; }
.search-bar button { align-self: stretch; border-radius: 34rpx; color: #fff; background: #08705a; font-size: 22rpx; }
.hero-banner { position: relative; height: 330rpx; margin: 8rpx 24rpx 16rpx; padding: 45rpx 28rpx; display: flex; align-items: center; justify-content: space-between; overflow: hidden; border-radius: 18rpx; background: linear-gradient(135deg,#eaf4f0 0%,#c7dfd7 52%,#eef5f2 100%); }
.hero-banner::before,.hero-banner::after { content: ""; position: absolute; inset: auto -20% 5% -20%; height: 62%; background: url('/static/mountain-lines.svg') center bottom/cover no-repeat; opacity: .6; }
.hero-banner::after { transform: translateY(28rpx); opacity: .28; }
.banner-copy { position: relative; z-index: 3; width: 58%; }
.banner-title { display: block; color: #07543f; font-size: 38rpx; font-weight: 700; line-height: 1.35; }
.banner-sub { display: block; margin-top: 13rpx; color: #517970; font-size: 21rpx; }
.banner-copy button { margin: 22rpx 0 0; padding: 0; color: #07543f; background: transparent; font-size: 20rpx; text-align: left; }
.hero-banner :deep(.jug-wrap) { z-index: 2; transform: scale(1.1); }
.banner-dots { position: absolute; z-index: 4; left: 0; right: 0; bottom: 14rpx; display: flex; justify-content: center; gap: 7rpx; }
.banner-dots .ui-i { width: 9rpx; height: 9rpx; border-radius: 50%; background: rgba(7,84,63,.28); }
.banner-dots .ui-i.active { width: 22rpx; border-radius: 5rpx; background: #07543f; }
.card { margin: 0 24rpx 16rpx; border: 1rpx solid #e2eae7; border-radius: 17rpx; background: #fff; box-shadow: 0 10rpx 28rpx rgba(38,76,66,.045); }
.quick-actions { height: 138rpx; padding: 15rpx 8rpx; display: grid; grid-template-columns: repeat(4,1fr); }
.quick-actions > view { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9rpx; font-size: 21rpx; }
.quick-icon { width: 64rpx; height: 64rpx; display: grid; place-items: center; border: 1rpx solid rgba(15,114,93,.08); border-radius: 19rpx; }
.quick-icon.green { background: #dcece6; }.quick-icon.mint { background: #e6f0ec; }.quick-icon.jade { background: #dceae5; }.quick-icon.gold { background: #f3eadb; }
.section-title { min-height: 66rpx; padding: 0 27rpx; display: flex; align-items: center; justify-content: space-between; font-size: 27rpx; font-weight: 600; }
.section-title.inner { padding: 0 26rpx; }.more { color: #7c8b86; font-size: 20rpx; font-weight: 400; }
.product-grid { padding: 0 24rpx; display: grid; grid-template-columns: 1fr 1fr; gap: 14rpx; }
.product-card { padding: 15rpx; border: 1rpx solid #e1eae7; border-radius: 15rpx; background: #fff; }
.product-image { height: 190rpx; display: flex; align-items: center; justify-content: center; border-radius: 11rpx; background: linear-gradient(145deg,#f3f8f6,#e8f1ed); }
.product-card text { display: block; }.grid-name { margin-top: 13rpx; font-size: 24rpx; font-weight: 600; }.grid-spec { margin-top: 5rpx; color: #71827c; font-size: 19rpx; }
.grid-price { margin-top: 11rpx; display: flex; align-items: center; justify-content: space-between; }.grid-price text { color: #d85e52; font-size: 24rpx; font-weight: 700; }.grid-price button { width: 38rpx; height: 38rpx; padding: 0; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #08705a; font-size: 24rpx; }
.delivery-banner { height: 126rpx; margin: 20rpx 24rpx 2rpx; padding: 0 28rpx; display: flex; align-items: center; justify-content: space-between; overflow: hidden; border-radius: 15rpx; background: linear-gradient(115deg,#e8f4f0,#c6e1d9); }
.delivery-banner text,.delivery-banner .ui-small { display: block; }.delivery-banner > view > text { color: #07543f; font-size: 26rpx; font-weight: 700; }.delivery-banner .ui-small { margin-top: 7rpx; color: #557a70; font-size: 19rpx; }
.delivery-truck { width: 100rpx; height: 82rpx; display: grid; place-items: center; }
.recommend-list { overflow: hidden; }.recommend-list :deep(.product-row:last-child) { border-bottom: 0; }
.unavailable{opacity:.58;cursor:not-allowed}.remove-item{display:inline-block!important;margin-top:8rpx;color:#a45b50!important;font-size:18rpx!important}.cart-settle button:disabled{opacity:.45}.empty-state{min-height:300rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12rpx;color:#82908b}

.category-layout { display: grid; grid-template-columns: 176rpx 1fr; }
.category-side { height: 100%; background: #eef2f0; }.category-side view { position: relative; height: 105rpx; display: flex; align-items: center; justify-content: center; color: #687a74; font-size: 23rpx; }
.category-side view.active { color: #07543f; background: #fff; font-weight: 700; }.category-side view.active::before { content: ""; position: absolute; left: 0; width: 6rpx; height: 46rpx; border-radius: 0 5rpx 5rpx 0; background: #16765f; }
.category-products { height: 100%; background: #f6f7f3; }.category-heading { height: 72rpx; padding: 0 19rpx; display: flex; align-items: center; justify-content: space-between; }.category-heading text { font-size: 25rpx; font-weight: 600; }.category-heading .ui-small { color: #83918c; font-size: 18rpx; }
.category-card { margin: 0 15rpx; overflow: hidden; border-radius: 15rpx; border: 1rpx solid #e2e9e6; }
.shipping-tip { min-height: 86rpx; margin: 16rpx; padding: 14rpx 18rpx; display: grid; grid-template-columns: 32rpx 1fr; align-items: center; border-radius: 12rpx; color: #136650; background: #e2f0eb; font-size: 21rpx; }.shipping-tip text,.shipping-tip .ui-small { display: block; }.shipping-tip .ui-small { margin-top: 4rpx; color: #71827c; font-size: 17rpx; }

.detail-scroll { height: calc(100vh - 260rpx); }.detail-hero { position: relative; height: 560rpx; display: flex; align-items: center; justify-content: center; overflow: hidden; background: linear-gradient(180deg,#eff7f4,#d6e8e2 58%,#f3f7f5); }
.mountain-mist { position: absolute; inset: 0; background: url('/static/mountain-lines.svg') center top/cover no-repeat; opacity: .5; }.detail-hero :deep(.jug-wrap) { z-index: 2; }.image-count { position: absolute; z-index: 3; right: 25rpx; bottom: 20rpx; padding: 6rpx 12rpx; border-radius: 16rpx; color: #fff; background: rgba(7,54,43,.65); font-size: 18rpx; }
.card-flat { border-bottom: 1rpx solid #e2e9e6; background: #fff; }.detail-info { padding: 25rpx 28rpx; }.detail-info text { display: block; }.detail-price { color: #07543f; font-size: 41rpx; font-weight: 700; }.detail-name { margin-top: 10rpx; font-size: 29rpx; font-weight: 600; }.detail-subtitle { margin-top: 8rpx; color: #71827c; font-size: 20rpx; }
.detail-options { margin-top: 14rpx; padding: 0 26rpx; }.detail-options view { min-height: 78rpx; display: flex; align-items: center; justify-content: space-between; border-bottom: 1rpx solid #edf1ef; }.detail-options view:last-child { border-bottom: 0; }.detail-options text { font-size: 22rpx; }.detail-options text:last-child { color: #71827c; font-size: 20rpx; }
.sku-panel { margin-top: 12rpx; padding: 23rpx 27rpx; background: #fff; }.sku-panel > text { font-size: 24rpx; font-weight: 600; }.sku-panel view { margin-top: 14rpx; display: flex; gap: 12rpx; }.sku-panel button { margin: 0; padding: 0 22rpx; height: 58rpx; border: 1rpx solid #d5e1dd; border-radius: 8rpx; color: #71827c; background: #fff; font-size: 20rpx; }.sku-panel button.active { color: #07543f; border-color: #287d68; background: #e8f2ee; }
.quality-row { margin-top: 14rpx; height: 120rpx; display: grid; grid-template-columns: repeat(3,1fr); }.quality-row view { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8rpx; color: #07543f; }.quality-row .ui-small { color: #4d635c; font-size: 19rpx; }
.mini-products { padding: 0 0 14rpx 24rpx; white-space: nowrap; }.mini-product { width: 210rpx; margin-right: 12rpx; padding: 15rpx; display: inline-flex; vertical-align: top; flex-direction: column; align-items: center; border: 1rpx solid #e0e9e5; border-radius: 14rpx; background: #fff; }
.mini-product text,.mini-product .ui-small,.mini-product .ui-bold { width: 100%; display: block; }.mini-product text { margin-top: 8rpx; overflow: hidden; font-size: 21rpx; font-weight: 600; text-overflow: ellipsis; }.mini-product .ui-small { margin-top: 4rpx; color: #71827c; font-size: 17rpx; }.mini-product .ui-bold { margin-top: 7rpx; color: #d85e52; font-size: 21rpx; }
.detail-description { margin-top: 12rpx; padding: 25rpx 28rpx 130rpx; background: #fff; }.detail-description > text { font-size: 25rpx; font-weight: 600; }.detail-description .ui-paragraph { color: #71827c; font-size: 21rpx; line-height: 1.75; }
.detail-actions { position: fixed; z-index: 40; left: 0; right: 0; bottom: 0; height: calc(112rpx + env(safe-area-inset-bottom)); padding: 12rpx 18rpx env(safe-area-inset-bottom); display: grid; grid-template-columns: 74rpx 74rpx 1fr 1fr; align-items: center; gap: 10rpx; border-top: 1rpx solid #dce5e2; background: #fff; }
.action-mini { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4rpx; }.action-mini .ui-small { font-size: 17rpx; }.action-mini .ui-i { position: absolute; right: 2rpx; top: -5rpx; width: 25rpx; height: 25rpx; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #d6574b; font-size: 14rpx; font-style: normal; }
.outline-button,.solid-button { height: 72rpx; margin: 0; border-radius: 36rpx; font-size: 23rpx; }.outline-button { color: #07543f; border: 1rpx solid #287d68; background: #fff; }.solid-button { color: #fff; background: #07543f; }

.cart-scroll { height: calc(100vh - 352rpx - env(safe-area-inset-bottom)); }.station-cart { margin: 14rpx 20rpx; overflow: hidden; border: 1rpx solid #dfe8e5; border-radius: 16rpx; background: #fff; }
.station-head { height: 78rpx; padding: 0 18rpx; display: flex; align-items: center; gap: 12rpx; border-bottom: 1rpx solid #edf1ef; font-size: 22rpx; font-weight: 600; }.station-head .ui-small { margin-left: auto; color: #71827c; font-size: 17rpx; font-weight: 400; }
.check { width: 32rpx; height: 32rpx; display: grid; place-items: center; border: 2rpx solid #c7d5d0; border-radius: 50%; color: transparent; font-size: 18rpx; }.check.active { color: #fff; border-color: #08705a; background: #08705a; }
.cart-item { min-height: 152rpx; padding: 17rpx; display: grid; grid-template-columns: 34rpx 94rpx 1fr 130rpx; align-items: center; gap: 12rpx; border-bottom: 1rpx solid #edf1ef; }.cart-item:last-child { border-bottom: 0; }.cart-item .ui-strong,.cart-item .ui-small,.cart-item .ui-bold { display: block; }.cart-item .ui-strong { font-size: 22rpx; }.cart-item .ui-small { margin-top: 6rpx; color: #71827c; font-size: 18rpx; }.cart-item .ui-bold { margin-top: 10rpx; color: #d85e52; font-size: 21rpx; }
.stepper { height: 50rpx; display: grid; grid-template-columns: repeat(3,1fr); align-items: center; border: 1rpx solid #d8e2de; border-radius: 7rpx; }.stepper button { height: 48rpx; padding: 0; background: #f6f8f7; font-size: 23rpx; }.stepper text { text-align: center; font-size: 20rpx; }.cart-recommend { padding-bottom: 34rpx; }
.cart-settle { position: fixed; z-index: 41; left: 0; right: 0; bottom: calc(112rpx + env(safe-area-inset-bottom)); height: 102rpx; padding: 12rpx 18rpx; display: grid; grid-template-columns: 34rpx 55rpx 1fr 190rpx; align-items: center; gap: 9rpx; border-top: 1rpx solid #dce5e2; background: #fff; font-size: 19rpx; }.cart-settle > view:nth-child(3) { text-align: right; }.cart-settle .ui-small { font-size: 18rpx; }.cart-settle .ui-strong { color: #07543f; font-size: 28rpx; }.cart-settle > view > text { display: block; color: #d85e52; font-size: 15rpx; }.cart-settle button { height: 72rpx; border-radius: 36rpx; color: #fff; background: #07543f; font-size: 22rpx; }

.search-page-bar { height: 82rpx; padding: 8rpx 22rpx 12rpx; display: grid; grid-template-columns: minmax(0,1fr) 112rpx; gap: 12rpx; background: #fff; }.search-page-bar > view { height: 62rpx; padding: 0 18rpx; display: grid; grid-template-columns: 30rpx 1fr 30rpx; align-items: center; border-radius: 31rpx; background: #f1f4f3; }.search-page-bar input { font-size: 21rpx; }.search-page-bar button { width: 112rpx; height: 62rpx; margin: 0; padding: 0; border-radius: 31rpx; color: #fff; background: #08705a; font-size: 21rpx; }
.search-scroll { height: calc(100vh - 218rpx); }.recent-search { padding-bottom: 22rpx; background: #fff; }.chips { padding: 0 27rpx; display: flex; flex-wrap: wrap; gap: 12rpx; }.chips text { padding: 12rpx 20rpx; border-radius: 26rpx; color: #52655f; background: #f0f3f2; font-size: 19rpx; }.search-results { overflow: hidden; }
.empty-state { padding: 140rpx 0; display: flex; flex-direction: column; align-items: center; color: #82908b; }.empty-state > text { font-size: 72rpx; opacity: .5; }.empty-state .ui-strong { margin-top: 22rpx; font-size: 24rpx; }.empty-state .ui-small { margin-top: 8rpx; font-size: 19rpx; }

.profile-hero { position: relative; height: 330rpx; overflow: hidden; color: #fff; background: linear-gradient(145deg,#0b6f5b,#064536); }.profile-lines { position: absolute; inset: 45rpx -10% 0; background: url('/static/mountain-lines.svg') center/cover no-repeat; filter: brightness(3); opacity: .18; }
.profile-user { position: relative; z-index: 3; padding: 32rpx 30rpx; display: grid; grid-template-columns: 96rpx 1fr 30rpx; align-items: center; gap: 18rpx; }.profile-avatar { width: 90rpx; height: 90rpx; display: grid; place-items: center; border: 4rpx solid rgba(255,255,255,.72); border-radius: 50%; color: #07543f; background: linear-gradient(145deg,#e5efeb,#a9c9bf); font-size: 32rpx; font-weight: 700; }
.profile-user text,.profile-user .ui-small { display: block; }.profile-user view > text { font-size: 29rpx; font-weight: 600; }.profile-user .ui-small { margin-top: 8rpx; color: rgba(255,255,255,.75); font-size: 20rpx; }.profile-arrow { font-size: 44rpx; }
.profile-content { height: calc(100vh - 442rpx - env(safe-area-inset-bottom)); margin-top: -70rpx; position: relative; z-index: 5; }.member-progress { position: relative; min-height: 118rpx; padding: 20rpx 22rpx; display: flex; align-items: flex-start; justify-content: space-between; }.member-progress text,.member-progress .ui-small { display: block; }.member-progress > view > text { font-size: 23rpx; font-weight: 600; }.member-progress .ui-small { margin-top: 8rpx; color: #71827c; font-size: 18rpx; }.member-progress > text { color: #64766f; font-size: 18rpx; }
.progress { position: absolute; left: 22rpx; right: 22rpx; bottom: 16rpx; height: 7rpx; overflow: hidden; border-radius: 4rpx; background: #e1e9e6; }.progress .ui-i { display: block; width: 58%; height: 100%; background: linear-gradient(90deg,#07543f,#79ae9f); }
.asset-card { height: 130rpx; padding: 17rpx 0; display: grid; grid-template-columns: repeat(3,1fr); }.asset-card view { display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 1rpx solid #e2e9e6; }.asset-card view:last-child { border-right: 0; }.asset-card .ui-strong { color: #17352d; font-size: 31rpx; }.asset-card .ui-small { margin-top: 7rpx; color: #71827c; font-size: 18rpx; }
.order-entry { padding-bottom: 18rpx; }.order-entry .section-title { padding: 0 19rpx; }.order-status { display: grid; grid-template-columns: repeat(5,1fr); }.order-status view { position: relative; display: flex; flex-direction: column; align-items: center; gap: 10rpx; }.order-status .ui-small { font-size: 17rpx; }.order-status .ui-i { position: absolute; top: -8rpx; right: 18%; width: 25rpx; height: 25rpx; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #d6574b; font-size: 14rpx; font-style: normal; }
.profile-menu { overflow: hidden; }.profile-menu view { height: 88rpx; padding: 0 22rpx; display: grid; grid-template-columns: 42rpx 1fr auto 20rpx; align-items: center; gap: 10rpx; border-bottom: 1rpx solid #e7eeeb; font-size: 22rpx; }.profile-menu view:last-child { border-bottom: 0; }.profile-menu .ui-small { color: #71827c; font-size: 18rpx; }.menu-symbol { justify-self:center; }.menu-arrow{color:#9aa7a2;font-size:31rpx;}
.mobile-toast { position: fixed; z-index: 90; left: 50%; bottom: 180rpx; transform: translateX(-50%); padding: 17rpx 26rpx; border-radius: 10rpx; color: #fff; background: rgba(4,63,49,.92); font-size: 21rpx; box-shadow: 0 12rpx 28rpx rgba(7,64,50,.22); }
</style>
