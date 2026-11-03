<template>
	<view :style="{ '--mobile-header-height': headerHeight + 'px' }" class="shop-page" :class="'screen-' + screen">
		<template v-if="screen === 'home'">
			<MobileHeader ref="mobileHeader" @layout="headerHeight = $event" :back="false" title="" transparent />
			<view class="home-top">
				<view class="location-row" @click="openAddress"><AppIcon name="pin" size="26rpx"/><text class="location-name">{{ shortAddress }}</text><text class="location-arrow">⌄</text></view>
				<view class="search-bar" @click="go('search')"><AppIcon name="search" size="28rpx" tone="muted"/><text class="placeholder">搜索商品</text><button>搜索</button></view>
			</view>
			<scroll-view scroll-y class="page-scroll with-nav">
				<view class="hero-banner"><image class="hero-landscape" src="/static/design/spring-landscape.jpg" mode="aspectFill" aria-hidden="true"/>
					<view class="banner-copy"><text class="banner-title">源自山泉</text><text class="banner-title">的自然纯净</text><text class="banner-sub">天然好水 · 清润安心</text><button @click="go('category')">立即订水 →</button></view>
					<WaterJug size="medium" />
					
				</view>
				<view class="quick-actions card">
					<view v-for="action in quickActions" :key="action.label" @click="go(action.target)"><view class="quick-icon" :class="action.tone"><AppIcon :name="action.icon" size="31rpx" :tone="action.tone==='gold'?'warm':'brand'"/></view><text>{{ action.label }}</text></view>
				</view>
				<view class="featured-card card"><view class="section-title"><text>热销推荐</text><text class="more" @click="go('category')">更多 ›</text></view>
				<view v-if="catalogLoading" class="empty-state catalog-state"><text class="ui-strong">商品加载中…</text></view>
				<view v-else-if="catalogError" class="empty-state catalog-state"><AppIcon name="help" size="64rpx" tone="muted"/><text class="ui-strong">商品暂时无法加载</text><text class="ui-small">{{ catalogError }}</text><button class="retry-button" @click="loadCatalog">重新加载</button></view>
				<view v-else-if="products.length" class="product-grid">
					<view class="product-card" v-for="product in featuredProducts" :key="product.name" @click="selectProduct(product)">
						<view class="product-image"><WaterJug :label="product.name" :spec="product.spec" :src="product.imageUrl" /></view><text class="grid-name">{{ product.name }}</text><text class="grid-spec">{{ product.spec }}</text><view class="grid-price"><text>¥{{ product.price }}</text><button @click.stop="addCart(product)">＋</button></view>
					</view>
				</view>
				<view v-else class="catalog-empty"><AppIcon name="bottle" size="50rpx" tone="muted"/><text>商品正在准备中</text><text class="ui-small">上架后就可以在这里订水</text></view>
				</view>
				<view class="delivery-banner"><view><text>预约时段 送水到家</text><text class="ui-small">{{ deliveryRuleText }}</text></view><view class="delivery-truck"><AppIcon name="truck" size="78rpx"/></view></view>
				<template v-if="products.length"><view class="section-title"><text>为你推荐</text><text class="more" @click="rotateRecommend">换一批 ↻</text></view>
				<view class="recommend-list card"><ProductRow v-for="product in recommendProducts" :key="product.sku" v-bind="product" @select="selectProduct(product)" @add="addCart(product)" /></view></template>
			</scroll-view>
			<BottomNav active="home" :badge="cartCount" @change="handleBottom" />
		</template>

		<template v-else-if="screen === 'category'">
			<MobileHeader ref="mobileHeader" @layout="headerHeight = $event" title="商品分类" :back="false" />
			<view v-if="catalogError && !products.length" class="empty-state with-nav-height"><AppIcon name="help" size="64rpx" tone="muted"/><text class="ui-strong">商品目录未加载</text><text class="ui-small">{{ catalogError }}</text><button class="retry-button" @click="loadCatalog">重新加载</button></view>
			<view v-else class="category-layout with-nav-height">
				<scroll-view scroll-y class="category-side"><view v-for="(category,index) in categories" :key="category" :class="{ active: categoryIndex === index }" @click="categoryIndex = index"><text>{{ category }}</text></view></scroll-view>
				<scroll-view scroll-y class="category-products"><view class="category-heading"><text>{{ categories[categoryIndex] }}</text><text class="ui-small">共 {{ categoryProducts.length }} 件商品</text></view><view class="category-card"><ProductRow v-for="product in categoryProducts" :key="product.sku" v-bind="product" @select="selectProduct(product)" @add="addCart(product)" /></view><view class="shipping-tip"><AppIcon name="truck" size="30rpx"/><view><text>所属水站配送</text><text class="ui-small">{{ deliveryRuleText }}，结算页显示最终金额</text></view></view></scroll-view>
			</view>
			<BottomNav active="category" :badge="cartCount" @change="handleBottom" />
		</template>

		<template v-else-if="screen === 'detail'">
			<MobileHeader ref="mobileHeader" @layout="headerHeight = $event" title="商品详情" @back="go('category')" />
			<template v-if="detailProduct">
			<scroll-view scroll-y class="page-scroll detail-scroll">
				<view class="detail-hero"><image class="detail-landscape" src="/static/design/spring-landscape.jpg" mode="aspectFill" aria-hidden="true"/><WaterJug size="large" :label="detailProduct.name" :spec="detailProduct.spec" :src="detailProduct.imageUrl" /><text v-if="!detailProduct.imageUrl" class="image-count">商品示意图</text></view>
				<view class="detail-info card-flat"><text class="detail-price">¥{{ detailProduct.price }}</text><text class="detail-name">{{ detailProduct.name }} {{ detailProduct.spec }}</text><text class="detail-subtitle">{{ detailProduct.stock > 0 ? `${account.stationName || '水站'}可售 ${detailProduct.stock}` : '当前水站暂时缺货' }} · {{ deliveryRuleText }}</text></view>
				<view class="detail-options card-flat"><view><text>配送范围</text><text>{{ stations.length ? `${stations.map(s=>s.name).join('、')} 配送` : '按水站配送区域配送' }} ›</text></view><view @click="skuOpen = !skuOpen"><text>规格</text><text>{{ detailProduct.spec }} · 库存 {{ detailProduct.stock }} ›</text></view><view><text>存储建议</text><text>常温避光保存 ›</text></view></view>
				<view v-if="skuOpen" class="sku-panel"><text>同类商品</text><view><button v-for="product in sameCategoryProducts" :key="product.sku" :class="{active:product.sku===detailProduct.sku}" @click="selectedProduct=product">{{ product.name }} · {{ product.spec }}</button></view></view>
				<view class="quality-row card-flat"><view><AppIcon name="pin" size="34rpx"/><text class="ui-small">天然水源</text></view><view><AppIcon name="shield" size="34rpx"/><text class="ui-small">严格质检</text></view><view><AppIcon name="truck" size="34rpx"/><text class="ui-small">准时送达</text></view></view>
				<view class="section-title inner"><text>为你推荐</text></view><scroll-view scroll-x class="mini-products"><view class="mini-product" v-for="product in products.slice(1,4)" :key="product.name" @click="selectProduct(product)"><WaterJug size="small" :label="product.name" :spec="product.spec" :src="product.imageUrl"/><text>{{ product.name }}</text><text class="ui-small">{{ product.spec }}</text><text class="ui-bold">¥{{ product.price }}</text></view></scroll-view>
				<view class="detail-description"><text>商品说明</text><text class="ui-paragraph">{{ detailProduct.note || '水站暂未填写商品说明，可联系水站了解水源与规格。' }}</text></view>
			</scroll-view>
			<view class="detail-actions"><view class="action-mini" @click="go('cart')"><AppIcon name="cart" size="34rpx"/><text class="ui-small">购物车</text><text class="ui-i">{{ cartCount }}</text></view><view class="action-mini" @click="callStation"><AppIcon name="phone" size="34rpx"/><text class="ui-small">联系水站</text></view><button class="outline-button" @click="addCart(detailProduct)">加入购物车</button><button class="solid-button" @click="openOrder">立即购买</button></view>
			</template>
			<view v-else class="empty-state detail-empty"><AppIcon name="help" size="72rpx" tone="muted"/><text class="ui-strong">商品信息不可用</text><text class="ui-small">请返回商品分类重新加载</text><button class="retry-button" @click="loadCatalog">重新加载</button></view>
		</template>

		<template v-else-if="screen === 'cart'">
			<MobileHeader ref="mobileHeader" @layout="headerHeight = $event" title="购物车" :back="false" />
			<scroll-view scroll-y class="page-scroll cart-scroll with-nav">
				<view v-if="cartCount===0" class="empty-state"><AppIcon name="cart" size="72rpx" tone="muted"/><text class="ui-strong">购物车还是空的</text><text class="ui-small">去挑选一桶好水吧</text></view>
				<view class="station-cart" v-for="(station,stationIndex) in cartStations" :key="station.name"><view class="station-head"><text class="check" :class="{ active: station.checked }" @click="toggleStation(stationIndex)">✓</text><text>山泉到家 · {{ station.name }}</text><text class="ui-small">所属水站配送</text></view><view class="cart-item" v-for="(item,index) in station.items" :key="item.name"><text class="check" :class="{active:item.checked}" @click="toggleItem(stationIndex,index)">✓</text><WaterJug size="small" :label="item.name" :spec="item.spec" :src="item.imageUrl"/><view><text class="ui-strong">{{ item.name }}</text><text class="ui-small">{{ item.spec }}</text><text class="ui-bold">¥{{ item.price }}</text><text class="remove-item" @click="removeCartItem(stationIndex,index)">删除</text></view><view class="stepper"><button @click="changeQty(stationIndex,index,-1)">－</button><text>{{ item.qty }}</text><button @click="changeQty(stationIndex,index,1)">＋</button></view></view></view>
				<view class="section-title inner"><text>为你推荐</text></view><scroll-view scroll-x class="mini-products cart-recommend"><view class="mini-product" v-for="product in products.slice(1,4)" :key="product.name" @click="selectProduct(product)"><WaterJug size="small" :label="product.name" :spec="product.spec" :src="product.imageUrl"/><text>{{ product.name }}</text><text class="ui-small">{{ product.spec }}</text><text class="ui-bold">¥{{ product.price }}</text></view></scroll-view>
			</scroll-view>
			<view class="cart-settle"><text class="check" :class="{active:allCartSelected}" @click="toggleAllCart">✓</text><text>全选</text><view><text class="ui-small">合计：</text><text class="ui-strong">¥{{ cartTotal }}</text><text>以结算页优惠为准</text></view><button :disabled="selectedCartCount===0" @click="openOrder">去结算({{ selectedCartCount }})</button></view>
			<BottomNav active="cart" :badge="cartCount" @change="handleBottom" />
		</template>

		<template v-else-if="screen === 'search'">
			<MobileHeader ref="mobileHeader" @layout="headerHeight = $event" title="" @back="go('home')" />
			<view class="search-page-bar"><view><AppIcon name="search" size="27rpx" tone="muted"/><input v-model="keyword" placeholder="搜索商品" confirm-type="search" @confirm="doSearch"/><text v-if="keyword" @click="keyword=''">×</text></view><button @click="doSearch">搜索</button></view>
			<scroll-view scroll-y class="page-scroll search-scroll">
				<view v-if="recent.length" class="recent-search"><view class="section-title"><text>最近搜索</text><text class="more" @click="clearRecent">清空</text></view><view class="chips"><text v-for="item in recent" :key="item" @click="keyword=item;doSearch()">{{ item }}</text></view></view>
				<view class="section-title"><text>{{ searchDone ? '搜索结果' : '热门推荐' }}</text><text class="more">{{ filteredProducts.length }} 件商品</text></view>
				<view class="search-results card"><ProductRow v-for="product in filteredProducts" :key="product.name" v-bind="product" @select="selectProduct(product)" @add="addCart(product)" /></view>
				<view v-if="!filteredProducts.length" class="empty-state"><AppIcon name="search" size="72rpx" tone="muted"/><text class="ui-strong">没有找到相关商品</text><text class="ui-small">换个关键词试试</text></view>
			</scroll-view>
		</template>

		<template v-else-if="screen === 'auth'">
			<scroll-view scroll-y class="auth-scroll" :class="{ 'auth-register': authMode === 'register' }">
				<view class="auth-shell">
					<view class="auth-nav" :style="{ paddingTop: authStatusBar + 'px' }">
						<view class="auth-brand"><image src="/static/spring-mark.svg" class="auth-mark" mode="aspectFit" /><text>山泉到家</text></view>
						<button class="auth-browse" :disabled="authSubmitting || wechatSubmitting" @click="leaveAuth">先逛逛<text class="auth-chevron" /></button>
					</view>
					<view class="auth-hero">
						<image class="auth-landscape" src="/static/auth-spring.svg" mode="aspectFit" aria-hidden="true" />
						<view class="auth-headline"><text>把山泉，</text><text>带回家。</text></view>
						<text class="auth-tagline">一桶好水，安心日常。</text>
					</view>
					<view class="auth-main">
						<view class="auth-form-heading">
							<text class="auth-title">{{ pendingWechatCode ? '绑定已有账号' : (wechatQuick ? '微信快捷登录' : (authMode === 'login' ? '欢迎回来' : '创建新账号')) }}</text>
							<button class="auth-mode-switch" :disabled="authSubmitting || wechatSubmitting" @click="wechatQuick ? openWechatBinding() : switchAuthMode()">{{ wechatQuick ? '已有账号绑定' : (authMode === 'login' ? '新用户注册' : '返回登录') }}<text class="auth-chevron" /></button>
						</view>
						<text class="auth-description">{{ wechatQuick ? '新用户一键登录，无需先注册；订水时再填写收货信息。' : authMode === 'login' ? '登录后，订水、用票、查订单都方便。' : '填写配送信息，让好水准时到家。' }}</text>
						<view v-if="pendingWechatCode" class="auth-binding-note">输入已有账号的手机号和密码，即可绑定微信。新用户可返回微信一键登录，无需先注册。</view>
						<view v-if="!wechatQuick" class="auth-form">
							<view v-if="authMode === 'register'" class="auth-field">
								<label for="auth-name" class="auth-label">收货人</label>
								<view class="auth-input-wrap" :class="{ 'is-focused': authFocus === 'name', 'is-invalid': authErrorField === 'name' }"><input id="auth-name" v-model="authForm.name" :disabled="authSubmitting || wechatSubmitting" maxlength="20" placeholder="怎么称呼您" placeholder-class="auth-placeholder" @focus="focusAuth('name')" @blur="authFocus = ''" @input="clearAuthError" /></view>
							</view>
							<view class="auth-field">
								<label for="auth-phone" class="auth-label">手机号</label>
								<view class="auth-input-wrap" :class="{ 'is-focused': authFocus === 'phone', 'is-invalid': authErrorField === 'phone' }"><text class="auth-prefix">+86</text><input id="auth-phone" v-model="authForm.phone" :disabled="authSubmitting || wechatSubmitting" type="number" maxlength="11" placeholder="请输入手机号" placeholder-class="auth-placeholder" @focus="focusAuth('phone')" @blur="authFocus = ''" @input="clearAuthError" /></view>
							</view>
							<view class="auth-field">
								<label for="auth-password" class="auth-label">{{ authMode === 'login' ? '登录密码' : '设置密码' }}</label>
								<view class="auth-input-wrap" :class="{ 'is-focused': authFocus === 'password', 'is-invalid': authErrorField === 'password' }"><input id="auth-password" v-model="authForm.password" :disabled="authSubmitting || wechatSubmitting" :password="!authPasswordVisible" maxlength="32" :placeholder="authMode === 'login' ? '请输入密码' : '设置 6–32 位密码'" placeholder-class="auth-placeholder" confirm-type="done" @focus="focusAuth('password')" @blur="authFocus = ''" @input="clearAuthError" /><button class="auth-password-toggle" :aria-label="authPasswordVisible ? '隐藏密码' : '显示密码'" @click="authPasswordVisible = !authPasswordVisible"><AppIcon :name="authPasswordVisible ? 'eye' : 'eye-off'" size="21px" /></button></view>
							</view>
							<template v-if="authMode === 'register'">
								<view class="auth-field">
									<label class="auth-label">配送水站</label>
									<picker class="auth-station-picker" :range="stations" range-key="name" :value="authForm.stationIndex" :disabled="!stations.length || stationsLoading || authSubmitting" @change="authForm.stationIndex = Number($event.detail.value); clearAuthError()"><view class="auth-input-wrap" :class="{ 'is-invalid': authErrorField === 'station' && !!stationsError }"><text>{{ stationsLoading ? '水站加载中…' : (stations[authForm.stationIndex]?.name || (stationsError ? '水站加载失败' : '暂无可用配送水站')) }}</text><text class="auth-chevron" /></view></picker>
									<view v-if="!stationsLoading && (stationsError || !stations.length)" class="auth-station-help"><text>{{ stationsError ? '水站加载失败，请重新加载。' : '商家尚未开通配送水站，暂时无法注册。' }}</text><button :disabled="authSubmitting" @click="loadStations">{{ stationsError ? '重新加载' : '刷新水站' }}</button></view>
								</view>
								<view class="auth-field">
									<label for="auth-address" class="auth-label">收货地址</label>
									<view class="auth-input-wrap auth-address-wrap" :class="{ 'is-focused': authFocus === 'address', 'is-invalid': authErrorField === 'address' }"><textarea id="auth-address" v-model="authForm.address" :disabled="authSubmitting" maxlength="120" placeholder="小区、楼栋、单元及门牌号" placeholder-class="auth-placeholder" @focus="focusAuth('address')" @blur="authFocus = ''" @input="clearAuthError" /></view>
								</view>
								<view class="auth-field">
									<label for="auth-referral" class="auth-label">推荐码<text class="auth-optional">选填</text></label>
									<view class="auth-input-wrap"><input id="auth-referral" v-model="authForm.referralCode" :disabled="authSubmitting" maxlength="6" placeholder="填写好友的推荐码" placeholder-class="auth-placeholder" @input="clearAuthError" /></view>
								</view>
							</template>
						</view>
						<ConsentNotice :checked="authConsent" :disabled="authSubmitting || wechatSubmitting" @update:checked="authConsent = $event; clearAuthError()" />
						<text v-if="authError" class="auth-error" role="alert">{{ authError }}</text>
						<button v-if="!wechatQuick" class="auth-submit" :disabled="authSubmitting || wechatSubmitting || (authMode === 'register' && (stationsLoading || !!stationsError || !stations.length))" :loading="authSubmitting" @click="submitAuth">{{ authSubmitting ? '正在处理…' : (pendingWechatCode ? '验证并绑定微信' : (authMode === 'login' ? '登录' : '注册并登录')) }}<text v-if="!authSubmitting" class="auth-submit-arrow">→</text></button>
						<!-- #ifdef MP-WEIXIN -->
						<button v-if="wechatQuick" class="auth-submit auth-wechat-primary" :disabled="authSubmitting || wechatSubmitting" :loading="wechatSubmitting" @click="wechatAuth"><AppIcon name="wechat" size="23px"/><text>{{ wechatSubmitting ? '正在登录…' : '微信一键登录' }}</text></button>
							<button v-if="wechatQuick" class="auth-other" :disabled="authSubmitting || wechatSubmitting" @click="authMethod = 'password'; clearAuthError()">手机号密码登录</button>
							<button v-if="!wechatQuick && authMode === 'login'" class="auth-other" :disabled="authSubmitting || wechatSubmitting" @click="returnWechatQuick">返回微信一键登录</button>
						<template v-if="!wechatQuick && appConfig.wechatLogin && authMode === 'login' && !pendingWechatCode">
							<view class="auth-divider"><view /><text>其他登录方式</text><view /></view>
							<button class="auth-wechat" :disabled="authSubmitting || wechatSubmitting" :loading="wechatSubmitting" @click="wechatAuth"><AppIcon v-if="!wechatSubmitting" name="wechat" size="23px" /><text>{{ wechatSubmitting ? '正在连接微信…' : '微信登录' }}</text></button>
						</template>
						<!-- #endif -->
						<button class="courier-login" :disabled="authSubmitting || wechatSubmitting" @click="openDelivery('workbench')">配送员登录</button>
						<button v-if="appConfig.demoAuth" class="auth-demo" @click="demoAuth">本地演示账号登录（仅联调）</button>
					</view>
					<view class="auth-footer"><view class="auth-footer-line" /><text>山泉入户 · 清甜相伴</text></view>
				</view>
			</scroll-view>
		</template>
		<template v-else>
			<view class="profile-hero"><MobileHeader ref="mobileHeader" @layout="headerHeight = $event" title="" :back="false" dark transparent/><view class="profile-user"><view class="profile-avatar"><image src="/static/design/spring-landscape.jpg" mode="aspectFill" aria-hidden="true"/><text>{{String(account.name||'用').slice(0,1)}}</text></view><view><text>{{account.name||'山泉用户'}}</text><text class="profile-level" @click="openMember('membership')">{{ account.level || '查看会员权益' }} ›</text><text class="ui-small">{{maskedPhone}}</text></view><text class="profile-arrow" @click="openMember('membership')">›</text></view><view class="profile-lines"></view></view>
			<scroll-view scroll-y class="profile-content with-nav">
				<view v-if="profileError" class="card profile-error" role="alert"><text>账户信息加载失败，余额与水票尚未确认：{{ profileError }}</text><button class="retry-button" @click="loadProfile">重新加载</button></view>
				<view class="wallet-card card"><view class="section-title"><text>我的水票</text><text class="more" @click="openMember('tickets')">查看明细 ›</text></view><view class="asset-card"><view @click="openMember('tickets')"><text class="ui-strong">{{profileLoaded ? ticketCount : '--'}}</text><text class="ui-small">水票(张)</text></view><view @click="openMember('balance')"><text class="ui-strong">{{profileLoaded ? Number(account.balance||0).toFixed(2) : '--'}}</text><text class="ui-small">余额(元)</text></view></view></view>
				<view class="order-entry card"><view class="section-title"><text>我的订单</text><text class="more" @click="openOrders">查看全部订单 ›</text></view><view class="order-status"><view v-for="status in profileOrders" :key="status.label" @click="openProfileOrder(status)"><AppIcon :name="status.icon" size="34rpx"/><text class="ui-small">{{ status.label }}</text><text class="ui-i" v-if="status.badge">{{ status.badge }}</text></view></view></view>
				<view v-if="isWechatPlatform" class="profile-menu card"><view @click="handleProfileMenu({ target: 'wechatBinding' })"><AppIcon class="menu-symbol" name="wechat" size="29rpx"/><text>绑定已有账号</text><text class="menu-arrow">›</text></view></view><view class="profile-menu card"><view v-for="item in visibleProfileMenu" :key="item.label" @click="handleProfileMenu(item)"><AppIcon class="menu-symbol" :name="item.icon" size="29rpx"/><text>{{ item.label }}</text><text class="ui-small" v-if="menuValue(item)">{{ menuValue(item) }}</text><text class="menu-arrow">›</text></view></view>
				<view v-if="referral.referralCode" class="referral-card card" @click="shareReferral"><view><text class="ui-strong">我的推荐码 {{ referral.referralCode }}</text><text class="ui-small">已推荐 {{ referral.referredCount }} 人 · 累计获得 {{ referral.rewardedPoints }} 积分 · 好友首单送 {{ referral.rewardPerOrder }} 积分</text></view><text class="menu-arrow">复制 ›</text></view>
			</scroll-view>
			<BottomNav active="profile" :badge="cartCount" @change="handleBottom" />
		</template>

		<view v-if="toast" class="mobile-toast">{{ toast }}</view>
	</view>
</template>

<script>
import ConsentNotice from '../../components/ConsentNotice.vue'
import { CONSENT_MESSAGE, rememberConsent, openLegalDocument } from '../../services/privacy.js'
import MobileHeader from '../../components/MobileHeader.vue'
import WaterJug from '../../components/WaterJug.vue'
import ProductRow from '../../components/ProductRow.vue'
import BottomNav from '../../components/BottomNav.vue'
import AppIcon from '../../components/AppIcon.vue'
import { waterApi } from '../../services/waterApi.js'
import { chooseFromList } from '../../services/actionSheet.js'

export default {
	components: { ConsentNotice, MobileHeader, WaterJug, ProductRow, BottomNav, AppIcon },
	data() {
		return { headerHeight: 44, readRevisions: {}, readEpoch: 0, pageDisposed: false, 
			 screen: 'home', categoryIndex: 0, skuOpen: false, selectedProduct: null, keyword: '', searchDone: false, toast: '',
			recent: [], guest: false, authReturn: 'home', authNext: '', profileLoaded: false, profileError: '',
		categories: [], categoryRecords: [], catalogStation: '', stations: [], stationsLoading: false, stationsError: '', products: [], catalogLoading: true, catalogError: '', account: {wechatOnly:false,balance:0,points:0,name:'',phone:'',address:'',stationName:'',level:'',nextLevelGap:0,totalSpent:0}, ticketCount: 0,
			quickActions: [
				{ label: '一键订水', icon: 'cart', target: 'category', tone: 'green' }, { label: '我的水票', icon: 'ticket', target: 'tickets', tone: 'mint' }, { label: '查订单', icon: 'order', target: 'orders', tone: 'jade' }, { label: '积分商城', icon: 'gift', target: 'points', tone: 'gold' }
			],
			cartStations: [],
			orderCounts: {}, aftersaleCount: 0, couponCount: 0, recommendOffset: 0,
			authMode: 'login', authMethod: 'wechat', isWechatPlatform: false, authConsent: false, authSubmitting: false, wechatSubmitting: false, authPasswordVisible: false, authStatusBar: 16, authFocus: '', authError: '', authErrorField: '', pendingWechatCode: '', authForm: { name: '', phone: '', password: '', address: '', stationIndex: 0, referralCode: '' }, appConfig: { demoAuth: false, wechatLogin: false, wechatPay: false }, referral: { referralCode: '', referredCount: 0, rewardedPoints: 0, rewardPerOrder: 0 },
			profileMenu: [{ label: '我的地址', icon: 'pin', target: 'address' }, { label: '积分商城', icon: 'gift', target: 'points' }, { label: '优惠券', icon: 'coupon', target: 'points' }, { label: '客服与帮助', icon: 'help', target: 'support' }, { label: '配送工作台', icon: 'truck', target: 'delivery' }, { label: '修改密码', icon: 'shield', target: 'password' }, { label: '用户服务协议', icon: 'shield', target: 'terms' }, { label: '隐私政策', icon: 'shield', target: 'privacy' }, { label: '设置', icon: 'settings', target: 'settings' }]
		}
	},
	computed: {
		visibleProfileMenu() { return this.profileMenu.filter(item => !(this.account.wechatOnly && item.target === 'password')) },
		wechatQuick() { return this.isWechatPlatform && this.authMethod === 'wechat' && this.authMode === 'login' && !this.pendingWechatCode },
		detailProduct() { return this.selectedProduct || this.products[0] || null },
		cartCount() { return this.cartStations.reduce((sum, station) => sum + station.items.reduce((subtotal, item) => subtotal + Number(item.qty || 0), 0), 0) },
		selectedCartCount() { return this.cartStations.reduce((sum, station) => sum + station.items.filter(item => item.checked).reduce((subtotal, item) => subtotal + Number(item.qty || 0), 0), 0) },
		cartTotal() { return this.cartStations.reduce((sum, station) => sum + station.items.filter(item => item.checked).reduce((subtotal, item) => subtotal + Number(item.price) * Number(item.qty || 0), 0), 0).toFixed(2) },
		allCartSelected() { const items = this.cartStations.flatMap(station => station.items); return items.length > 0 && items.every(item => item.checked) },
		filteredProducts() {
			if (!this.searchDone || !this.keyword) return this.products
			return this.products.filter(item => (item.name + item.spec + item.note).includes(this.keyword))
		},
		categoryProducts(){const name=this.categories[this.categoryIndex];return this.products.filter(item=>item.category===name)},
		featuredProducts(){const first=this.products[0];if(!first)return [];const second=this.products.find(p=>p.sku!==first.sku&&/ml|毫升/i.test(p.spec))||this.products[1];return second?[first,second]:[first]},
		maskedPhone(){const value=String(this.account.phone||'');return value.length===11?`${value.slice(0,3)}****${value.slice(-4)}`:value},
		shortAddress(){const address=String(this.account.address||'').trim();if(!address)return '设置收货地址';return address.length>10?`${address.slice(0,10)}…`:address},
		recommendProducts(){const pool=this.products.length>2?this.products.slice(2):this.products;if(!pool.length)return [];const offset=this.recommendOffset%pool.length;return [...pool.slice(offset),...pool.slice(0,offset)]},
		sameCategoryProducts(){return this.detailProduct ? this.products.filter(item=>item.category===this.detailProduct.category) : []},
		/** 客户所属水站；访客或水站未匹配时只有一个水站才直接使用，否则由用户选择 */
		contactStation(){return this.stations.find(item=>item.name===this.account.stationName)||(this.stations.length===1?this.stations[0]:null)},
		deliveryRuleText(){const station=this.contactStation;if(!station)return '配送费以结算页为准';const fee=Number(station.deliveryFee||0);const freeOver=Number(station.freeDeliveryOver||0);if(fee<=0)return '免配送费';return freeOver>0?`配送费 ¥${fee.toFixed(2)}，满 ¥${freeOver.toFixed(2)} 免配送费`:`配送费 ¥${fee.toFixed(2)}`},
		levelProgress(){const spent=Number(this.account.totalSpent||0);const gap=Number(this.account.nextLevelGap||0);if(gap<=0)return 100;const target=spent+gap;return target>0?Math.max(6,Math.min(100,Math.round(spent/target*100))):0},
		profileOrders(){const counts=this.orderCounts||{};return [{label:'待支付',icon:'wallet',badge:counts['待付款']||0,tab:'待付款'},{label:'待配送',icon:'order',badge:counts['待配送']||0,tab:'待配送'},{label:'配送中',icon:'truck',badge:counts['配送中']||0,tab:'配送中'},{label:'已完成',icon:'check',badge:0,tab:'已完成'},{label:'售后/退款',icon:'help',badge:this.aftersaleCount||0,tab:'售后'}]}
	},
	onLoad(query) {
		// #ifdef MP-WEIXIN
		this.isWechatPlatform = true
		// #endif

		// Use the native status bar and WeChat capsule; never draw a second one.
		// #ifdef MP-WEIXIN
		this.authStatusBar = uni.getSystemInfoSync().statusBarHeight || 20
		// #endif
		this.restoreCart(); this.screen = query.screen || 'home'; waterApi.hooks.onAuthRequired = role => {
			const pages = getCurrentPages(); const current = pages[pages.length - 1]
			if (role === 'customer' && current?.route === 'pages/index/index') { if (this.screen !== 'auth') this.authReturn = this.screen === 'profile' ? 'home' : this.screen; this.screen = 'auth' }
			else waterApi.showLogin(role)
		}; waterApi.getConfig().then(config => { this.appConfig = config }); this.loadCatalog(); if (this.screen !== 'auth') this.loadProfile()
	},
	onShow(){this.$nextTick(() => { const header = /** @type {{ refresh?: () => void }} */ (this.$refs.mobileHeader); header?.refresh?.() });this.restoreCart();if(this.screen!=='auth')this.loadProfile()},
	onUnload(){this.pageDisposed=true;this.invalidateReads()},
	methods: {
    invalidateReads(){this.readEpoch++},
    readGuard(key){const epoch=this.readEpoch,revision=(this.readRevisions[key]||0)+1;this.readRevisions[key]=revision;const identity=waterApi.captureSession?.('customer');return ()=>!this.pageDisposed&&epoch===this.readEpoch&&revision===this.readRevisions[key]&&(!identity||waterApi.isCurrentSession(identity))},
		go(target) {
			if (['tickets','points','balance','membership'].includes(target)) return this.openMember(target)
			if (target === 'orders') return this.openOrders('全部')
			// 访客可浏览首页/分类/详情/购物车/搜索；“我的”需要登录
			if (target === 'profile' && this.guest) return this.requireLogin('profile')
			if (target === 'search') this.loadRecent()
			this.screen = target
			uni.pageScrollTo({ scrollTop: 0, duration: 0 })
		},
		/** 受保护操作的登录入口：记录来源屏，登录后或点“先逛逛”都能回到原处 */
		requireLogin(next = '') { if (this.screen !== 'auth') this.authReturn = this.screen === 'profile' ? 'home' : this.screen; this.authNext = next; this.authMode = 'login'; this.authMethod = 'wechat'; this.authConsent = false; this.pendingWechatCode = ''; this.authPasswordVisible = false; this.clearAuthError(); this.screen = 'auth'; uni.pageScrollTo({ scrollTop: 0, duration: 0 }) },
		leaveAuth() { if (this.authSubmitting || this.wechatSubmitting) return; const back = this.authReturn && this.authReturn !== 'auth' ? this.authReturn : 'home'; this.pendingWechatCode = ''; this.authConsent = false; this.authForm.password = ''; this.authPasswordVisible = false; this.clearAuthError(); this.authNext = ''; this.authReturn = 'home'; this.screen = back; this.loadProfile() },
		afterLogin() { this.invalidateReads(); const next = this.authNext || this.authReturn || 'home'; this.authNext = ''; this.authReturn = 'home'; this.guest = false; this.screen = next === 'auth' ? 'home' : next; this.loadProfile() },
		handleBottom(target) { this.go(target) },
		selectProduct(product) { this.selectedProduct = product; this.go('detail') },
		addCart(product = this.detailProduct) { if(!product?.sku||!this.products.some(item=>item.sku===product.sku))return this.showToast('商品数据尚未加载，请重试');const stationName=this.account.stationName||this.stations[0]?.name;if(!stationName)return this.showToast('配送水站尚未加载，请重试');let station=this.cartStations.find(item=>item.name===stationName&&Boolean(item.guest)===Boolean(this.guest));if(!station){station={name:stationName,delivery:'所属水站配送',checked:true,items:[],...(this.guest?{guest:true}:{})};this.cartStations.push(station)}const found = station.items.find(item => item.sku === product.sku); if (found) { found.qty += 1; found.checked = true } else { station.items.push({ ...product, qty: 1, checked: true }) } station.checked = station.items.every(item => item.checked); this.persistCart(); this.showToast('已加入购物车') },
		changeQty(stationIndex,index,delta) { const item = this.cartStations[stationIndex].items[index]; item.qty = Math.max(1,item.qty + delta); this.persistCart() },
		removeCartItem(stationIndex,index) { this.cartStations[stationIndex].items.splice(index,1); this.syncStationSelection(stationIndex); this.persistCart(); this.showToast('商品已删除') },
		toggleStation(stationIndex) { const station = this.cartStations[stationIndex]; station.checked = !station.checked; station.items.forEach(item => { item.checked = station.checked }); this.persistCart() },
		toggleItem(stationIndex,index) { const item = this.cartStations[stationIndex].items[index]; item.checked = !item.checked; this.syncStationSelection(stationIndex); this.persistCart() },
		toggleAllCart() { const checked = !this.allCartSelected; this.cartStations.forEach(station => { station.checked = checked; station.items.forEach(item => { item.checked = checked }) }); this.persistCart() },
		syncStationSelection(stationIndex) { const station = this.cartStations[stationIndex]; station.checked = station.items.length > 0 && station.items.every(item => item.checked) },
		persistCart() { uni.setStorageSync('mountain-spring-cart', this.cartStations) },
		/** 登录后把访客加购（按默认水站分组）并入客户所属水站，避免结算时被当作跨水站商品 */
		adoptGuestCart(stationName) { if (!stationName || !this.cartStations.some(station => station.guest)) return; let target = this.cartStations.find(station => station.name === stationName && !station.guest); if (!target) { target = { name: stationName, delivery: '所属水站配送', checked: true, items: [] }; this.cartStations.push(target) } for (const station of this.cartStations.filter(item => item.guest)) for (const item of station.items) { const found = target.items.find(entry => entry.sku === item.sku); if (found) found.qty += Number(item.qty || 0); else target.items.push({ ...item }) } this.cartStations = this.cartStations.filter(station => !station.guest); target.checked = target.items.length > 0 && target.items.every(item => item.checked); this.persistCart() },
		restoreCart() { const saved = uni.getStorageSync('mountain-spring-cart'); if (Array.isArray(saved) && saved.length && saved.every(station=>Array.isArray(station.items)&&station.items.every(item=>item.sku))) this.cartStations = saved; else { this.cartStations = []; uni.removeStorageSync('mountain-spring-cart') } },
		async loadStations() {
			if (this.stationsLoading) return
			const selectedId = this.stations[this.authForm.stationIndex]?.id
			this.stationsLoading = true; this.stationsError = ''
			try {
				this.stations = await waterApi.listCatalogStations()
				this.authForm.stationIndex = Math.max(0, this.stations.findIndex(item => item.id === selectedId))
				if (this.authErrorField === 'station') this.clearAuthError()
			} catch (error) {
				this.stations = []; this.stationsError = error.message || '水站加载失败'
			} finally { this.stationsLoading = false }
		},
		async loadCatalog() {
			const current=this.readGuard('catalog')
			this.catalogLoading = true; this.catalogError = ''
			const stationTask = this.loadStations()
			try {
				const station = this.account.stationName || undefined
				const [categories, products] = await Promise.all([waterApi.listCatalogCategories(), waterApi.listCatalogProducts(undefined, station)])
				if (!current()) return
				this.catalogStation = station || ''
				this.categoryRecords = categories; this.categories = categories.map(item => item.name)
				this.products = products.map(item => ({id:item.id,sku:item.skuCode,name:item.name,category:item.categoryName,spec:item.spec,note:item.description,imageUrl:item.imageUrl?waterApi.fileUrl(item.imageUrl):'',price:Number(item.price).toFixed(2),stock:item.stock}))
				if (this.selectedProduct && !this.products.some(item => item.sku === this.selectedProduct.sku)) this.selectedProduct = null
				if (this.categoryIndex >= this.categories.length) this.categoryIndex = 0
			} catch (error) {
				if (!current()) return
				if (!this.products.length) this.categories = []
				this.catalogError = error.message || '商品暂时无法加载'; this.showToast(this.catalogError)
			} finally { this.catalogLoading = false }
			await stationTask
		},
		/** 访客（无会话且不能自动登录）不请求受保护接口、不弹登录；已登录用户加载失败显示错误而不是 0 */
		async loadProfile(){const current=this.readGuard('profile');if(!waterApi.hasSession('customer')&&!(await waterApi.canRestoreSession('customer'))){if(!current())return;this.guest=true;this.profileLoaded=false;this.profileError='';if(this.screen==='profile')this.requireLogin('profile');return}if(!current())return;try{const [account,tickets,orders,aftersales,coupons,referral]=await Promise.all([waterApi.getAccount(),waterApi.listTickets(),waterApi.listOrders(),waterApi.listAftersales(),waterApi.listCoupons(),waterApi.getReferral()]);if(!current())return;this.guest=false;this.profileLoaded=true;this.profileError='';this.account=account;this.adoptGuestCart(account.stationName);if(account.stationName&&account.stationName!==this.catalogStation&&!this.catalogLoading)this.loadCatalog();this.referral=referral;this.ticketCount=tickets.filter(item=>item.status==='可用').length;const counts={};for(const order of orders)counts[order.status]=(counts[order.status]||0)+1;this.orderCounts=counts;this.aftersaleCount=aftersales.filter(item=>['待审核','已通过'].includes(item.status)).length;this.couponCount=coupons.filter(item=>item.customerCouponId&&item.customerStatus==='未使用').length}catch(error){if(!current()||error?.code==='STALE_SESSION')return;if(error?.code==='AUTH_REQUIRED'){this.guest=true;this.profileLoaded=false;return}this.profileError=error.message||'请检查网络后重试';console.warn('[profile-sync]',error.message)}},
		clearAuthError() { this.authError = ''; this.authErrorField = '' },
		focusAuth(field) { this.authFocus = field },
		setAuthError(message, field = '') { this.authError = message; this.authErrorField = field },
		openWechatBinding() {
			if (this.authSubmitting || this.wechatSubmitting) return
			// pendingWechatCode is only a view marker; submitAuth always fetches a fresh code.
			this.authMethod = 'password'; this.authMode = 'login'; this.pendingWechatCode = 'bind-existing'
			this.authForm.password = ''; this.authPasswordVisible = false; this.authConsent = false; this.clearAuthError()
		},
		returnWechatQuick() {
			if (this.authSubmitting || this.wechatSubmitting) return
			this.authMethod = 'wechat'; this.authMode = 'login'; this.pendingWechatCode = ''; this.authForm.password = ''; this.authConsent = false; this.clearAuthError()
		},
		switchAuthMode() {
			if (this.authSubmitting || this.wechatSubmitting) return
			this.authMode = this.authMode === 'login' ? 'register' : 'login'
			this.pendingWechatCode = ''; this.authConsent = false; this.authForm.password = ''; this.authPasswordVisible = false
			this.authFocus = ''; this.clearAuthError()
		},
		acceptPrivacy() {
			if (!this.authConsent) { this.setAuthError(CONSENT_MESSAGE); return false }
			try { rememberConsent('customer'); return true } catch { this.setAuthError('无法保存授权状态，请检查设备存储后重试'); return false }
		},
		async submitAuth() {
			if (this.authSubmitting || this.wechatSubmitting) return
			this.clearAuthError()
			if (!this.authConsent) return this.setAuthError(CONSENT_MESSAGE)
			const form = this.authForm
			if (this.authMode === 'register' && !form.name.trim()) return this.setAuthError('请填写收货人姓名', 'name')
			if (!/^1[3-9]\d{9}$/.test(form.phone)) return this.setAuthError('请输入正确的 11 位手机号', 'phone')
			if (form.password.length < 6 || form.password.length > 32) return this.setAuthError('密码需要 6–32 位，请重新输入', 'password')
			if (this.authMode === 'register' && (this.stationsLoading || this.stationsError || !this.stations[form.stationIndex]?.id)) return this.setAuthError(this.stationsLoading ? '水站正在加载，请稍后' : (this.stationsError ? '水站加载失败，请重新加载' : '商家尚未开通配送水站，暂时无法注册'), 'station')
			if (this.authMode === 'register' && form.address.trim().length < 4) return this.setAuthError('请填写详细收货地址', 'address')
			if (!this.acceptPrivacy()) return
			const bindingWechat = Boolean(this.pendingWechatCode)
			this.authSubmitting = true
			try {
				if (this.authMode === 'login') {
					if(bindingWechat){const code=await this.freshWechatCode();await waterApi.wechatLogin({code,phone:form.phone,password:form.password});this.pendingWechatCode=''}
					else await waterApi.loginWithPassword('customer', form.phone, form.password)
				} else {
					await waterApi.register({ name: form.name.trim(), phone: form.phone, password: form.password, address: form.address.trim(), stationId: this.stations[form.stationIndex].id, referralCode: form.referralCode.trim().toUpperCase() || undefined })
				}
				this.showToast(this.authMode === 'login' ? (bindingWechat ? '微信绑定成功' : '登录成功') : '注册成功')
				this.authForm.password = ''; this.authPasswordVisible = false; this.afterLogin()
			} catch (error) {
				// 服务端已兼容全角字符与首尾空格；仍被拒且密码里有中文、全角或空格时，多给一句可操作的提示
				const charHint = error.statusCode === 401 && /[^!-~]/.test(form.password) ? '。密码里含有中文、全角或空格字符，请切换到英文键盘后重新输入' : ''
				this.setAuthError((error.message || '暂时无法登录，请稍后重试') + charHint)
			} finally { this.authSubmitting = false }
		},
		async demoAuth(){ if(!this.acceptPrivacy())return; try{ uni.removeStorageSync('water_auth_required_customer') }catch(error){ console.warn(error) } try{ await waterApi.login('customer',{},true); this.afterLogin() }catch(error){ this.showToast(error.message) } },
		freshWechatCode() {
			return new Promise((resolve, reject) => {
				if (typeof uni.login !== 'function') return reject(new Error('当前环境不支持微信登录，请使用手机号登录'))
				uni.login({ provider: 'weixin', timeout: 12000,
					success: res => res.code ? resolve(res.code) : reject(new Error('未获取到微信授权，请重新尝试')),
					fail: () => reject(new Error('微信连接失败，请重试或使用手机号登录')) })
			})
		},
		wechatAuth() {
			if (this.authSubmitting || this.wechatSubmitting) return
			this.clearAuthError()
			if (!this.acceptPrivacy()) return
			if (typeof uni.login !== 'function') return this.setAuthError('当前环境不支持微信登录，请使用手机号登录')
			this.wechatSubmitting = true
			try {
				uni.login({ provider: 'weixin', timeout: 12000, success: async res => {
					try {
						if (!res.code) throw new Error('未获取到微信授权，请重新尝试')
						await waterApi.wechatLogin({ code: res.code }); this.afterLogin()
					} catch (error) {
						this.setAuthError(error.message || '微信登录失败，请重试')
					} finally { this.wechatSubmitting = false }
				}, fail: () => { this.wechatSubmitting = false; this.setAuthError('微信连接失败，请重试或使用手机号登录') } })
			} catch (error) { this.wechatSubmitting = false; this.setAuthError(error.message || '微信登录失败，请重试') }
		},
		/** 修改成功后服务端旧会话失效：清除本地会话并回到登录页，用新密码重新登录 */
		changePassword(){ uni.showModal({title:'修改密码',editable:true,placeholderText:'输入新密码（6-32 位）',success:async result=>{ if(!result.confirm)return; const newPassword=String(result.content||'').trim(); if(newPassword.length<6||newPassword.length>32)return this.showToast('新密码需要 6–32 位'); uni.showModal({title:'验证原密码',editable:true,placeholderText:'输入当前密码',success:async verify=>{ if(!verify.confirm)return; try{ await waterApi.changePassword('customer',String(verify.content||''),newPassword) }catch(error){ return this.showToast(error.message) } waterApi.clearLocalSession('customer'); this.invalidateReads(); this.account = { wechatOnly: false, balance: 0, points: 0, name: '', phone: '', address: '', stationName: '', level: '', nextLevelGap: 0, totalSpent: 0 }; this.guest = true; this.profileLoaded = false; this.requireLogin(); this.authReturn = 'home'; this.showToast('密码已修改，请使用新密码重新登录') }}) }}) },
		shareReferral(){ const code=this.referral.referralCode; if(!code)return; uni.setClipboardData({data:`山泉到家推荐码 ${code}，注册时填写，好友首单后我可得 ${this.referral.rewardPerOrder} 积分`,success:()=>this.showToast('推荐码已复制，可发给好友'),fail:()=>uni.showModal({title:'推荐码',content:code,showCancel:false})}) },
		menuValue(item){if(item.target==='support')return this.contactStation?.phone||'';if(!this.profileLoaded)return '';if(item.target==='tickets')return this.ticketCount?`${this.ticketCount} 张可用`:'';if(item.target==='address')return this.account.address?'':'未设置';if(item.target==='points')return item.label==='优惠券'?(this.couponCount?`${this.couponCount} 张可用`:''):`${this.account.points||0} 积分`;return ''},
		handleProfileMenu(item) {
			if (item.target === 'wechatBinding') { this.requireLogin('profile'); return this.openWechatBinding() }
			if (item.target === 'terms' || item.target === 'privacy') return openLegalDocument(item.target)
			if (item.target === 'delivery') return this.openDelivery()
			if (item.target === 'address') return this.openAddress()
			if (item.target === 'support') return this.openSupport()
			if (item.target === 'password') return this.changePassword()
			if (item.target === 'settings') return this.openSettings()
			return this.openMember(item.target)
		},
		openAddress() { if (this.guest) return this.requireLogin(); uni.navigateTo({ url: '/pages/order/index?screen=address' }) },
		/** 联系客户所属水站；无法确定（访客且有多个水站）时让用户选择，不再默认拨第一个水站 */
		callStation() { const station = this.contactStation; if (!station && this.stations.length > 1) { const stations = [...this.stations]; return chooseFromList(stations.map(item => `${item.name} ${item.phone || ''}`)).then(index => { if (index >= 0) this.dialStation(stations[index]) }).catch(error => this.showToast(error.message)) } this.dialStation(station) },
		dialStation(station) { const phone = String(station?.phone || '').replace(/[^\d+-]/g, ''); if (!phone) return this.showToast(this.stations.length ? '水站暂未提供联系电话' : '水站电话同步中'); if (typeof uni.makePhoneCall !== 'function') return this.showToast(`水站电话 ${phone}`); uni.makePhoneCall({ phoneNumber: phone, fail: error => { if (!/cancel/i.test(String(error && error.errMsg))) this.showToast('拨号失败') } }) },
		openSupport() { const station = this.contactStation; const items = [station ? `拨打 ${station.name} ${station.phone}` : '拨打水站电话', '查看配送说明', '查看退款说明']; uni.showActionSheet({ itemList: items, success: res => { if (res.tapIndex === 0) return this.callStation(); if (res.tapIndex === 1) return uni.showModal({ title: '配送说明', content: '下单后由所属水站派单，送水员接单后可在订单详情查看电话；支持选择配送时段。', showCancel: false }); uni.showModal({ title: '退款说明', content: '待配送的余额支付订单可直接取消退回余额；已送达订单可在订单详情申请售后，后台审核后退款。', showCancel: false }) } }) },
		openSettings() { uni.showActionSheet({ itemList: ['清空购物车', '退出登录'], success: res => { if (res.tapIndex === 0) { this.cartStations = []; this.persistCart(); return this.showToast('购物车已清空') } uni.showModal({ title: '退出登录', content: '退出后需要重新登录才能查看订单与资产', success: async result => { if (!result.confirm) return; try { await waterApi.logout('customer') } catch (error) { return this.showToast(`服务端退出未确认，请重试：${error.message}`) } this.invalidateReads(); this.cartStations = []; this.persistCart(); this.account = { wechatOnly: false, balance: 0, points: 0, name: '', phone: '', address: '', stationName: '', level: '', nextLevelGap: 0, totalSpent: 0 }; this.authMode = 'login'; this.authConsent = false; this.authForm.password = ''; this.authPasswordVisible = false; this.pendingWechatCode = ''; this.clearAuthError(); this.guest = true; this.profileLoaded = false; this.profileError = ''; this.authReturn = 'home'; this.authNext = ''; this.screen = 'auth'; this.showToast('已退出登录') } }) } }) },
		rotateRecommend() { this.recommendOffset += 1 },
		/** 最近搜索仅保存在本机（最多 8 条），不再显示写死的示例词 */
		loadRecent() { try { const saved = uni.getStorageSync('mountain-spring-recent-search'); this.recent = Array.isArray(saved) ? saved.filter(item => typeof item === 'string' && item).slice(0, 8) : [] } catch { this.recent = [] } },
		clearRecent() { this.recent = []; try { uni.removeStorageSync('mountain-spring-recent-search') } catch (error) { console.warn('[recent-search]', error) } },
		doSearch() { this.searchDone = true; const keyword = String(this.keyword || '').trim(); if (!keyword) return; this.recent = [keyword, ...this.recent.filter(item => item !== keyword)].slice(0, 8); try { uni.setStorageSync('mountain-spring-recent-search', this.recent) } catch (error) { console.warn('[recent-search]', error) } },
		/** 详情页“立即购买”只结算当前商品；购物车结算所有勾选商品（同一水站合并为一张订单）。 */
		openOrder() {
			let items = []
			let fromCart = false
			if (this.screen === 'detail') {
				const stationName = this.account.stationName || this.stations[0]?.name
				if (!this.detailProduct?.sku || !stationName) return this.showToast('请先加载并选择结算商品')
				items = [{ ...this.detailProduct, qty: 1, station: stationName }]
			} else if (this.screen === 'cart') {
				items = this.cartStations.flatMap(station => station.items.filter(item => item.checked).map(item => ({ ...item, station: station.name })))
				fromCart = true
			}
			if (!items.length) return this.showToast('请先选择结算商品')
			if (new Set(items.map(item => item.station)).size > 1) return this.showToast('不同水站的商品请分开结算')
			if (items.length > 20) return this.showToast('单笔订单最多 20 种商品')
			if (this.guest) return this.requireLogin()
			uni.setStorageSync('mountain-spring-checkout', { station: items[0].station, fromCart, items: items.map(item => ({ sku: item.sku, name: item.name, spec: item.spec, price: item.price, qty: Number(item.qty || 1), imageUrl: item.imageUrl || '', station: item.station })) })
			uni.navigateTo({ url: '/pages/order/index?screen=confirm' })
		},
		openDelivery(screen = 'workbench') { if (this.authSubmitting || this.wechatSubmitting) return; return uni.reLaunch({ url: '/pages/delivery/index?screen=' + screen }) },
		openOrders(tab) { if (this.guest) return this.requireLogin(); uni.navigateTo({ url: `/pages/order/index?screen=orders${typeof tab === 'string' && tab ? `&tab=${encodeURIComponent(tab)}` : ''}` }) },
		openProfileOrder(status) { if (status.tab !== '售后') return this.openOrders(status.tab); if (this.guest) return this.requireLogin(); uni.navigateTo({ url: '/pages/order/index?screen=aftersales' }) },
		openMember(screen) { if (this.guest) return this.requireLogin(); uni.navigateTo({ url: '/pages/member/index?screen=' + screen }) },
		showToast(message) { if (waterApi.recentlyToasted?.(message)) return; this.toast = message; setTimeout(() => { this.toast = '' }, 1600) }
	}
}
</script>

<style scoped>
@import "./auth.css";
.courier-login { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; margin: 14px 0 0; padding: 8px 16px; border: 1px solid #c5d9d1; border-radius: 12px; color: #07543f; background: #f3f8f5; font-size: 14px; line-height: 24px; }
.courier-login::after { border: 0; }
.courier-login:disabled { opacity: .55; }
.shop-page { height: 100vh; height: 100dvh; overflow: hidden; background: #f6f7f3; color: #17352d; }
.page-scroll { height: calc(100vh - var(--mobile-header-height, 44px)); height: calc(100dvh - var(--mobile-header-height, 44px)); }
.page-scroll.with-nav { height: calc(100vh - var(--mobile-header-height, 44px) - 112rpx - env(safe-area-inset-bottom)); height: calc(100dvh - var(--mobile-header-height, 44px) - 112rpx - env(safe-area-inset-bottom)); }
.with-nav-height { height: calc(100vh - var(--mobile-header-height, 44px) - 112rpx - env(safe-area-inset-bottom)); height: calc(100dvh - var(--mobile-header-height, 44px) - 112rpx - env(safe-area-inset-bottom)); }
.home-top { padding: 0 24rpx 12rpx; background: #f6f7f3; }
.location-row { height: 56rpx; display: flex; align-items: center; gap: 8rpx; font-size:max(12px, 23rpx); }
.location-icon { color: #177a63; font-size:max(12px, 15rpx); }
.location-name { font-weight: 600; }
.search-bar { height: 66rpx; padding-left: 22rpx; display: grid; grid-template-columns: 32rpx 1fr 104rpx; align-items: center; border: 1rpx solid #d2e0db; border-radius: 34rpx; background: #fff; box-shadow: 0 7rpx 22rpx rgba(43,83,72,.05); }
.search-bar .placeholder { color: #9ba7a3; font-size:max(12px, 23rpx); }
.search-bar button { align-self: stretch; border-radius: 34rpx; color: #fff; background: #08705a; font-size:max(12px, 22rpx); }
.hero-banner { position: relative; height: 330rpx; margin: 8rpx 24rpx 16rpx; padding: 45rpx 28rpx; display: flex; align-items: center; justify-content: space-between; overflow: hidden; border-radius: 18rpx; background: linear-gradient(135deg,#eaf4f0 0%,#c7dfd7 52%,#eef5f2 100%); }
.hero-banner::before,.hero-banner::after { content: ""; position: absolute; inset: auto -20% 5% -20%; height: 62%; background: url('/static/mountain-lines.svg') center bottom/cover no-repeat; opacity: .6; }
.hero-banner::after { transform: translateY(28rpx); opacity: .28; }
.banner-copy { position: relative; z-index: 3; width: 58%; }
.banner-title { display: block; color: #07543f; font-size: 38rpx; font-weight: 700; line-height: 1.35; }
.banner-sub { display: block; margin-top: 13rpx; color: #517970; font-size:max(12px, 21rpx); }
.banner-copy button { margin: 22rpx 0 0; padding: 0; color: #07543f; background: transparent; font-size:max(12px, 20rpx); text-align: left; }
.hero-banner :deep(.jug-wrap) { z-index: 2; transform: scale(1.1); }
.banner-dots { position: absolute; z-index: 4; left: 0; right: 0; bottom: 14rpx; display: flex; justify-content: center; gap: 7rpx; }
.banner-dots .ui-i { width: 9rpx; height: 9rpx; border-radius: 50%; background: rgba(7,84,63,.28); }
.banner-dots .ui-i.active { width: 22rpx; border-radius: 5rpx; background: #07543f; }
.card { margin: 0 24rpx 16rpx; border: 1rpx solid #e2eae7; border-radius: 17rpx; background: #fff; box-shadow: 0 10rpx 28rpx rgba(38,76,66,.045); }
.quick-actions { height: 138rpx; padding: 15rpx 8rpx; display: grid; grid-template-columns: repeat(4,1fr); }
.quick-actions > view { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9rpx; font-size:max(12px, 21rpx); }
.quick-icon { width: 64rpx; height: 64rpx; display: grid; place-items: center; border: 1rpx solid rgba(15,114,93,.08); border-radius: 19rpx; }
.quick-icon.green { background: #dcece6; }.quick-icon.mint { background: #e6f0ec; }.quick-icon.jade { background: #dceae5; }.quick-icon.gold { background: #f3eadb; }
.section-title { min-height: 66rpx; padding: 0 27rpx; display: flex; align-items: center; justify-content: space-between; font-size: 27rpx; font-weight: 600; }
.section-title.inner { padding: 0 26rpx; }.more { color: #7c8b86; font-size:max(12px, 20rpx); font-weight: 400; }
.product-grid { padding: 0 24rpx; display: grid; grid-template-columns: 1fr 1fr; gap: 14rpx; }
.product-card { padding: 15rpx; border: 1rpx solid #e1eae7; border-radius: 15rpx; background: #fff; }
.product-image { height: 190rpx; display: flex; align-items: center; justify-content: center; border-radius: 11rpx; background: linear-gradient(145deg,#f3f8f6,#e8f1ed); }
.product-card text { display: block; }.grid-name { margin-top: 13rpx; font-size: 24rpx; font-weight: 600; }.grid-spec { margin-top: 5rpx; color: #71827c; font-size:max(12px, 19rpx); }
.grid-price { margin-top: 11rpx; display: flex; align-items: center; justify-content: space-between; }.grid-price text { color: #d85e52; font-size: 24rpx; font-weight: 700; }.grid-price button { width: 38rpx; height: 38rpx; padding: 0; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #08705a; font-size: 24rpx; }
.delivery-banner { height: 126rpx; margin: 20rpx 24rpx 2rpx; padding: 0 28rpx; display: flex; align-items: center; justify-content: space-between; overflow: hidden; border-radius: 15rpx; background: linear-gradient(115deg,#e8f4f0,#c6e1d9); }
.delivery-banner text,.delivery-banner .ui-small { display: block; }.delivery-banner > view > text { color: #07543f; font-size: 26rpx; font-weight: 700; }.delivery-banner .ui-small { margin-top: 7rpx; color: #557a70; font-size:max(12px, 19rpx); }
.delivery-truck { width: 100rpx; height: 82rpx; display: grid; place-items: center; }
.recommend-list { overflow: hidden; }.recommend-list :deep(.product-row:last-child) { border-bottom: 0; }
.unavailable{opacity:.58;cursor:not-allowed}.remove-item{display:inline-block!important;margin-top:8rpx;color:#a45b50!important;font-size:max(12px, 18rpx)!important}.cart-settle button:disabled{opacity:.45}.empty-state{min-height:300rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12rpx;color:#82908b}

.category-layout { display: grid; grid-template-columns: 176rpx 1fr; }
.category-side { height: 100%; background: #eef2f0; }.category-side view { position: relative; height: 105rpx; display: flex; align-items: center; justify-content: center; color: #687a74; font-size:max(12px, 23rpx); }
.category-side view.active { color: #07543f; background: #fff; font-weight: 700; }.category-side view.active::before { content: ""; position: absolute; left: 0; width: 6rpx; height: 46rpx; border-radius: 0 5rpx 5rpx 0; background: #16765f; }
.category-products { height: 100%; background: #f6f7f3; }.category-heading { height: 72rpx; padding: 0 19rpx; display: flex; align-items: center; justify-content: space-between; }.category-heading text { font-size: 25rpx; font-weight: 600; }.category-heading .ui-small { color: #83918c; font-size:max(12px, 18rpx); }
.category-card { margin: 0 15rpx; overflow: hidden; border-radius: 15rpx; border: 1rpx solid #e2e9e6; }
.shipping-tip { min-height: 86rpx; margin: 16rpx; padding: 14rpx 18rpx; display: grid; grid-template-columns: 32rpx 1fr; align-items: center; border-radius: 12rpx; color: #136650; background: #e2f0eb; font-size:max(12px, 21rpx); }.shipping-tip text,.shipping-tip .ui-small { display: block; }.shipping-tip .ui-small { margin-top: 4rpx; color: #71827c; font-size:max(12px, 17rpx); }

.detail-scroll { height: calc(100vh - 260rpx); }.detail-hero { position: relative; height: 560rpx; display: flex; align-items: center; justify-content: center; overflow: hidden; background: linear-gradient(180deg,#eff7f4,#d6e8e2 58%,#f3f7f5); }
.mountain-mist { position: absolute; inset: 0; background: url('/static/mountain-lines.svg') center top/cover no-repeat; opacity: .5; }.detail-hero :deep(.jug-wrap) { z-index: 2; }.image-count { position: absolute; z-index: 3; right: 25rpx; bottom: 20rpx; padding: 6rpx 12rpx; border-radius: 16rpx; color: #fff; background: rgba(7,54,43,.65); font-size:max(12px, 18rpx); }
.card-flat { border-bottom: 1rpx solid #e2e9e6; background: #fff; }.detail-info { padding: 25rpx 28rpx; }.detail-info text { display: block; }.detail-price { color: #07543f; font-size: 41rpx; font-weight: 700; }.detail-name { margin-top: 10rpx; font-size: 29rpx; font-weight: 600; }.detail-subtitle { margin-top: 8rpx; color: #71827c; font-size:max(12px, 20rpx); }
.detail-options { margin-top: 14rpx; padding: 0 26rpx; }.detail-options view { min-height: 78rpx; display: flex; align-items: center; justify-content: space-between; border-bottom: 1rpx solid #edf1ef; }.detail-options view:last-child { border-bottom: 0; }.detail-options text { font-size:max(12px, 22rpx); }.detail-options text:last-child { color: #71827c; font-size:max(12px, 20rpx); }
.sku-panel { margin-top: 12rpx; padding: 23rpx 27rpx; background: #fff; }.sku-panel > text { font-size: 24rpx; font-weight: 600; }.sku-panel view { margin-top: 14rpx; display: flex; gap: 12rpx; }.sku-panel button { margin: 0; padding: 0 22rpx; height: 58rpx; border: 1rpx solid #d5e1dd; border-radius: 8rpx; color: #71827c; background: #fff; font-size:max(12px, 20rpx); }.sku-panel button.active { color: #07543f; border-color: #287d68; background: #e8f2ee; }
.quality-row { margin-top: 14rpx; height: 120rpx; display: grid; grid-template-columns: repeat(3,1fr); }.quality-row view { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8rpx; color: #07543f; }.quality-row .ui-small { color: #4d635c; font-size:max(12px, 19rpx); }
.mini-products { padding: 0 0 14rpx 24rpx; white-space: nowrap; }.mini-product { width: 210rpx; margin-right: 12rpx; padding: 15rpx; display: inline-flex; vertical-align: top; flex-direction: column; align-items: center; border: 1rpx solid #e0e9e5; border-radius: 14rpx; background: #fff; }
.mini-product text,.mini-product .ui-small,.mini-product .ui-bold { width: 100%; display: block; }.mini-product text { margin-top: 8rpx; overflow: hidden; font-size:max(12px, 21rpx); font-weight: 600; text-overflow: ellipsis; }.mini-product .ui-small { margin-top: 4rpx; color: #71827c; font-size:max(12px, 17rpx); }.mini-product .ui-bold { margin-top: 7rpx; color: #d85e52; font-size:max(12px, 21rpx); }
.detail-description { margin-top: 12rpx; padding: 25rpx 28rpx 130rpx; background: #fff; }.detail-description > text { font-size: 25rpx; font-weight: 600; }.detail-description .ui-paragraph { color: #71827c; font-size:max(12px, 21rpx); line-height: 1.75; }
.detail-actions { position: fixed; z-index: 40; left: 0; right: 0; bottom: 0; height: calc(112rpx + env(safe-area-inset-bottom)); padding: 12rpx 18rpx env(safe-area-inset-bottom); display: grid; grid-template-columns: 74rpx 74rpx 1fr 1fr; align-items: center; gap: 10rpx; border-top: 1rpx solid #dce5e2; background: #fff; }
.action-mini { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4rpx; }.action-mini .ui-small { font-size:max(12px, 17rpx); }.action-mini .ui-i { position: absolute; right: 2rpx; top: -5rpx; width: 25rpx; height: 25rpx; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #d6574b; font-size:max(12px, 14rpx); font-style: normal; }
.outline-button,.solid-button { height: 72rpx; margin: 0; border-radius: 36rpx; font-size:max(12px, 23rpx); }.outline-button { color: #07543f; border: 1rpx solid #287d68; background: #fff; }.solid-button { color: #fff; background: #07543f; }

.cart-scroll { height: calc(100vh - 352rpx - env(safe-area-inset-bottom)); }.station-cart { margin: 14rpx 20rpx; overflow: hidden; border: 1rpx solid #dfe8e5; border-radius: 16rpx; background: #fff; }
.station-head { height: 78rpx; padding: 0 18rpx; display: flex; align-items: center; gap: 12rpx; border-bottom: 1rpx solid #edf1ef; font-size:max(12px, 22rpx); font-weight: 600; }.station-head .ui-small { margin-left: auto; color: #71827c; font-size:max(12px, 17rpx); font-weight: 400; }
.check { width: 32rpx; height: 32rpx; display: grid; place-items: center; border: 2rpx solid #c7d5d0; border-radius: 50%; color: transparent; font-size:max(12px, 18rpx); }.check.active { color: #fff; border-color: #08705a; background: #08705a; }
.cart-item { min-height: 152rpx; padding: 17rpx; display: grid; grid-template-columns: 34rpx 94rpx 1fr 130rpx; align-items: center; gap: 12rpx; border-bottom: 1rpx solid #edf1ef; }.cart-item:last-child { border-bottom: 0; }.cart-item .ui-strong,.cart-item .ui-small,.cart-item .ui-bold { display: block; }.cart-item .ui-strong { font-size:max(12px, 22rpx); }.cart-item .ui-small { margin-top: 6rpx; color: #71827c; font-size:max(12px, 18rpx); }.cart-item .ui-bold { margin-top: 10rpx; color: #d85e52; font-size:max(12px, 21rpx); }
.stepper { height: 50rpx; display: grid; grid-template-columns: repeat(3,1fr); align-items: center; border: 1rpx solid #d8e2de; border-radius: 7rpx; }.stepper button { height: 48rpx; padding: 0; background: #f6f8f7; font-size:max(12px, 23rpx); }.stepper text { text-align: center; font-size:max(12px, 20rpx); }.cart-recommend { padding-bottom: 34rpx; }
.cart-settle { position: fixed; z-index: 41; left: 0; right: 0; bottom: calc(112rpx + env(safe-area-inset-bottom)); height: 102rpx; padding: 12rpx 18rpx; display: grid; grid-template-columns: 34rpx 55rpx 1fr 190rpx; align-items: center; gap: 9rpx; border-top: 1rpx solid #dce5e2; background: #fff; font-size:max(12px, 19rpx); }.cart-settle > view:nth-child(3) { text-align: right; }.cart-settle .ui-small { font-size:max(12px, 18rpx); }.cart-settle .ui-strong { color: #07543f; font-size: 28rpx; }.cart-settle > view > text { display: block; color: #d85e52; font-size:max(12px, 15rpx); }.cart-settle button { height: 72rpx; border-radius: 36rpx; color: #fff; background: #07543f; font-size:max(12px, 22rpx); }

.search-page-bar { height: 82rpx; padding: 8rpx 22rpx 12rpx; display: grid; grid-template-columns: minmax(0,1fr) 112rpx; gap: 12rpx; background: #fff; }.search-page-bar > view { height: 62rpx; padding: 0 18rpx; display: grid; grid-template-columns: 30rpx 1fr 30rpx; align-items: center; border-radius: 31rpx; background: #f1f4f3; }.search-page-bar input { font-size:max(12px, 21rpx); }.search-page-bar button { width: 112rpx; height: 62rpx; margin: 0; padding: 0; border-radius: 31rpx; color: #fff; background: #08705a; font-size:max(12px, 21rpx); }
.search-scroll { height: calc(100vh - 218rpx); }.recent-search { padding-bottom: 22rpx; background: #fff; }.chips { padding: 0 27rpx; display: flex; flex-wrap: wrap; gap: 12rpx; }.chips text { padding: 12rpx 20rpx; border-radius: 26rpx; color: #52655f; background: #f0f3f2; font-size:max(12px, 19rpx); }.search-results { overflow: hidden; }
.empty-state { padding: 140rpx 0; display: flex; flex-direction: column; align-items: center; color: #82908b; }.empty-state > text { font-size: 72rpx; opacity: .5; }.empty-state .ui-strong { margin-top: 22rpx; font-size: 24rpx; }.empty-state .ui-small { margin-top: 8rpx; font-size:max(12px, 19rpx); }

.profile-hero { position: relative; height: calc(var(--mobile-header-height, 44px) + 194rpx); overflow: hidden; color: #fff; background: linear-gradient(145deg,#0b6f5b,#064536); }.profile-lines { position: absolute; inset: 45rpx -10% 0; background: url('/static/mountain-lines.svg') center/cover no-repeat; filter: brightness(3); opacity: .18; }
.profile-user { position: relative; z-index: 3; padding: 32rpx 30rpx; display: grid; grid-template-columns: 96rpx 1fr 30rpx; align-items: center; gap: 18rpx; }.profile-avatar { width: 90rpx; height: 90rpx; display: grid; place-items: center; border: 4rpx solid rgba(255,255,255,.72); border-radius: 50%; color: #07543f; background: linear-gradient(145deg,#e5efeb,#a9c9bf); font-size: 32rpx; font-weight: 700; }
.profile-user text,.profile-user .ui-small { display: block; }.profile-user view > text { font-size: 29rpx; font-weight: 600; }.profile-user .ui-small { margin-top: 8rpx; color: rgba(255,255,255,.75); font-size:max(12px, 20rpx); }.profile-arrow { font-size: 44rpx; }
.profile-content { height: calc(100vh - var(--mobile-header-height, 44px) - 236rpx - env(safe-area-inset-bottom)); margin-top: -70rpx; position: relative; z-index: 5; }.member-progress { position: relative; min-height: 118rpx; padding: 20rpx 22rpx; display: flex; align-items: flex-start; justify-content: space-between; }.member-progress text,.member-progress .ui-small { display: block; }.member-progress > view > text { font-size:max(12px, 23rpx); font-weight: 600; }.member-progress .ui-small { margin-top: 8rpx; color: #71827c; font-size:max(12px, 18rpx); }.member-progress > text { color: #64766f; font-size:max(12px, 18rpx); }
.progress { position: absolute; left: 22rpx; right: 22rpx; bottom: 16rpx; height: 7rpx; overflow: hidden; border-radius: 4rpx; background: #e1e9e6; }.progress .ui-i { display: block; width: 58%; height: 100%; background: linear-gradient(90deg,#07543f,#79ae9f); }
.asset-card { height: 130rpx; padding: 17rpx 0; display: grid; grid-template-columns: repeat(3,1fr); }.asset-card view { display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 1rpx solid #e2e9e6; }.asset-card view:last-child { border-right: 0; }.asset-card .ui-strong { color: #17352d; font-size: 31rpx; }.asset-card .ui-small { margin-top: 7rpx; color: #71827c; font-size:max(12px, 18rpx); }
.order-entry { padding-bottom: 18rpx; }.order-entry .section-title { padding: 0 19rpx; }.order-status { display: grid; grid-template-columns: repeat(5,1fr); }.order-status view { position: relative; display: flex; flex-direction: column; align-items: center; gap: 10rpx; }.order-status .ui-small { font-size:max(12px, 17rpx); }.order-status .ui-i { position: absolute; top: -8rpx; right: 18%; width: 25rpx; height: 25rpx; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #d6574b; font-size:max(12px, 14rpx); font-style: normal; }
.profile-menu { overflow: hidden; }.profile-menu view { height: 88rpx; padding: 0 22rpx; display: grid; grid-template-columns: 42rpx 1fr auto 20rpx; align-items: center; gap: 10rpx; border-bottom: 1rpx solid #e7eeeb; font-size:max(12px, 22rpx); }.profile-menu view:last-child { border-bottom: 0; }.profile-menu .ui-small { color: #71827c; font-size:max(12px, 18rpx); }.menu-symbol { justify-self:center; }.menu-arrow{color:#9aa7a2;font-size:31rpx;}
.mobile-toast { position: fixed; z-index: 90; left: 50%; bottom: 180rpx; transform: translateX(-50%); padding: 17rpx 26rpx; border-radius: 10rpx; color: #fff; background: rgba(4,63,49,.92); font-size:max(12px, 21rpx); box-shadow: 0 12rpx 28rpx rgba(7,64,50,.22); }
.catalog-state{min-height:220rpx;padding:30rpx 24rpx}.detail-empty{height:calc(100vh - var(--mobile-header-height, 44px));height:calc(100dvh - var(--mobile-header-height, 44px))}.retry-button{width:220rpx;height:68rpx;margin-top:18rpx;border:1rpx solid #287d68;border-radius:34rpx;color:#07543f;background:#fff;font-size:max(12px, 22rpx)}.profile-error{display:flex;flex-direction:column;align-items:flex-start;gap:8rpx;border:1px solid #d6574b;color:#7a3a31;font-size:max(12px, 22rpx);line-height:1.5}

/* 登录注册 / 推荐码（第三轮） */
.referral-card{display:flex;align-items:center;justify-content:space-between;gap:16rpx;background:linear-gradient(135deg,#fff8e8,#fff)}.referral-card>view{display:flex;flex-direction:column;gap:6rpx}
.screen-home { display: flex; flex-direction: column; }
.screen-home .home-top { flex-shrink: 0; }
.screen-home .page-scroll.with-nav { flex: 1; height: 0; min-height: 0; margin-bottom: calc(112rpx + env(safe-area-inset-bottom)); }
</style>

<style scoped src="./restoration.css"></style>
