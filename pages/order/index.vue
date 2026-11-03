<template>
	<view :style="{ '--mobile-header-height': headerHeight + 'px' }" class="order-page" :class="'screen-' + screen">
		<MobileHeader ref="mobileHeader" @layout="headerHeight = $event" :title="pageTitle" :back="true" @back="goBack" />

		<scroll-view scroll-y class="page-scroll">
      <view v-if="pendingCheckout?.editable&&['confirm','checkout'].includes(screen)" class="card sync-warning" role="status"><text>暂未查到原订单，可调整商品或付款方式后重试；提交时会继续核对原订单，避免重复下单。</text></view>
      <view v-if="pendingCheckout&&!pendingCheckout.editable&&['confirm','checkout'].includes(screen)" class="card sync-warning" role="status">
        <text>原订单{{pendingCheckout.orderId ? ' '+pendingCheckout.orderId : ''}}正在核对，请继续原订单，避免重复下单。</text>
        <text>付款方式：{{pendingCheckout.payload.payment}}。更换商品、地址或付款方式前，请先核对并取消原待付款单；查无订单可返回修改。</text>
        <button :disabled="submitting" data-eventsync="true" @click="submitPayment">继续原订单</button>
        <button :disabled="submitting" @click="confirmCancelPendingCheckout">取消原待付款单并重新选择</button>
      </view>
			<template v-if="screen === 'confirm'">
				<view v-if="!checkoutItems.length" class="empty-orders card"><AppIcon name="order" size="72rpx" tone="muted"/><text class="ui-strong">没有可结算的商品</text><text class="ui-small">请从商品页重新选择，系统不会使用占位商品创建订单</text></view>
				<template v-else>
				<view v-if="accountError" class="card sync-warning" role="alert"><text>账户信息加载失败，余额与收货地址尚未确认</text><text>{{accountError}}</text><button @click="loadAccount">重新加载账户</button></view>
				<view class="address-card card" @click="open('address')">
					<view class="pin"><AppIcon name="pin" size="29rpx" tone="light"/></view>
					<view class="address-main"><view><text class="name">{{account.name || '收货人'}}</text><text class="phone">{{maskedPhone}}</text></view><text class="address">{{account.address || '请填写收货地址'}}</text><text class="hint">{{account.stationName ? `由 ${account.stationName} 配送` : '点击设置收货地址'}}</text></view><text class="chevron">›</text>
				</view>
				<view class="line-row card" @click="chooseWindow"><text>配送时间</text><text class="row-value">{{deliveryWindow}}　›</text></view>
				<view class="card goods-card">
					<text class="section-title">商品清单</text>
					<view class="goods-line" v-for="item in checkoutItems" :key="item.sku"><WaterJug size="small" :label="item.name" :spec="item.spec" :src="item.imageUrl"/><view class="goods-copy"><text class="goods-name">{{item.name}}</text><text class="muted">{{item.spec}}</text><text v-if="ticketUnitsOf(item.sku)" class="ticket-note">水票抵 {{ticketUnitsOf(item.sku)}} 件</text></view><view class="goods-price"><text>¥{{formatAmount(item.price)}}</text><text class="muted">×{{item.qty}}</text></view></view>
					<view class="discount-row"><view><text>商品金额</text></view><text>¥{{ formatAmount(quote ? quote.goodsAmount : grossCents/100) }}</text></view>
					<view class="discount-row" @click="chooseCoupon"><view><AppIcon name="coupon" size="28rpx"/><text>优惠券</text></view><text :class="{'ui-strong':selectedCoupon}">{{ couponLabel }}</text></view>
					<view v-if="couponDiscountCents>0" class="discount-row"><view><text>已优惠</text></view><text class="ui-strong minus">-¥{{ formatAmount(couponDiscountCents/100) }}</text></view>
					<view class="discount-row" @click="toggleTickets"><view><AppIcon name="ticket" size="28rpx"/><text>水票抵扣</text></view><text :class="{'ui-strong':selectedTickets.length}">{{ ticketLabel }}</text></view>
					<view v-if="ticketDiscountCents>0" class="discount-row"><view><text>水票抵扣</text></view><text class="ui-strong minus">-¥{{ formatAmount(ticketDiscountCents/100) }}</text></view>
					<view class="discount-row delivery-fee-row"><view><AppIcon name="truck" size="28rpx"/><text>配送费</text></view><text>{{ deliveryFeeLabel }}</text></view>
					<view v-if="quoteError" class="discount-row quote-error" role="alert"><text>{{ quoteError }}</text><text class="copy-link" @click="refreshQuote">重新计算</text></view>
				</view>
				<view class="line-row card"><text>订单备注</text><input v-model="remark" class="remark-input" placeholder="请填写备注信息（选填）" /></view>
				<view class="card"><text class="section-title">支付方式</text><PayOptions v-if="!pendingCheckout||pendingCheckout.editable" v-model="payMethod" :compact="true" :ticket-only="ticketOnly" :wechat-pay="appConfig.wechatPay" :wechat-pay-message="appConfig.wechatPayMessage" :wechat-blocked-message="wechatBlockedMessage" :simulated-payments="appConfig.simulatedPayments" :balance="Number(account.balance||0)" :payable="Number(checkoutTotal)" /><text v-if="wechatBlockedMessage&&!ticketOnly" class="ui-small">{{wechatBlockedMessage}}</text></view>
				</template>
			</template>

			<template v-else-if="screen === 'checkout'">
				<view class="amount-card card"><text>应付金额</text><text class="big-amount"><text>¥</text>{{checkoutTotal}}</text><text class="pay-countdown">请确认支付方式后完成订单</text></view>
				<view class="card pay-card"><text class="section-title">支付方式</text><PayOptions v-if="!pendingCheckout||pendingCheckout.editable" v-model="payMethod" :ticket-only="ticketOnly" :wechat-pay="appConfig.wechatPay" :wechat-pay-message="appConfig.wechatPayMessage" :wechat-blocked-message="wechatBlockedMessage" :simulated-payments="appConfig.simulatedPayments" :balance="Number(account.balance||0)" :payable="Number(checkoutTotal)" /></view>
				<view class="safe-note"><AppIcon name="shield" size="24rpx"/> 山泉到家 · 订单进度实时同步</view>
			</template>

			<template v-else-if="screen === 'success'">
				<view class="success-panel">
					<view class="success-icon">✓</view><text class="success-title">{{ currentOrder?.payment==='货到付款' ? '下单成功' : '支付成功' }}</text><text class="muted">{{ currentOrder?.payment==='货到付款' ? '货到付款订单已提交，送达时请向送水员付款' : '订单已提交，感谢您的信任！' }}</text>
					<view class="delivery-window"><text>预计送达时间</text><text class="ui-strong">{{currentOrder?.deliveryWindow || '按水站排单尽快送达'}}</text><text>我们将准时为您送达，请保持电话畅通</text></view>
					<view class="success-detail"><view><text>订单编号</text><text>{{currentOrder?.id || '正在生成'}}</text></view><view><text>下单时间</text><text>{{formatDateTime(currentOrder?.createdAt)}}</text></view><view><text>支付方式</text><text>{{currentOrder?.payment || '微信支付'}}</text></view><view v-if="Number(currentOrder?.deliveryFee||0)>0"><text>配送费</text><text>¥{{formatAmount(currentOrder?.deliveryFee)}}</text></view><view v-if="Number(currentOrder?.discount||0)>0"><text>优惠券抵扣</text><text class="minus">-¥{{formatAmount(currentOrder?.discount)}}</text></view><view><text>实付金额</text><text class="minus">¥{{formatAmount(currentOrder?.amount)}}</text></view></view>
					<view class="notify-card"><view class="notify-icon"><AppIcon name="bell" size="31rpx"/></view><view><text>配送进度会实时同步到「我的订单」</text><text class="ui-small">打开订单，随时查看配送进度</text></view><button @click="open('orders')">查看进度</button></view>
				</view>
			</template>

			<template v-else-if="screen === 'orders'">
				<view v-if="ordersError" class="card sync-warning"><text>订单加载失败{{orders.length ? '，以下为上次同步数据' : ''}}</text><text>{{ordersError}}</text><button @click="loadOrders()">重试加载订单</button></view>
				<view v-else-if="ordersLoading&&!ordersLoaded" class="empty-orders">正在加载订单…</view>
				<view class="orders-toolbar"><view class="search-box"><AppIcon name="search" size="27rpx" tone="muted"/><input v-model="orderKeyword" class="search-input" placeholder="搜索订单号/商品" confirm-type="search" /><text v-if="orderKeyword" class="search-clear" @click="orderKeyword=''">×</text></view><button class="aftersale-entry" @click="open('aftersales')">售后进度</button></view>
				<view class="status-tabs"><text v-for="tab in tabs" :key="tab" :class="{active: activeTab===tab}" @click="activeTab=tab">{{tab}}</text></view>
				<view class="order-card card" v-for="item in visibleOrders" :key="item.no" @click="selectOrder(item)">
					<view class="order-head"><text>订单号：{{item.no}}<text v-if="item.orderType==='补送'" class="type-chip">补送单</text></text><text :class="item.color">{{item.status}}</text></view>
					<view class="goods-line"><WaterJug size="small" :label="item.product" :spec="item.spec"/><view class="goods-copy"><text class="goods-name">{{item.product || '--'}}</text><text class="muted">{{(item.items||[]).length>1 ? `${item.items.length} 种商品，共 ${item.qty} 件` : (item.spec || `× ${item.qty}`)}}</text></view><text class="order-price">¥{{item.amount}}</text></view>
					<view class="order-foot"><text>下单时间：{{item.time}}</text><view><button v-if="item.status==='配送中'" disabled>配送中</button><button v-else-if="item.orderType!=='补送'" @click.stop="rebuy(item)">再次购买</button></view></view>
				</view>
				<view class="list-pagination"><text v-if="orderKeyword.trim()">已搜索当前状态的全部 {{ordersTotal}} 单</text><text v-else>已加载 {{orders.length}} / {{ordersTotal}} 单</text><button v-if="ordersHasMore" :disabled="loadingMore" @click="loadMoreOrders">{{ordersLoading||loadMorePending?'加载中…':'加载更多订单'}}</button></view>
				<view v-if="ordersLoaded&&!ordersError&&!visibleOrders.length" class="empty-orders"><AppIcon name="order" size="72rpx" tone="muted"/><text class="ui-strong">{{orderKeyword ? '没有匹配的订单' : '暂无订单'}}</text><text class="ui-small">{{orderKeyword ? '换个关键词试试' : '去首页挑一桶好水吧'}}</text></view>
			</template>
			<template v-else-if="screen === 'aftersales'">
				<view v-if="aftersalesError" class="card sync-warning"><text>售后进度加载失败{{aftersales.length ? '，以下为上次同步数据' : ''}}</text><button @click="loadAftersales">重试加载售后</button></view>
				<view v-for="item in aftersales" :key="item.id" class="card aftersale-result">
					<view class="order-head"><text>{{item.type}} · {{item.id}}</text><text>{{item.status}}</text></view>
					<text>订单：{{item.orderId}}</text><text v-if="item.type!=='补送'">申请金额：¥{{formatAmount(item.amount)}}</text><text v-if="(item.items||[]).length">{{item.type==='补送'?'补送':'退货'}}商品：{{item.items.map(line=>`${line.product||line.skuCode}×${line.quantity}`).join('、')}}</text><text>申请原因：{{item.reason}}</text>
					<text v-if="item.resolution">处理说明：{{item.resolution}}</text>
					<text v-if="item.replacementOrderId">补送单 {{item.replacementOrderId}}：{{item.replacementStatus || '处理中'}}{{item.replacementDispatchStatus&&item.replacementStatus!=='已完成' ? ` · ${item.replacementDispatchStatus}` : ''}}</text>
					<text v-if="item.refundProcessingState&&item.status!=='已完成'">{{refundProgressLabel(item.refundProcessingState)}}</text>
					<text v-if="item.completedAt">完成时间：{{formatDateTime(item.completedAt)}}</text>
				</view>
				<view v-if="aftersalesLoaded&&!aftersalesError&&!aftersales.length" class="empty-orders">暂无售后申请</view>
			</template>

			<template v-else-if="screen === 'detail'">
				<template v-if="selectedOrder">
				<view class="detail-hero"><view><text class="detail-state">{{selectedOrder?.fulfillmentHoldReason ? '暂停配送' : (selectedOrder?.status || '待配送')}}</text><text>{{orderStatusNote}}</text></view><view class="scooter"><AppIcon name="truck" size="72rpx" tone="light"/></view></view>
				<view class="courier card"><view class="avatar">{{(selectedOrder?.courierName || '待').slice(0,1)}}</view><view><text class="name">{{selectedOrder?.courierName || '等待后台派单'}}</text><text class="muted">{{selectedOrder?.dispatchStatus || '待派单'}}{{selectedOrder?.courierPhone ? ` · ${selectedOrder.courierPhone}` : ''}}</text></view><button :class="{disabled:!selectedOrder?.courierPhone}" @click="callCourier"><AppIcon name="phone" size="30rpx" tone="light"/></button></view>
				<view class="card detail-address"><view class="detail-contact"><AppIcon name="pin" size="27rpx"/><text>{{selectedOrder?.customer || '客户'}}　{{selectedOrder?.phone || ''}}</text></view><text class="ui-strong">{{selectedOrder?.address || '地址待同步'}}</text><text class="ui-small">{{selectedOrder?.station || '所属水站'}}</text></view>
				<view v-if="selectedOrder.orderType==='补送'" class="card order-info"><view><text>补送单</text><text>原订单 {{selectedOrder.sourceOrderId}} · 售后 {{selectedOrder.aftersaleId}}</text></view><text class="ui-small">补送商品免费配送，签收后售后自动完成。</text></view>
				<view class="card"><text class="section-title">商品清单</text><view class="goods-line" v-for="line in detailLines" :key="line.lineNo"><WaterJug size="small" :label="line.product" :spec="line.spec"/><view class="goods-copy"><text class="goods-name">{{line.product || '--'}}</text><text class="muted">{{line.spec || '--'}}{{line.ticketQuantity ? ` · 水票抵 ${line.ticketQuantity} 件` : ''}}</text></view><text>×{{line.quantity}}　¥{{formatAmount(line.amount)}}</text></view><view class="summary"><text>商品金额</text><text>¥{{formatAmount(selectedOrder.goodsAmount || (Number(selectedOrder.amount||0)+Number(selectedOrder.discount||0)+Number(selectedOrder.ticketAmount||0)-Number(selectedOrder.deliveryFee||0)))}}</text><template v-if="Number(selectedOrder.ticketAmount||0)>0"><text>水票抵扣</text><text class="minus">-¥{{formatAmount(selectedOrder.ticketAmount)}}</text></template><template v-if="Number(selectedOrder.discount||0)>0"><text>优惠券</text><text class="minus">-¥{{formatAmount(selectedOrder.discount)}}</text></template><text>配送费</text><text>¥{{formatAmount(selectedOrder.deliveryFee)}}</text><text class="ui-strong">实付金额</text><text class="ui-strong minus">¥{{formatAmount(selectedOrder.amount)}}</text></view></view>
				<view class="card order-info"><view><text>订单编号</text><text @click="copyOrderId">{{selectedOrder?.id || selectedOrder?.no}}　<text class="copy-link">复制</text></text></view><view><text>下单时间</text><text>{{formatDateTime(selectedOrder?.createdAt)}}</text></view><view v-if="selectedOrder?.deliveryWindow"><text>配送时段</text><text>{{selectedOrder.deliveryWindow}}</text></view><view><text>支付方式</text><text>{{selectedOrder?.payment || '微信支付'}}</text></view><view v-if="selectedOrder?.remark"><text>订单备注</text><text>{{selectedOrder.remark}}</text></view><view v-if="selectedOrder?.refundStatus && selectedOrder.refundStatus!=='未退款'"><text>退款状态</text><text>{{selectedOrder.refundStatus}} · ¥{{formatAmount(selectedOrder.refundedAmount)}}</text></view><view v-if="selectedOrder?.completedAt"><text>签收时间</text><text>{{formatDateTime(selectedOrder.completedAt)}}{{selectedOrder.signMethod==='ticket' ? ' · 上门收票' : selectedOrder.signMethod==='scan' ? ' · 签收码' : ''}}</text></view></view>
				<view v-if="selectedOrder.paymentRecoveryStatus" class="card order-info"><view><text>微信款项核对</text><text>{{selectedOrder.paymentRecoveryStatus}}</text></view><text v-if="selectedOrder.paymentRecoveryStatus==='需人工处理'" class="ui-small">请联系水站核对原路退款，请勿重复支付。</text></view>
				<view v-if="selectedOrder.status==='配送中' && selectedOrder.receiptCode" class="card receipt-card"><text class="section-title">签收二维码</text><QrCode :value="String(selectedOrder.receiptCode)" size="300rpx"/><text class="ui-strong">签收码 {{ selectedOrder.receiptCode }}</text><text class="ui-small">收货时出示给当前订单的送水员扫描；请勿提前转发</text></view>
				<view v-if="selectedOrder.fulfillmentHoldReason" class="card order-info"><text>{{selectedOrder.fulfillmentHoldReason}}</text></view>
				<view v-if="selectedOrder?.proofUrl" class="card proof-card"><text class="section-title">送达凭证</text><ProtectedImage class="proof-image" :path="selectedOrder.proofUrl" alt="送达凭证"/></view>
				</template>
				<view v-else class="empty-orders card"><AppIcon name="order" size="72rpx" tone="muted"/><text class="ui-strong">未选择订单</text><text class="ui-small">请返回订单列表选择要查看的订单</text></view>
			</template>

			<template v-else-if="screen === 'refund'">
				<view class="card refund-goods"><WaterJug size="small" :label="selectedOrder?.product" :spec="selectedOrder?.spec"/><view><text class="goods-name">{{selectedOrder?.product || '--'}}</text><text class="muted">订单编号　{{selectedOrder?.id || selectedOrder?.no}}</text><text class="muted">实付 ¥{{formatAmount(selectedOrder?.amount)}}{{Number(selectedOrder?.refundedAmount||0)>0 ? ` · 已退 ¥${formatAmount(selectedOrder.refundedAmount)}` : ''}}</text></view></view>
				<view class="card refund-card"><text class="section-title">售后类型</text><view v-for="option in refundOptions" :key="option.id" class="radio-line" :class="{disabled: option.disabled}" @click="pickRefundType(option)"><text :class="{selected: refundType===option.id}">●</text><view><text class="ui-strong">{{option.name}}</text><text class="ui-small">{{option.note}}</text></view></view></view>
				<view v-if="refundType!=='refund'" class="card refund-lines"><text class="section-title">{{refundType==='resend' ? '需要补送的商品' : '退回的商品'}}</text><view v-for="line in refundLines" :key="line.skuCode" class="refund-line"><view class="goods-copy"><text class="goods-name">{{line.product}}</text><text class="muted">{{line.spec}} · {{refundType==='return' ? '剩余可退' : '购买'}} {{line.max}} 件</text></view><view class="stepper"><button :disabled="refundLocked || line.quantity<=0" @click="changeRefundLine(line,-1)">－</button><text>{{line.quantity}}</text><button :disabled="refundLocked || line.quantity>=line.max" @click="changeRefundLine(line,1)">＋</button></view></view></view>
				<view v-if="refundRuleNote || refundPending" class="card refund-rule"><text v-if="refundRuleNote">{{refundRuleNote}}</text><text v-if="refundPending">已有进行中的退款申请，请在售后记录查看处理进度，处理后再申请。</text></view>
				<view class="card"><text class="section-title">{{refundType==='resend' ? '补送原因' : '退款原因'}}</text><view class="reason-tags"><text v-for="reason in reasons" :key="reason" :class="{active: refundReason===reason}" @click="refundReason=reason">{{reason}}</text></view><view v-if="refundType!=='resend'" class="refund-amount"><text>申请金额（最多 ¥{{formatAmount(refundableAmount)}}）</text><input v-model="refundAmount" class="refund-amount-input" type="digit" :disabled="refundLocked" placeholder="0.00" /></view></view>
				<view class="card"><text class="section-title">问题描述</text><textarea v-model="refundDesc" maxlength="200" placeholder="请详细描述您遇到的问题，便于我们尽快处理"/><view class="upload-row"><view v-for="(path,index) in refundImages" :key="path" class="upload-thumb"><image :src="path" mode="aspectFill"/><text class="remove" @click.stop="refundImages.splice(index,1)">×</text></view><view v-if="refundImages.length<3" class="upload" @click="chooseRefundImages">＋<text class="ui-small">上传凭证</text></view></view><text class="ui-small">最多 3 张，仅支持 JPG/PNG/WebP，单张不超过 2MB</text></view>
			</template>
			<template v-if="screen === 'address'">
				<view class="card address-form"><text class="section-title">收货信息</text><view class="form-line"><text>收货人</text><input v-model="addressForm.name" maxlength="20" placeholder="请输入收货人姓名" /></view><view class="form-line"><text>手机号</text><input v-if="account.wechatOnly" v-model="addressForm.contactPhone" type="number" maxlength="11" placeholder="请输入配送联系电话" /><text v-else class="muted">{{account.phone || '--'}}（如需修改请联系水站）</text></view><view class="form-line"><text>所属水站</text><picker v-if="!account.stationId" :range="addressStations" range-key="name" :value="addressForm.stationIndex" @change="addressForm.stationIndex=Number($event.detail.value)"><text>{{addressStations[addressForm.stationIndex]?.name || '请选择配送水站'}} ›</text></picker><text v-else class="muted">{{account.stationName}}</text><button v-if="!account.stationId && !addressStations.length" @click="loadAddressStations">重新加载水站</button></view><view class="form-line column"><text>详细地址</text><textarea v-model="addressForm.address" maxlength="120" placeholder="小区、楼栋、单元、门牌号" /></view></view>
				<text class="ui-small address-tip">地址保存后会作为后续所有订单的默认收货地址</text>
			</template>
		</scroll-view>

		<view v-if="screen==='confirm'" class="bottom-action"><view>合计：<text class="ui-strong">¥{{checkoutTotal}}</text></view><button :disabled="!checkoutItems.length||!quote||quoteLoading" @click="open('checkout')">{{quoteLoading&&!quote ? '计算中…' : '提交订单'}}</button></view>
		<view v-else-if="screen==='checkout'" class="single-action"><button :disabled="submitting" data-eventsync="true" @click="submitPayment">{{submitting ? '正在同步订单…' : `确认支付 ¥${checkoutTotal}`}}</button></view>
		<view v-else-if="screen==='success'" class="double-action"><button class="ghost" @click="goShop">返回首页</button><button @click="open('orders')">查看订单</button></view>
		<view v-else-if="screen==='detail' && selectedOrder" class="double-action"><button v-if="canConfirmReceipt" class="ghost" :disabled="submitting" @click="confirmSelectedReceipt">确认收货</button><button v-else-if="canCancelOrder" class="ghost" :disabled="submitting" @click="cancelSelectedOrder">取消订单</button><button v-else class="ghost" @click="callStation">联系水站</button><button v-if="selectedOrder.status==='待付款'" :disabled="submitting" @click="paySelectedOrder">继续支付</button><button v-else-if="canApplyAftersale" @click="open('refund')">申请售后</button><button v-else disabled>{{detailStatusLabel}}</button></view>
		<view v-else-if="screen==='refund'" class="single-action"><button :disabled="submitting || refundPending" data-eventsync="true" @click="submitRefund">{{submitting ? '正在提交…' : refundPending ? '退款处理中' : '提交申请'}}</button></view>
		<view v-else-if="screen==='address'" class="single-action"><button :disabled="submitting" @click="saveAddress">{{submitting ? '保存中…' : '保存地址'}}</button></view>
	</view>
</template>

<script>
import MobileHeader from '../../components/MobileHeader.vue'
import WaterJug from '../../components/WaterJug.vue'
import PayOptions from '../../components/PayOptions.vue'
import AppIcon from '../../components/AppIcon.vue'
import QrCode from '../../components/QrCode.vue'
import ProtectedImage from '../../components/ProtectedImage.vue'
import { waterApi } from '../../services/waterApi.js'
import { chooseFromList } from '../../services/actionSheet.js'
import { compressIfLarge } from '../../services/imageFiles.js'

const PAPER_TICKET_SPEC = /18\.9L/i

export default {
	components: { MobileHeader, WaterJug, PayOptions, AppIcon, QrCode, ProtectedImage },
	data() {
		return { headerHeight: 44, readRevisions: {}, readEpoch: 0, 
			screen: 'confirm', remark: '', payMethod: 'cod', activeTab: '全部', refundType: 'refund', refundReason: '商品破损', refundDesc: '', refundAmount: '', refundLines: [], checkout:null,
			tabs: ['全部','待付款','待配送','配送中','已完成','已取消'], reasons: ['商品破损','商品错发','少送漏送','商品质量问题','其他原因'],
			currentOrder: null, selectedOrder: null, selectionRevision:0, pageDisposed:false, submitting: false, refreshTimer: null, paymentRequestId: '', pendingCheckout: null, accountSession: null, paymentPending: false, entryScreen: '', accountError: '',
			coupons: [], selectedCouponId: '', availableTickets: [], useTickets: false, quote: null, quoteLoading: false, quoteError: '', quoteSeq: 0,
			appConfig: { demoAuth: false, simulatedPayments: false, wechatLogin: false, wechatPay: false, wechatPayMessage: '', subscribeTemplates: {} }, account: { id: '', name: '', phone: '', address: '', stationName: '', stationId: '', wechatOnly: false, balance: 0 }, addressStations: [], addressForm: { name: '', address: '', contactPhone: '', stationIndex: 0 }, returnScreen: 'confirm',
			deliveryWindow: '今天 10:00–11:00', deliveryWindows: [], orderKeyword: '', refundImages: [],
			orders: [], ordersPage:0, ordersPageSize:20, ordersTotal:0, ordersRevision:0,ordersReloadPending:false, loadMorePending:false, loadingMore:false, ordersLoading:false, ordersLoaded:false, ordersError:'', aftersales:[], aftersalesLoaded:false, aftersalesError:''
		}
	},
	computed: {
		ordersHasMore(){return !this.orderKeyword.trim()&&this.ordersPage*this.ordersPageSize<this.ordersTotal},
		pageTitle(){ return {confirm:'确认订单',checkout:'收银台',success:'支付成功',orders:'我的订单',detail:'订单详情',refund:'申请售后',aftersales:'售后进度',address:'收货地址'}[this.screen] },
		visibleOrders(){ const keyword=this.orderKeyword.trim(); return this.orders.filter(i=>(this.activeTab==='全部'||i.status===this.activeTab)&&(!keyword||`${i.id}${i.product||''}${i.spec||''}${(i.items||[]).map(line=>line.product).join('')}`.includes(keyword))) },
		maskedPhone(){ const value=String(this.account.phone||''); return value.length===11?`${value.slice(0,3)} ${value.slice(3,7)} ${value.slice(7)}`:value },
		orderStatusNote(){ if(this.selectedOrder?.fulfillmentHoldReason)return this.selectedOrder.fulfillmentHoldReason; if(this.selectedOrder?.orderType==='补送'&&this.selectedOrder?.status==='待配送')return '补送单已生成，正在等待水站派单'; if(this.selectedOrder?.payment==='货到付款'&&this.selectedOrder?.status==='待配送')return '货到付款订单已确认，正在等待水站派单'; return {'待付款':'请尽快完成支付','待配送':'订单已支付，正在等待水站派单','配送中':'师傅正在为您配送，请耐心等待','已完成':'订单已完成，感谢您的信任','已取消':'订单已取消，库存占用已释放'}[this.selectedOrder?.status] || '订单状态正在同步' },
		checkoutItems(){return this.checkout?.items||[]},
		grossCents(){return this.checkoutItems.reduce((sum,item)=>sum+Math.round(Number(item.price||0)*100)*Number(item.qty||0),0)},
		ticketCapacity(){return this.pickTickets(this.availableTickets,this.checkoutItems).length},
		selectedTickets(){return this.useTickets?this.pickTickets(this.availableTickets,this.checkoutItems):[]},
		ticketDiscountCents(){return this.quote?Math.round(Number(this.quote.ticketAmount||0)*100):0},
		netBeforeCouponCents(){return this.quote?Math.round((Number(this.quote.goodsAmount||0)-Number(this.quote.ticketAmount||0))*100):this.grossCents},
		ticketOnly(){return Boolean(this.quote)&&Number(this.quote.amount)===0&&Number(this.quote.ticketAmount)>0},
		ticketLabel(){if(this.selectedTickets.length)return `已用 ${this.selectedTickets.length} 张，点击取消`;if(this.ticketCapacity)return `${this.ticketCapacity} 张可用，点击使用`;return '暂无适用水票'},
		applicableCoupons(){return this.coupons.filter(c=>c.customerCouponId&&c.customerStatus==='未使用'&&c.status==='启用'&&this.netBeforeCouponCents>1&&(c.type!=='满减券'||this.netBeforeCouponCents>=Math.round(Number(c.minimum||0)*100)))},
		selectedCoupon(){return this.applicableCoupons.find(c=>c.customerCouponId===this.selectedCouponId)||null},
		couponDiscountCents(){return this.quote&&this.selectedCoupon?Math.round(Number(this.quote.discount||0)*100):0},
		couponLabel(){if(this.selectedCoupon)return `${this.selectedCoupon.name} -¥${(this.couponDiscountCents/100).toFixed(2)}`;return this.applicableCoupons.length?`${this.applicableCoupons.length} 张可用 ›`:'暂无可用优惠券'},
		deliveryFeeLabel(){if(!this.quote)return this.quoteLoading?'计算中…':'--';const fee=Number(this.quote.deliveryFee||0);const rule=this.quote.deliveryRule||{};if(fee>0)return Number(rule.freeOver)>0?`¥${fee.toFixed(2)}（满 ¥${Number(rule.freeOver).toFixed(2)} 免）`:`¥${fee.toFixed(2)}`;if(Number(rule.fee)>0)return Number(this.quote.goodsAmount)===Number(this.quote.ticketAmount)?'水票订单免配送费':'已满额，免配送费';return '免配送费'},
		checkoutTotal(){if(this.pendingCheckout&&!this.pendingCheckout.editable&&this.pendingCheckout.amount!==undefined)return Number(this.pendingCheckout.amount).toFixed(2);return this.quote?Number(this.quote.amount||0).toFixed(2):(this.grossCents/100).toFixed(2)},
		detailLines(){const order=this.selectedOrder;if(!order)return [];if(Array.isArray(order.items)&&order.items.length)return order.items;return [{lineNo:1,skuCode:order.skuCode||'',product:order.product,spec:order.spec,unitPrice:Number(order.amount||0),quantity:order.quantity||order.qty||0,amount:Number(order.amount||0),ticketQuantity:0}]},
		refundOptions(){const order=this.selectedOrder||{};const ticketOrder=Number(order.ticketAmount||0)>0,zeroReturn=order.aftersalePolicy?.allowZeroAmountReturn===true;const delivered=order.status==='已完成';return [{id:'refund',name:'仅退款',note:ticketOrder?'使用水票的订单需整单退货以返还水票':zeroReturn?'实付已退，可申请零元退货以退回剩余商品':this.refundWholeRequired?'退还全部剩余实付，不退回商品':'未收到商品或不需要退货',disabled:ticketOrder||zeroReturn},{id:'return',name:'退货退款',note:this.refundWholeRequired?'退回全部剩余商品，水站收回商品后完成退款':'退回所选商品后退款',disabled:false},{id:'resend',name:'补送',note:delivered?'少送或破损，审核后水站免费补送':'订单签收后才能申请补送',disabled:!delivered}]},
		refundWholeRequired(){const policy=this.selectedOrder?.aftersalePolicy;return typeof policy?.wholeRefundRequired==='boolean'?policy.wholeRefundRequired:this.selectedOrder?.status!=='已完成'},
		refundPending(){return this.selectedOrder?.aftersalePolicy?.pendingRefund===true},
		canApplyAftersale(){const order=this.selectedOrder;return order?.payStatus==='已支付'&&order.orderType!=='补送'&&(order.status!=='已取消'||this.refundableAmount>0||order.aftersalePolicy?.allowZeroAmountReturn===true)},
		refundLocked(){return this.refundType!=='resend'&&(this.refundWholeRequired||Number(this.selectedOrder?.ticketAmount||0)>0)},
		refundableAmount(){const order=this.selectedOrder||{},remaining=order.aftersalePolicy?.remainingAmount;return Math.round((typeof remaining==='number'&&Number.isFinite(remaining)&&remaining>=0?remaining:Math.max(0,Number(order.amount||0)-Number(order.refundedAmount||0)))*100)/100},
		refundReturnLines(){const remaining=this.selectedOrder?.aftersalePolicy?.returnItems;return this.detailLines.filter(line=>line.skuCode).map(line=>({...line,quantity:Array.isArray(remaining)?Number(remaining.find(item=>item.skuCode===line.skuCode)?.quantity||0):Number(line.quantity||0)})).filter(line=>line.quantity>0)},
		refundZeroAllowed(){const policy=this.selectedOrder?.aftersalePolicy;return this.refundType==='return'&&this.refundableAmount===0&&(typeof policy?.allowZeroAmountReturn==='boolean'?policy.allowZeroAmountReturn:Number(this.selectedOrder?.ticketAmount||0)>0)},
		refundRuleNote(){if(this.refundType==='resend')return '';const ticket=Number(this.selectedOrder?.ticketAmount||0)>0;if(ticket)return '水票订单须退回全部可退商品，退还全部剩余实付并返还水票；水站收回商品后完成。';if(this.refundWholeRequired)return this.refundType==='return'?'未签收订单仅支持整单退款：退回全部剩余商品，申请金额为全部剩余实付。':'未签收订单仅支持整单退款：申请金额为全部剩余实付，仅退款不退回商品。';return ''},
		/** 与服务端 cancelOrder 一致：待付款；待配送的余额支付、水票支付（退回余额/水票）及未收款的货到付款 */
		canCancelOrder(){if(this.selectedOrder?.fulfillmentHoldReason||this.selectedOrder?.orderType==='补送')return false;return this.selectedOrder?.status==='待付款'||(this.selectedOrder?.status==='待配送'&&(['余额支付','水票支付'].includes(this.selectedOrder?.payment)||(this.selectedOrder?.payment==='货到付款'&&this.selectedOrder?.payStatus==='未支付')))},
		canConfirmReceipt(){return this.selectedOrder?.status==='已完成'&&!this.selectedOrder?.receiptConfirmedAt},
		detailStatusLabel(){const order=this.selectedOrder||{};if(order.status==='已取消')return '订单已取消';if(order.orderType==='补送')return order.status==='已完成'?'补送已签收':'水站安排补送中';if(this.refundPending)return '退款处理中';if(order.fulfillmentHoldReason)return '暂停配送';return {'待配送':'等待配送','配送中':'配送中','已完成':'订单已完成'}[order.status]||'订单处理中'},
		/** 真实微信支付需要账号已绑定微信 openid；未绑定时建单前就禁用，避免订单卡在待付款 */
		wechatPayBlocked(){return Boolean(this.appConfig.wechatPay)&&/** @type {{ wechatBound?: boolean }} */ (this.account).wechatBound===false},
		wechatBlockedMessage(){return this.wechatPayBlocked?'当前账号未绑定微信，请退出后使用“微信登录”再选择微信支付':''}
	},
	watch:{activeTab(){this.resetOrderPages()},orderKeyword(){this.resetOrderPages()}},
	onLoad(query){ this.checkout=this.normalizeCheckout(uni.getStorageSync('mountain-spring-checkout')); if(query && query.screen) this.screen=query.screen;
    // 订阅消息等深链接带订单号进入详情：先回到列表，取到订单后再打开，避免显示“未选择订单”的空白详情
    const deepLinkId=this.screen==='detail'&&query&&query.id?this.decodeQuery(query.id):''; if(deepLinkId) this.screen='orders'
    this.entryScreen=this.screen; const tab=query&&query.tab?this.decodeQuery(query.tab):''; if(tab && this.tabs.includes(tab)) this.activeTab=tab; if(deepLinkId) this.openOrderById(deepLinkId); this.buildDeliveryWindows(); waterApi.getConfig().then(config=>{this.appConfig=config;if((config.wechatPay||config.simulatedPayments)&&this.payMethod==='cod'&&!this.wechatPayBlocked)this.payMethod='wechat'}); this.loadAccount(); if(['confirm','checkout'].includes(this.screen)){this.loadCoupons();this.loadTickets();this.refreshQuote()} if(['orders','detail','aftersales'].includes(this.screen)) this.startSync(); if(this.screen==='address') this.returnScreen='' },
	onShow(){this.$nextTick(() => { const header = /** @type {{ refresh?: () => void }} */ (this.$refs.mobileHeader); header?.refresh?.() }); if(['orders','detail','aftersales'].includes(this.screen)) this.startSync() },
	onUnload(){ this.pageDisposed=true;this.selectionRevision++;this.ordersRevision++;this.ordersReloadPending=false;this.stopSync() },
	methods: {
    invalidateReads(){this.readEpoch++},
    readGuard(key){const epoch=this.readEpoch,revision=(this.readRevisions[key]||0)+1;this.readRevisions[key]=revision;const identity=waterApi.captureSession?.('customer');return ()=>!this.pageDisposed&&epoch===this.readEpoch&&revision===this.readRevisions[key]&&(!identity||waterApi.isCurrentSession(identity))},
		captureSelection(){return {id:this.selectedOrder?.id,revision:this.selectionRevision}},
		isCurrentSelection(selection){return !this.pageDisposed&&selection.revision===this.selectionRevision&&selection.id===this.selectedOrder?.id},
		commitSelection(order,selection){if(!this.isCurrentSelection(selection)||order.id!==selection.id)return null;this.selectionRevision++;this.selectedOrder=this.mapOrder(order);return this.captureSelection()},
        async callStation(){try{const stations=await waterApi.listCatalogStations();const station=stations.find(item=>item.name===(this.selectedOrder?.station||this.account.stationName));const phone=String(station?.phone||'').replace(/[^\d+-]/g,'');if(!phone)return uni.showToast({title:'水站暂未提供联系电话',icon:'none'});uni.makePhoneCall({phoneNumber:phone,fail:error=>{if(!/cancel/i.test(String(error?.errMsg)))uni.showToast({title:'拨号失败，请稍后重试',icon:'none'})}})}catch(error){this.toast(error.message||'水站信息加载失败')}},

		open(name){ this.selectionRevision++;if(name==='address'){ this.returnScreen=this.screen; this.addressForm={name:this.account.name==='微信用户'?'':this.account.name||'',address:this.account.address||'',contactPhone:this.account.phone||'',stationIndex:0}; this.loadAddressStations() } if(name==='refund')this.initRefund(); this.screen=name; uni.pageScrollTo({scrollTop:0,duration:0}); if(['orders','detail','aftersales'].includes(name)) this.startSync(); else this.stopSync() },
		/** 页面入口屏（从首页 navigateTo 打开的订单列表/地址/售后等）返回上一页，而不是跳到页内其他屏 */
		goBack(){ if(this.screen==='confirm'||this.screen==='orders'||this.screen===this.entryScreen) this.leavePage(); else if(this.screen==='address') this.open(this.returnScreen&&this.returnScreen!=='address'?this.returnScreen:'orders'); else this.open({checkout:'confirm',success:'orders',detail:'orders',refund:'detail'}[this.screen]||'orders') },
		leavePage(){ uni.navigateBack({fail:()=>this.goShop()}) },
		/** 兼容旧版单商品结算缓存；新版为 { station, fromCart, items: [...] } */
		normalizeCheckout(saved){ if(Array.isArray(saved?.items)&&saved.items.length){const items=saved.items.filter(item=>item?.sku);return items.length?{station:saved.station||items[0].station,fromCart:Boolean(saved.fromCart),items}:null} if(saved?.sku)return {station:saved.station,fromCart:Boolean(saved.fromCart),items:[saved]}; return null },
		/** 在本地挑选可用水票：电子票抵对应商品，纸质票抵 18.9L 桶装水；最终以服务端报价为准。 */
		pickTickets(available,items){ const capacity=new Map(items.map(item=>[item.sku,Number(item.qty||0)])); const picked=[]; for(const ticket of available.filter(item=>item.type==='电子票')){ const left=capacity.get(ticket.skuCode)||0; if(left>0){ capacity.set(ticket.skuCode,left-1); picked.push({type:ticket.type,code:ticket.code,skuCode:ticket.skuCode}) } } const paperLines=items.filter(item=>PAPER_TICKET_SPEC.test(String(item.spec||''))); for(const ticket of available.filter(item=>item.type==='纸质票')){ const line=paperLines.find(item=>(capacity.get(item.sku)||0)>0); if(!line)break; capacity.set(line.sku,capacity.get(line.sku)-1); picked.push({type:ticket.type,code:ticket.code,skuCode:line.sku}) } return picked },
		ticketUnitsOf(sku){ const line=this.quote?.items?.find(item=>item.skuCode===sku); return line?Number(line.ticketQuantity||0):0 },
		async refreshQuote(){ const current=this.readGuard('quote');const items=this.checkout?.items||[]; if(!items.length){this.quote=null;return} const seq=++this.quoteSeq; this.quoteLoading=true; try{ const quote=await waterApi.previewOrder({items:items.map(item=>({sku:item.sku,quantity:Number(item.qty||1)})),tickets:this.selectedTickets,customerCouponId:this.selectedCouponId||undefined}); if(!current()||seq!==this.quoteSeq)return; this.quote=quote; this.quoteError=''; for(const item of items){const line=quote.items.find(entry=>entry.skuCode===item.sku);if(line)item.price=line.unitPrice} if(this.ticketOnly)this.payMethod='ticket'; else if(this.payMethod==='ticket')this.payMethod=(this.appConfig.wechatPay||this.appConfig.simulatedPayments)&&!this.wechatPayBlocked?'wechat':'cod' }catch(error){ if(!current()||seq!==this.quoteSeq)return; this.quote=null; this.quoteError=error.message||'订单金额计算失败，请重试'; if(this.selectedCouponId&&/优惠券|满减/.test(this.quoteError)){this.selectedCouponId='';this.refreshQuote()} }finally{ if(seq===this.quoteSeq)this.quoteLoading=false } },
		buildDeliveryWindows(){ const slots=['10:00–11:00','14:00–15:00','16:00–17:00']; const hour=new Date().getHours(); const today=slots.filter(slot=>Number(slot.slice(0,2))>hour+1).map(slot=>`今天 ${slot}`); const tomorrow=['09:00–10:00',...slots].map(slot=>`明天 ${slot}`); this.deliveryWindows=[...today,...tomorrow]; this.deliveryWindow=this.deliveryWindows[0] },
		chooseWindow(){ const windows=[...this.deliveryWindows]; chooseFromList(windows).then(index=>{ if(index>=0) this.deliveryWindow=windows[index] }).catch(error=>this.toast(error.message)) },
		async loadAccount(){const current=this.readGuard('loadAccount'); try{ const account=await waterApi.getAccount();if(!current())return;if(this.account.id&&this.account.id!==account.id){this.pendingCheckout=null;this.paymentRequestId='';this.selectedCouponId='';this.useTickets=false;this.availableTickets=[];this.coupons=[]}this.account=account;this.accountSession=waterApi.captureSession?.('customer'); this.accountError=''; if(['confirm','checkout'].includes(this.screen))this.restorePendingCheckout(); if(this.wechatPayBlocked&&this.payMethod==='wechat') this.payMethod='cod'; if(this.screen==='address'&&!this.addressForm.name&&!this.addressForm.address) this.addressForm={name:this.account.name==='微信用户'?'':this.account.name||'',address:this.account.address||'',contactPhone:this.account.phone||'',stationIndex:0}; if(this.screen==='address')this.loadAddressStations() }catch(error){if(!current()||error?.code==='STALE_SESSION')return; if(error?.code!=='AUTH_REQUIRED') this.accountError=error.message||'请检查网络后重试'; console.warn('[account-sync]',error.message) } },
		async loadTickets(){const current=this.readGuard('loadTickets');const skus=(this.checkout?.items||[]).map(item=>item.sku);if(!skus.length){this.availableTickets=[];this.useTickets=false;return}try{const tickets=await waterApi.listAvailableTickets(skus.join(','));if(!current())return;this.availableTickets=tickets}catch(error){if(!current()||error?.code==='STALE_SESSION')return;this.availableTickets=[];this.useTickets=false;console.warn('[ticket-sync]',error.message)}},
		toggleTickets(){if(!this.ticketCapacity)return this.toast('当前商品暂无适用水票');this.useTickets=!this.useTickets;this.selectedCouponId='';this.refreshQuote()},
		async loadAddressStations(){if(!this.account.wechatOnly||this.account.stationId)return;try{this.addressStations=await waterApi.listCatalogStations()}catch(error){this.toast(error.message||'水站加载失败')}} ,
		async saveAddress(){ if(this.submitting)return; const name=this.addressForm.name.trim(); const address=this.addressForm.address.trim(); if(!name)return this.toast('请填写收货人'); if(address.length<4)return this.toast('请填写详细收货地址'); if(this.account.wechatOnly&&!/^1[3-9]\d{9}$/.test(this.addressForm.contactPhone||''))return this.toast('请填写正确的配送联系电话'); if(this.account.wechatOnly&&!this.account.stationId&&!this.addressStations[this.addressForm.stationIndex]?.id)return this.toast('请选择配送水站'); this.submitting=true; try{ this.account=await waterApi.updateAccount({name,address,...(this.account.wechatOnly?{contactPhone:this.addressForm.contactPhone}:{}),...(this.account.wechatOnly&&!this.account.stationId?{stationId:this.addressStations[this.addressForm.stationIndex]?.id}:{})}); if(this.checkout){this.checkout.station=this.account.stationName;this.checkout.items.forEach(item=>{item.station=this.account.stationName});uni.setStorageSync('mountain-spring-checkout',this.checkout);this.refreshQuote();this.loadTickets();this.loadCoupons()} this.toast('收货地址已保存'); setTimeout(()=>this.goBack(),500) }catch(error){ this.toast(error.message) }finally{ this.submitting=false } },
		rebuy(item){ const lines=(Array.isArray(item.items)?item.items:[]).filter(line=>line.skuCode); if(!lines.length||!item.station)return this.toast('订单商品或水站信息不完整，无法再次购买'); this.checkout={station:item.station,fromCart:false,items:lines.map(line=>({sku:line.skuCode,name:line.product,spec:line.spec,price:line.unitPrice,qty:line.quantity,station:item.station}))}; uni.setStorageSync('mountain-spring-checkout',this.checkout); this.selectedCouponId=''; this.useTickets=false; this.quote=null; this.loadCoupons(); this.loadTickets(); this.refreshQuote(); this.open('confirm') },
		copyOrderId(){ const id=this.selectedOrder?.id||this.selectedOrder?.no; if(!id)return; uni.setClipboardData({data:String(id),success:()=>this.toast('订单号已复制'),fail:()=>uni.showModal({title:'订单号',content:String(id),showCancel:false})}) },
		callCourier(){ const phone=String(this.selectedOrder?.courierPhone||'').replace(/\D/g,''); if(phone.length!==11)return this.toast('派单后可联系送水员'); if(typeof uni.makePhoneCall!=='function')return this.toast(`送水员电话 ${phone}`); uni.makePhoneCall({phoneNumber:phone,fail:error=>{ if(!/cancel/i.test(String(error&&error.errMsg)))this.toast('拨号失败') }}) },
		chooseRefundImages(){ if(typeof uni.chooseImage!=='function')return this.toast('当前环境不支持选择图片'); uni.chooseImage({count:3-this.refundImages.length,sizeType:['compressed'],success:result=>{ const paths=/** @type {string[]} */ ([].concat(result.tempFilePaths||[])); Promise.all(paths.map((path,index)=>compressIfLarge(path,result.tempFiles?.[index]?.size))).then(images=>{ this.refundImages=[...this.refundImages,...images].slice(0,3) }) },fail:error=>{ if(!/cancel/i.test(String(error&&error.errMsg)))this.toast('选择图片失败') }}) },
		goShop(){ uni.reLaunch({url:'/pages/index/index'}) },
		toast(title){ if(waterApi.recentlyToasted?.(title))return; uni.showToast({title,icon:'none'}) },
		formatAmount(value){ return Number(value || 0).toFixed(2) },
		formatDateTime(value){ if(!value)return '刚刚'; const date=new Date(value); return Number.isNaN(date.getTime())?'刚刚':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` },
		mapOrder(order){ return {...order,no:order.id,qty:order.quantity,amount:this.formatAmount(order.amount),time:this.formatDateTime(order.createdAt),color:order.status==='配送中'?'green':order.status==='已完成'?'mint':''} },
		resetOrderPages(){this.ordersRevision++;this.ordersReloadPending=true;this.orders=[];this.ordersPage=0;this.ordersTotal=0;this.ordersLoaded=false;return this.loadOrders()},
		/** 自动同步进行中点“加载更多”不能被静默丢弃，排队到本次同步结束后立即加载下一页；加载更多本身进行中的重复点击仍只执行一次 */
		loadMoreOrders(){if(!this.ordersHasMore)return;if(this.ordersLoading){if(!this.loadingMore)this.loadMorePending=true;return}return this.loadOrders(true)},
		async loadOrders(more=false){
			if(this.ordersLoading)return
			this.ordersLoading=true;this.ordersReloadPending=false;this.loadingMore=more===true
			const current=this.readGuard('orders'),revision=this.ordersRevision, selection=this.captureSelection(), status=this.activeTab==='全部'?undefined:this.activeTab
			try{
				const rows=new Map(), target=Math.max(1,this.ordersPage+(more===true?1:0))
				let total=0,page=0,pageSize=this.ordersPageSize
				if(this.orderKeyword.trim()){
					// The customer API need only support status; search exhausts that status before filtering.
					const all=await waterApi.listOrders({status})
					for(const order of all)rows.set(order.id,order)
					total=all.length;page=Math.ceil(total/pageSize)
				}else{
					// Refresh the loaded range before appending: inserts/removals cannot leave stale page boundaries.
					for(let next=1;next<=target;next++){
						const result=await waterApi.listOrders({status,page:next,pageSize})
						for(const order of result.items)rows.set(order.id,order)
						if(next>1&&total!==result.total)throw new Error('订单列表发生变化，请刷新重试')
						total=result.total;page=next;pageSize=result.pageSize
						if(next*pageSize>=total)break
					}
				}
				if(!this.orderKeyword.trim()&&rows.size!==Math.min(page*pageSize,total))throw new Error('订单列表发生变化，请刷新重试')
				let selected=null
				if(selection.id&&this.isCurrentSelection(selection)){
					try{selected=await waterApi.getOrder(selection.id)}catch(error){if(this.isCurrentSelection(selection))throw error}
				}
				if(!current()||revision!==this.ordersRevision)return
				this.orders=[...rows.values()].map(order=>this.mapOrder(order));this.ordersPage=page;this.ordersPageSize=pageSize;this.ordersTotal=total
				this.ordersLoaded=true;this.ordersError='';if(selected&&this.isCurrentSelection(selection)&&selected.id===selection.id)this.selectedOrder=this.mapOrder(selected)
			}catch(error){if(current()&&revision===this.ordersRevision)this.ordersError=error.message||'请检查网络后重试';console.warn('[order-sync]',error.message)}
			finally{this.ordersLoading=false;this.loadingMore=false;if(this.loadMorePending&&revision===this.ordersRevision){this.loadMorePending=false;await this.loadOrders(true)}else{this.loadMorePending=false;if(this.ordersReloadPending)await this.loadOrders()}}
		},
		async loadAftersales(){const current=this.readGuard('loadAftersales');try{const rows=await waterApi.listAftersales();if(!current())return;this.aftersales=rows;this.aftersalesLoaded=true;this.aftersalesError=''}catch(error){if(!current()||error?.code==='STALE_SESSION')return;this.aftersalesError=error.message||'请稍后重试'}},
		refundProgressLabel(state){return {PENDING:'退款任务已记录，等待微信确认',PROCESSING:'微信退款处理中，请勿重复申请',CLOSED:'微信退款已关闭，请联系水站核对',ABNORMAL:'微信退款异常，请联系水站核对',SUCCESS:'微信已确认退款'}[state]||'退款状态待核对'},
		/** 支付进行中（小程序拉起微信收银台返回会触发 onShow）不使当前选择失效，支付结果仍能落到该订单 */
		startSync(){ if(!this.paymentPending)this.selectionRevision++;if(this.ordersLoading)this.ordersReloadPending=true;this.stopSync();const sync=()=>this.screen==='aftersales'?this.loadAftersales():this.loadOrders();sync();this.refreshTimer=setInterval(sync,4000) },
		stopSync(){ if(this.refreshTimer){clearInterval(this.refreshTimer);this.refreshTimer=null} },
		selectOrder(item){ this.selectionRevision++;this.selectedOrder=item;this.open('detail') },
    /** 小程序运行时不会解码页面参数（H5 由路由解码）；解码失败时按原值使用 */
    decodeQuery(value){ try{ return decodeURIComponent(String(value)) }catch{ return String(value) } },
    // 按页面状态判断用户是否已离开：页面加载时的自动同步会递增 selectionRevision，不能用它判断
    openOrderById(id){ waterApi.getOrder(id).then(order=>{ if(this.pageDisposed||this.screen!=='orders'||this.selectedOrder)return; this.selectOrder(this.mapOrder(order)) }).catch(error=>{ if(!this.pageDisposed)this.toast(error.message||'订单加载失败，请在列表中查看') }) },
		async loadCoupons(){const current=this.readGuard('loadCoupons'); try{ const coupons=await waterApi.listCoupons();if(!current())return;this.coupons=coupons }catch(error){if(!current()||error?.code==='STALE_SESSION')return; console.warn('[coupon-sync]',error.message) } },
		chooseCoupon(){ const options=this.applicableCoupons; if(!options.length)return this.toast('暂无可用优惠券'); const items=options.map(c=>`${c.name}（-¥${Number(c.discount).toFixed(2)}）`); items.unshift('不使用优惠券'); chooseFromList(items).then(index=>{ if(index<0)return; this.selectedCouponId=index===0?'':options[index-1].customerCouponId; this.refreshQuote() }).catch(error=>this.toast(error.message)) },
		validatePayment(){if(!this.checkout?.items?.length)throw new Error('没有可结算的商品，请返回商品页重新选择');if(this.accountError)throw new Error('账户信息加载失败，请重新加载账户后再提交');if(!this.account.address||(this.account.wechatOnly&&(!this.account.phone||!this.account.stationId))){this.open('address');throw new Error('请先完善收货信息')};if(!this.checkout.station&&!this.account.stationName)throw new Error('订单配送水站缺失，请重新选择商品');if(!this.quote)throw new Error(this.quoteError||'订单金额正在计算，请稍候');if(this.ticketOnly)return;if(this.payMethod==='ticket')throw new Error('水票未能全额抵扣，请选择剩余金额的支付方式');if(this.payMethod==='wechat'&&!this.appConfig.wechatPay&&!this.appConfig.simulatedPayments)throw new Error(this.appConfig.wechatPayMessage||'微信支付尚未配置，请选择余额支付或货到付款');if(this.payMethod==='wechat'&&this.wechatPayBlocked)throw new Error(this.wechatBlockedMessage);if(this.payMethod==='balance'&&Number(this.account.balance||0)<Number(this.checkoutTotal))throw new Error('账户余额不足，请选择其他支付方式')},
		/** 小程序订阅消息授权必须在点击事件中直接调起；H5 无此能力直接跳过。 */
		requestSubscriptions(keys){return new Promise(resolve=>{const templates=this.appConfig.subscribeTemplates||{};const ids=keys.map(key=>templates[key]).filter(Boolean).slice(0,3);if(!ids.length||typeof uni.requestSubscribeMessage!=='function')return resolve(null);uni.requestSubscribeMessage({tmplIds:ids,success:result=>{const results={};for(const key of keys){const id=templates[key];if(id&&result[id])results[key]=result[id]}waterApi.recordSubscriptions(results).catch(error=>console.warn('[subscribe-sync]',error.message));resolve(results)},fail:()=>resolve(null)})})},
		requestWechatPayment(payParams){return new Promise((resolve,reject)=>{if(typeof uni.requestPayment!=='function')return reject(new Error('当前环境不支持微信支付，请在微信小程序中重试'));uni.requestPayment({provider:'wxpay',...payParams,success:resolve,fail:result=>reject(new Error(/cancel/i.test(String(result?.errMsg||''))?'已取消微信支付':'微信支付未完成，请稍后重试'))})})},
		async waitForPayment(orderId){for(let attempt=0;attempt<12;attempt+=1){const order=await waterApi.getOrder(orderId);if(order.status==='已取消')throw new Error(order.payStatus==='已支付'?'订单已取消，到账款项正在退款核对，请查看订单详情':'订单已取消');if(order.payStatus==='已支付')return order;await new Promise(resolve=>setTimeout(resolve,750))}throw new Error('支付结果仍在确认中，请到订单列表查看最终状态')},
		async settleOrder(order,payment){if(order.payStatus==='已支付'||(payment==='货到付款'&&order.status!=='待付款'))return order;if(payment==='水票支付')return order;if(payment==='微信支付'&&!this.appConfig.simulatedPayments){const payParams=await waterApi.wechatPrepay(order.id);await this.requestWechatPayment(payParams);return this.waitForPayment(order.id)}return waterApi.payOrder(order.id,{payment})},
		finishCheckout() {
			const purchased = this.checkout
			if (purchased?.fromCart) {
				const cart = uni.getStorageSync('mountain-spring-cart')
				if (Array.isArray(cart)) {
					const bought = new Map((purchased.items || []).map(item => [item.sku, Number(item.qty || 0)]))
					const remaining = cart.map(station => {
						if (station.name !== purchased.station || !Array.isArray(station.items)) return station
						const items = station.items.map(item => bought.has(item.sku) ? { ...item, qty: Math.max(0, Number(item.qty) - bought.get(item.sku)) } : item).filter(item => item.qty > 0)
						return { ...station, items, checked: items.length > 0 && items.every(item => item.checked) }
					}).filter(station => station.items?.length)
					uni.setStorageSync('mountain-spring-cart', remaining)
				}
			}
			this.quoteSeq++
			this.checkout = null
			this.quote = null
			uni.removeStorageSync('mountain-spring-checkout')
		},
    checkoutAccountCurrent(){if(this.accountSession&&!waterApi.isCurrentSession(this.accountSession)){this.toast('登录账号已变化，请重新加载账户后继续');this.loadAccount();return false}return true},
    checkoutStorageKey(){const id=this.account.id||waterApi.getProfile?.('customer')?.id;return id?'water_pending_checkout_'+id:''},
    persistPendingCheckout(intent){const key=this.checkoutStorageKey();if(!key)return;const saved=uni.getStorageSync(key);if(saved&&saved.payload?.idempotencyKey!==intent.payload.idempotencyKey)return;if(!saved&&intent.orderId)return;uni.setStorageSync(key,JSON.parse(JSON.stringify(intent)))},
    restorePendingCheckout(){
      const key=this.checkoutStorageKey(),saved=key?uni.getStorageSync(key):null
      if(!saved?.payload?.idempotencyKey||!saved.checkout?.items?.length)return
      this.pendingCheckout=saved;this.paymentRequestId=saved.payload.idempotencyKey
      // A no-order read unlocks editing, but its durable key remains a fence against a late create.
      if(saved.editable){if(!this.checkout)this.checkout=JSON.parse(JSON.stringify(saved.checkout));return}
      this.checkout=JSON.parse(JSON.stringify(saved.checkout))
      this.payMethod={'余额支付':'balance','货到付款':'cod','微信支付':'wechat','水票支付':'ticket'}[saved.payload.payment]
    },
    clearPendingCheckout(intent){
      const key=this.checkoutStorageKey()
      if(key&&uni.getStorageSync(key)?.payload?.idempotencyKey===intent.payload.idempotencyKey)uni.removeStorageSync(key)
      if(this.pendingCheckout?.payload.idempotencyKey===intent.payload.idempotencyKey){this.pendingCheckout=null;this.paymentRequestId=''}
    },
    async resolvePendingCheckout(intent,current){
      let existing=intent.orderId?await waterApi.getOrder(intent.orderId):(await waterApi.recoverOrder?.(intent.payload.idempotencyKey))?.order
      if(!current())return null
      const recoveredCorrection=!!existing&&!!intent.correcting
      if(!existing){
        intent.createAttempted=true;this.persistPendingCheckout(intent)
        existing=await waterApi.createOrder(JSON.parse(JSON.stringify(intent.payload)))
      }
      if(!current())return null
      intent.orderId=existing.id;intent.amount=Number(existing.amount||0)
      if(recoveredCorrection){
        intent.payload.payment=existing.payment;intent.correcting=false;intent.reviewRecovered=true
        const lines=(existing.items||[]).filter(line=>line.skuCode)
        if(lines.length)intent.checkout={station:existing.station,fromCart:intent.checkout.fromCart,items:lines.map(line=>({sku:line.skuCode,name:line.product,spec:line.spec,price:line.unitPrice,qty:line.quantity,station:existing.station}))}
      }
      this.pendingCheckout=intent;this.persistPendingCheckout(intent)
      return existing
    },
    confirmCancelPendingCheckout(){if(this.submitting)return;uni.showModal({title:'核对原单并返回修改',content:'先查询原订单。查无订单可返回修改；已有订单只有仍未付款时才会取消，取消确认前不会另建订单。',success:result=>{if(result.confirm)this.cancelPendingCheckout()}})},
    async cancelPendingCheckout(){
      if(this.submitting||!this.checkoutAccountCurrent())return
      this.restorePendingCheckout();const intent=this.pendingCheckout;if(!intent)return
      const current=this.readGuard('checkout');this.submitting=true
      try{
        // This path is read/cancel only. Never create an order in order to cancel it.
        let order=intent.orderId?await waterApi.getOrder(intent.orderId):(await waterApi.recoverOrder(intent.payload.idempotencyKey)).order
        if(!current())return
        if(!order){
          intent.editable=true;this.pendingCheckout=intent;this.persistPendingCheckout(intent)
          this.currentOrder=null;this.selectedCouponId='';this.useTickets=false;this.open('confirm')
          await this.refreshQuote();if(current())this.toast('暂未查到原订单，可以修改后重试；提交时会再次核对原订单')
          return
        }
        if(order.status!=='已取消'){
          if(order.status!=='待付款'||order.payStatus==='已支付')return this.toast('原订单已付款或已进入配送，不能在这里更换付款方式；请继续原订单查看结果')
          order=await waterApi.cancelOrder(order.id);if(!current())return
        }
        if(order.status!=='已取消')throw new Error('原订单取消尚未确认，请重试核对')
        this.clearPendingCheckout(intent);this.currentOrder=null;this.selectedCouponId='';this.useTickets=false
        await Promise.all([this.loadAccount(),this.loadTickets(),this.loadCoupons()]);if(!current())return
        await this.refreshQuote();if(!current())return
        this.open('confirm');this.toast('原订单已取消，可以重新选择付款方式')
      }catch(error){if(current())this.toast('原订单尚未确认取消，请重试：'+error.message)}finally{this.submitting=false}
    },
    async submitPayment(){
      if(this.submitting||!this.checkoutAccountCurrent())return
      const current=this.readGuard('checkout');let created=null,intent=null
      this.submitting=true;this.paymentPending=true
      try{
        this.restorePendingCheckout();intent=this.pendingCheckout
        if(!intent||intent.editable){
          this.validatePayment()
          const payment=this.ticketOnly?'水票支付':{wechat:'微信支付',balance:'余额支付',cod:'货到付款'}[this.payMethod]
          this.paymentRequestId=intent?.payload.idempotencyKey||'checkout-'+Date.now()+'-'+Math.random().toString(36).slice(2,10)
          intent={correcting:!!intent?.editable,createAttempted:!!intent?.createAttempted,amount:Number(this.checkoutTotal),checkout:JSON.parse(JSON.stringify(this.checkout)),payload:{idempotencyKey:this.paymentRequestId,items:this.checkout.items.map(item=>({sku:item.sku,quantity:Number(item.qty||1)})),address:this.account.address,station:this.checkout.station||this.account.stationName,payment,remark:this.remark,deliveryWindow:this.deliveryWindow,tickets:this.selectedTickets,customerCouponId:this.selectedCouponId||undefined}}
          intent=JSON.parse(JSON.stringify(intent));this.pendingCheckout=intent;this.persistPendingCheckout(intent)
        }
        await this.requestSubscriptions(['dispatched','delivering','completed']);if(!current())return
        created=await this.resolvePendingCheckout(intent,current);if(!created||!current())return
        if(created.status==='已取消'){this.clearPendingCheckout(intent);this.toast('原订单已取消，请重新核对商品和金额后下单');await this.refreshQuote();return}
        if(intent.reviewRecovered){intent.reviewRecovered=false;this.persistPendingCheckout(intent);this.checkout=JSON.parse(JSON.stringify(intent.checkout));this.toast('已找到原订单，请核对显示的原订单付款方式和金额，再继续或取消原单');return}
        const payment=intent.payload.payment
        // A paid/recovered order is never charged again, even when the callback was late.
        const updated=await this.settleOrder(created,payment)
        if(!current())return
        if(payment!=='货到付款'&&updated.payStatus!=='已支付')throw new Error('支付结果尚未确认，请继续原订单核对')
        this.currentOrder=updated;this.selectedOrder=this.mapOrder(updated)
        this.checkout=JSON.parse(JSON.stringify(intent.checkout));this.selectedCouponId='';this.useTickets=false
        this.finishCheckout();this.clearPendingCheckout(intent);this.open('success')
      }catch(error){
        if(current()){
          // An error cannot rule out another attempt still committing; only confirmed cancellation releases the key.
          this.toast(created?'订单 '+created.id+' 已保留：'+error.message:error.message)
        }
      }finally{this.submitting=false;this.paymentPending=false}
    },
		async paySelectedOrder(){if(!this.selectedOrder?.id||this.submitting)return;const selection=this.captureSelection(),order={...this.selectedOrder};this.submitting=true;this.paymentPending=true;try{const payment=order.payment;if(payment==='微信支付'&&!this.appConfig.wechatPay&&!this.appConfig.simulatedPayments)throw new Error(this.appConfig.wechatPayMessage||'微信支付尚未配置');if(payment==='微信支付'&&this.wechatPayBlocked)throw new Error('当前账号未绑定微信，无法继续微信支付；请退出后使用“微信登录”再支付，或取消该订单后重新下单');const updated=await this.settleOrder(order,payment);if(payment!=='货到付款'&&updated.payStatus!=='已支付')throw new Error('支付结果尚未确认');const committed=this.commitSelection(updated,selection);if(!committed){if(!this.pageDisposed){this.toast(`订单 ${order.id} ${payment==='货到付款'?'已确认货到付款':'支付成功'}`);this.loadOrders()}return}this.currentOrder=updated;await this.loadOrders();if(this.isCurrentSelection(committed))this.open('success')}catch(error){if(this.isCurrentSelection(selection))this.toast(error.message)}finally{this.submitting=false;this.paymentPending=false}},
		/** 进入售后页：水票订单默认整单退货；补送默认第一件商品 1 件。 */
		initRefund(){ const ticketOrder=Number(this.selectedOrder?.ticketAmount||0)>0,zeroReturn=this.selectedOrder?.aftersalePolicy?.allowZeroAmountReturn===true; this.refundType=ticketOrder||zeroReturn?'return':'refund'; this.refundImages=[]; this.refundDesc=''; this.initRefundLines() },
		initRefundLines(){ const lines=this.refundType==='return'?this.refundReturnLines:this.detailLines.filter(line=>line.skuCode); this.refundLines=lines.map((line,index)=>({skuCode:line.skuCode,product:line.product,spec:line.spec,unitPrice:Number(line.unitPrice||0),max:Number(line.quantity||0),quantity:this.refundType==='return'?Number(line.quantity||0):this.refundType==='resend'&&index===0?1:0})); this.refundAmount=this.formatAmount(this.refundableAmount) },
		pickRefundType(option){ if(option.disabled)return this.toast(option.note); this.refundType=option.id; this.initRefundLines() },
		changeRefundLine(line,delta){ if(this.refundLocked)return;line.quantity=Math.min(line.max,Math.max(0,line.quantity+delta)); if(this.refundType==='return'){const value=this.refundLines.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0);this.refundAmount=this.formatAmount(Math.min(this.refundableAmount,value))} },
		async submitRefund(){
			if(!this.selectedOrder?.id)return this.toast('请先选择订单');if(this.submitting)return;
			if(this.refundPending)return this.toast('已有进行中的退款申请，请先查看售后记录');
			const option=this.refundOptions.find(item=>item.id===this.refundType);if(!option||option.disabled)return this.toast(option?.note||'请选择有效的售后类型');
			const type={refund:'仅退款',return:'退货退款',resend:'补送'}[this.refundType];
			const items=this.refundType==='refund'?[]:this.refundLines.filter(line=>line.quantity>0).map(line=>({skuCode:line.skuCode,quantity:line.quantity}));
			if(this.refundType!=='refund'&&!items.length)return this.toast(this.refundType==='resend'?'请选择需要补送的商品数量':'暂无可退商品');
			if(this.refundType==='return'&&this.refundLocked&&(items.length!==this.refundReturnLines.length||this.refundReturnLines.some(line=>items.find(item=>item.skuCode===line.skuCode)?.quantity!==line.quantity)))return this.toast('需退回全部剩余可退商品，请重新进入售后页核对');
			const amount=Number(this.refundAmount),amountCents=Math.round(amount*100),remainingCents=Math.round(this.refundableAmount*100);
			if(this.refundType!=='resend'){
				if(!Number.isFinite(amount)||Math.abs(amount*100-amountCents)>0.000001||amount<0||(!this.refundZeroAllowed&&amount===0)||amountCents>remainingCents)return this.toast(`申请金额需在 ${this.refundZeroAllowed?'0.00':'0.01'} 至 ${this.formatAmount(this.refundableAmount)} 元之间，最多两位小数`);
				if(this.refundLocked&&amountCents!==remainingCents)return this.toast(`需退还全部剩余实付 ¥${this.formatAmount(this.refundableAmount)}，请重新进入售后页核对`);
			}
			const selection=this.captureSelection(),reason=`${this.refundReason}${this.refundDesc?`：${this.refundDesc}`:''}`,refundType=this.refundType,images=[...this.refundImages];this.submitting=true;
			try{await this.requestSubscriptions(['aftersale']);const attachments=[];for(const path of images){const uploaded=await waterApi.uploadImage(path);attachments.push(uploaded.url)}if(!this.isCurrentSelection(selection))return;await waterApi.createAftersale({orderId:selection.id,type,reason,amount:refundType==='resend'?0:amount,items,attachments});if(!this.isCurrentSelection(selection))return;this.refundImages=[];this.refundDesc='';this.toast(refundType==='resend'?'补送申请已提交，审核后水站安排补送':'售后申请已提交');setTimeout(()=>{if(this.isCurrentSelection(selection))this.open('aftersales')},600)}catch(error){if(this.isCurrentSelection(selection))this.toast(error.message)}finally{this.submitting=false}
		},
		/** 取消后按服务端退回结果提示：余额支付退余额，水票（含部分水票抵扣）退回账户 */
		cancelMessage(order){const parts=[];if(order.refundStatus==='已退款'&&order.payment==='余额支付'&&Number(order.amount||0)>0)parts.push('余额已退回');if(Number(order.ticketAmount||0)>0)parts.push('水票已退回账户');return parts.length?`订单已取消，${parts.join('，')}`:'订单已取消'},
		async cancelSelectedOrder(){if(!this.selectedOrder?.id||this.submitting)return;const selection=this.captureSelection();this.submitting=true;try{const cancelled=await waterApi.cancelOrder(selection.id);const committed=this.commitSelection(cancelled,selection);if(!committed)return;await this.loadOrders();if(this.isCurrentSelection(committed))this.toast(this.cancelMessage(cancelled))}catch(error){if(this.isCurrentSelection(selection))this.toast(error.message)}finally{this.submitting=false}},
		async confirmSelectedReceipt(){if(!this.canConfirmReceipt||this.submitting)return;const selection=this.captureSelection();this.submitting=true;try{const confirmed=await waterApi.confirmReceipt(selection.id);const committed=this.commitSelection(confirmed,selection);if(!committed)return;await this.loadOrders();if(this.isCurrentSelection(committed))this.toast('已确认收货')}catch(error){if(this.isCurrentSelection(selection))this.toast(error.message)}finally{this.submitting=false}}
	}
}
</script>

<style scoped>
.sync-warning,.aftersale-result{display:flex;flex-direction:column;gap:18rpx;padding:28rpx;margin:24rpx 0;font-size:28rpx;line-height:1.5;word-break:break-word}.sync-warning{border:1px solid #d6574b}.sync-warning button,.aftersale-entry{min-height:88rpx;font-size:28rpx}.aftersale-entry{margin:20rpx 0;color:#0b4f40}
.order-page{min-height:100vh;color:#18332b;background:#f4f6f3}.page-scroll{height:calc(100vh - var(--mobile-header-height, 44px));padding:18rpx 24rpx 150rpx;box-sizing:border-box}.card{margin-bottom:18rpx;padding:26rpx;border:1rpx solid rgba(17,82,61,.07);border-radius:22rpx;background:#fff;box-shadow:0 9rpx 26rpx rgba(31,69,59,.055)}.address-card{display:flex;align-items:center}.pin{width:54rpx;height:54rpx;display:grid;place-items:center;border-radius:50%;color:#fff;background:#0b6751}.address-main{flex:1;display:flex;flex-direction:column;gap:7rpx;margin-left:18rpx}.name{font-size:29rpx;font-weight:700}.phone{margin-left:20rpx;color:#79847f;font-size:max(12px, 22rpx)}.address{font-size:28rpx;font-weight:700}.hint,.muted,.ui-small{color:#8a9490;font-size:max(12px, 20rpx)}.chevron{font-size:44rpx;color:#6c7c77}.line-row{display:flex;align-items:center;justify-content:space-between;font-size:25rpx}.row-value{color:#556760}.section-title{display:block;margin-bottom:22rpx;font-size:27rpx;font-weight:700}.goods-line{display:flex;align-items:center;gap:19rpx}.goods-copy{flex:1;display:flex;flex-direction:column;gap:8rpx}.goods-name{display:block;font-size:25rpx;font-weight:650}.goods-price{display:flex;flex-direction:column;align-items:flex-end;gap:8rpx}.discount-row{padding-top:22rpx;margin-top:19rpx;display:flex;justify-content:space-between;border-top:1rpx solid #edf0ee;font-size:max(12px, 23rpx)}.minus{color:#df4d3f!important}.remark-input{flex:1;text-align:right;font-size:max(12px, 21rpx)}.pay-option{min-height:84rpx;display:flex;align-items:center;border-bottom:1rpx solid #edf1ef}.pay-option:last-child{border-bottom:0}.pay-icon{width:46rpx;height:46rpx;margin-right:17rpx;display:grid;place-items:center;border-radius:13rpx;color:#fff;background:#167455}.pay-icon.balance{background:#e2a735}.pay-icon.ticket{background:#2383a1}.pay-icon.cod{background:#e59024}.pay-option>view{flex:1;display:flex;flex-direction:column;gap:5rpx}.pay-option .ui-strong{font-size:24rpx}.pay-radio{width:34rpx;height:34rpx;display:grid;place-items:center;border:2rpx solid #ccd5d1;border-radius:50%;color:transparent}.pay-radio.on{color:#fff;border-color:#0a6b52;background:#0a6b52}.amount-card{padding:65rpx 30rpx;text-align:center;display:flex;flex-direction:column;align-items:center}.big-amount{margin:27rpx 0 14rpx;color:#dd4436;font-size:68rpx;font-weight:700}.big-amount text{font-size:34rpx}.pay-countdown{font-size:max(12px, 22rpx)}.pay-countdown text{color:#e14c3e}.safe-note{text-align:center;color:#6c7d77;font-size:max(12px, 20rpx)}.success-panel{text-align:center}.success-icon{width:130rpx;height:130rpx;margin:50rpx auto 22rpx;display:grid;place-items:center;border-radius:50%;color:#fff;background:linear-gradient(145deg,#0d604b,#2c9b82);box-shadow:0 18rpx 36rpx rgba(18,106,81,.2);font-size:72rpx}.success-title{display:block;margin-bottom:9rpx;font-size:35rpx;font-weight:700}.delivery-window{margin:36rpx 0 18rpx;padding:28rpx;text-align:left;display:flex;flex-direction:column;gap:8rpx;border-radius:20rpx;background:#edf5f1}.delivery-window .ui-strong{color:#08715a;font-size:36rpx}.success-detail{padding:8rpx 25rpx;background:#fff;border-radius:20rpx}.success-detail view,.order-info view{padding:17rpx 0;display:flex;justify-content:space-between;font-size:max(12px, 22rpx)}.notify-card{margin-top:20rpx;padding:22rpx;display:flex;align-items:center;gap:15rpx;text-align:left;border-radius:18rpx;background:#e9f4ef}.notify-card view{flex:1;display:flex;flex-direction:column}.notify-card button,.courier button{margin:0;padding:0 22rpx;line-height:52rpx;border:0;border-radius:28rpx;color:#fff;background:#087159;font-size:max(12px, 20rpx)}.search-box{height:70rpx;padding:0 23rpx;display:flex;align-items:center;border-radius:35rpx;color:#929c98;background:#e8ecea;font-size:max(12px, 22rpx)}.status-tabs{height:82rpx;display:flex;align-items:end;justify-content:space-between;background:#fff;margin:18rpx -24rpx;padding:0 25rpx}.status-tabs text{height:65rpx;position:relative;color:#77847f;font-size:max(12px, 22rpx)}.status-tabs .active{color:#086952;font-weight:700}.status-tabs .active:after{content:'';position:absolute;left:25%;right:25%;bottom:0;height:5rpx;border-radius:4rpx;background:#08715a}.order-head{display:flex;justify-content:space-between;padding-bottom:18rpx;border-bottom:1rpx solid #edf1ef;font-size:max(12px, 20rpx)}.green{color:#08725a}.mint{color:#3ca68a}.order-price{font-weight:700}.order-foot{margin-top:18rpx;display:flex;align-items:center;justify-content:space-between;color:#7e8985;font-size:max(12px, 19rpx)}.order-foot button{margin:0;padding:0 21rpx;line-height:50rpx;border:1rpx solid #bed0ca;border-radius:26rpx;color:#285047;background:#fff;font-size:max(12px, 19rpx)}.detail-hero{height:160rpx;margin:-18rpx -24rpx 18rpx;padding:32rpx 40rpx;display:flex;justify-content:space-between;color:#fff;background:linear-gradient(115deg,#07644d,#51b7a4)}.detail-hero>view{display:flex;flex-direction:column;gap:8rpx}.detail-state{font-size:34rpx;font-weight:700}.scooter{font-size:70rpx}.courier{display:flex;align-items:center;gap:16rpx}.avatar{width:72rpx;height:72rpx;display:grid;place-items:center;border-radius:50%;color:#fff;background:#517e70}.courier>view:nth-child(2){flex:1;display:flex;flex-direction:column;gap:8rpx}.courier .ui-small{color:#e49128}.detail-address{display:flex;flex-direction:column;gap:10rpx}.detail-address .ui-strong{font-size:29rpx}.summary{margin-top:18rpx;padding-top:18rpx;display:grid;grid-template-columns:1fr auto;gap:14rpx;border-top:1rpx solid #edf1ef;font-size:max(12px, 21rpx)}.order-info{color:#6d7c76}.refund-goods{display:flex;align-items:center;gap:18rpx}.refund-goods>view{flex:1}.refund-goods>view text{display:block;margin-bottom:7rpx}.radio-line{padding:18rpx 0;display:flex;gap:17rpx;border-top:1rpx solid #edf1ef}.radio-line>text{color:#d5dcda}.radio-line>text.selected{color:#08705a}.radio-line>view{display:flex;flex-direction:column;gap:5rpx}.reason-tags{display:flex;flex-wrap:wrap;gap:13rpx}.reason-tags text{padding:14rpx 19rpx;border:1rpx solid #d5dfdb;border-radius:22rpx;color:#63736d;font-size:max(12px, 19rpx)}.reason-tags text.active{color:#07654f;border-color:#0a7058;background:#e8f4ef}.refund-amount{margin-top:25rpx;padding-top:20rpx;display:flex;justify-content:space-between;border-top:1rpx solid #edf1ef}.refund-amount .ui-strong{color:#e44638;font-size:32rpx}textarea{height:150rpx;width:100%;font-size:max(12px, 22rpx)}.upload-row{display:flex;gap:12rpx}.upload-row>view{width:112rpx;height:112rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12rpx;color:#72817c;background:linear-gradient(145deg,#dce7e2,#f3f5f4);font-size:max(12px, 16rpx)}.upload-row .upload{border:1rpx dashed #b8c5c0;background:#fafbfa;font-size:35rpx}.upload .ui-small{font-size:max(12px, 16rpx)}.bottom-action,.single-action,.double-action{position:fixed;z-index:30;left:0;right:0;bottom:0;min-height:112rpx;padding:14rpx 25rpx calc(14rpx + env(safe-area-inset-bottom));display:flex;align-items:center;gap:18rpx;border-top:1rpx solid #e2e8e5;background:#fff}.bottom-action>view{flex:1}.bottom-action .ui-strong{color:#df4638;font-size:30rpx}.bottom-action button,.single-action button,.double-action button{height:76rpx;margin:0;display:grid;place-items:center;border:0;border-radius:38rpx;color:#fff;background:linear-gradient(135deg,#08644e,#159077);font-size:25rpx;font-weight:650}.bottom-action button{width:270rpx}.single-action button{width:100%}.double-action button{flex:1}.double-action .ghost{color:#0a6852;border:1rpx solid #0a6852;background:#fff}
.discount-row>view{display:flex;align-items:center;gap:10rpx}.notify-card>.notify-icon{width:54rpx;height:54rpx;flex:0 0 54rpx;display:grid;place-items:center;border-radius:16rpx;background:#dfeee8}.notify-card>view:nth-child(2){flex:1;display:flex;flex-direction:column}.search-box{gap:12rpx}.scooter{width:84rpx;align-items:center;justify-content:center}.courier button{width:60rpx;height:60rpx;padding:0;display:grid;place-items:center;border-radius:50%}.detail-contact{display:flex;align-items:center;gap:9rpx}
.order-page{height:100vh;height:100dvh;min-height:0;overflow:hidden}.page-scroll{height:calc(100vh - var(--mobile-header-height, 44px));height:calc(100dvh - var(--mobile-header-height, 44px))}

/* 第二轮验收补齐：订单搜索 / 空态 / 售后凭证 / 地址表单 / 送达凭证 */
.search-box{position:relative}.search-input{flex:1;min-width:0;height:44rpx;color:#18332b;font-size:24rpx;background:transparent}.search-clear{width:40rpx;height:40rpx;display:grid;place-items:center;border-radius:50%;color:#6f807a;background:#e4ebe7;font-size:26rpx}
.empty-orders{min-height:320rpx;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12rpx;color:#82908b}
.upload-row .upload-thumb{position:relative;width:132rpx;height:132rpx;overflow:hidden;border-radius:12rpx;background:#eef2f0}.upload-row .upload-thumb image{width:100%;height:100%}.upload-row .upload-thumb .remove{position:absolute;top:0;right:0;width:36rpx;height:36rpx;display:grid;place-items:center;border-radius:0 0 0 12rpx;color:#fff;background:rgba(24,51,43,.72);font-size:24rpx}
.copy-link{margin-left:6rpx;color:#0b5949;font-weight:600}
/* 第四轮：多商品结算 / 配送费 / 补送单 / 按商品售后 */
.type-chip{margin-left:10rpx;padding:2rpx 12rpx;border-radius:8rpx;color:#8a5a12;background:#fbecd2;font-size:max(12px, 20rpx)}
.ticket-note{color:#0b6b56;font-size:max(12px, 20rpx)}
.goods-card .goods-line+.goods-line{margin-top:18rpx;padding-top:18rpx;border-top:1rpx dashed #e3e9e6}
.quote-error{color:#b3413a;align-items:center}
.radio-line.disabled{opacity:.5}
.refund-line{display:flex;align-items:center;gap:16rpx;padding:18rpx 0;border-top:1rpx solid #edf1ef}.refund-line:first-of-type{border-top:0}
.refund-line .stepper{display:flex;align-items:center;gap:12rpx}.refund-line .stepper button{width:64rpx;height:64rpx;margin:0;padding:0;display:grid;place-items:center;border:1rpx solid #c9d6d1;border-radius:50%;color:#0b5949;background:#fff;font-size:30rpx;line-height:1}.refund-line .stepper text{min-width:44rpx;text-align:center;font-size:28rpx;font-variant-numeric:tabular-nums}
.refund-amount-input{width:220rpx;height:64rpx;padding:0 16rpx;border-radius:12rpx;background:#f3f6f3;text-align:right;color:#e44638;font-size:30rpx;font-weight:700}
.refund-rule{display:flex;flex-direction:column;gap:12rpx;color:#596f65;font-size:max(12px,24rpx);line-height:1.6}
.courier button.disabled{opacity:.45}
.proof-card .proof-image{width:100%;height:360rpx;margin-top:14rpx;border-radius:14rpx;background:#eef2f0}
.address-form .form-line{display:flex;align-items:center;gap:20rpx;padding:22rpx 0;border-bottom:1rpx solid #edf1ef;font-size:26rpx}.address-form .form-line:last-child{border-bottom:0}.address-form .form-line>text:first-child{flex:0 0 130rpx;color:#6f807a}.address-form .form-line input{flex:1;height:52rpx;font-size:26rpx}.address-form .form-line.column{flex-direction:column;align-items:stretch;gap:12rpx}.address-form .form-line textarea{width:100%;height:150rpx;padding:16rpx;border-radius:12rpx;background:#f3f6f3;font-size:26rpx}
.address-tip{display:block;padding:0 8rpx;color:#82908b}
.receipt-card{display:flex;flex-direction:column;align-items:center;gap:14rpx;text-align:center}.receipt-card .section-title{align-self:stretch}.bottom-action button:disabled,.single-action button:disabled,.double-action button:disabled{opacity:.45}

.list-pagination{display:flex;flex-direction:column;gap:16rpx;padding:20rpx;text-align:center;font-size:24rpx;color:#53675f}.list-pagination button{min-height:44px;color:#0b5949;background:#fff;font-size:26rpx}
</style>

<style scoped src="./restoration.css"></style>
