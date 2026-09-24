<template>
  <view class="jug-wrap" :class="size"><image class="product-photo" :src="photo" mode="aspectFit" :aria-label="label || '饮用水商品示意图'" @error="failed = true" /></view>
</template>
<script>
export default {
  name: 'WaterJug',
  props: { size: { type: String, default: 'medium' }, label: { type: String, default: '山泉' }, spec: { type: String, default: '' }, src: { type: String, default: '' } },
  data() { return { failed: false } },
  watch: { src() { this.failed = false } },
  computed: { photo() { if (this.src && !this.failed) return this.src; return /ml|毫升|瓶装|苏打/i.test(this.spec + this.label) ? '/static/design/spring-pack.png' : '/static/design/spring-jug.png' } }
}
</script>
<style scoped>
.jug-wrap { position: relative; width: 160rpx; height: 190rpx; flex: 0 0 auto; }
.jug-wrap.small { width: 112rpx; height: 132rpx; }
.jug-wrap.large { width: 390rpx; height: 470rpx; }
.product-photo { display: block; width: 100%; height: 100%; }
</style>
