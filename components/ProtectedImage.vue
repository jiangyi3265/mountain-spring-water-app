<template>
  <view class="protected-image">
    <image v-if="dataUrl" :src="dataUrl" mode="aspectFit" :aria-label="alt" @click="preview" />
    <text v-else role="status">{{ error || '正在读取凭证…' }}</text>
  </view>
</template>

<script>
import { waterApi } from '../services/waterApi.js'

export default {
  props: { path: { type: String, required: true }, alt: { type: String, default: '凭证' }, role: { type: String, default: 'customer' } },
  data: () => ({ dataUrl: '', error: '', generation: 0 }),
  watch: { path: { immediate: true, handler: 'load' }, role: 'load' },
  beforeUnmount() { this.generation += 1 },
  methods: {
    async load() {
      const generation = ++this.generation
      this.dataUrl = ''; this.error = ''
      try {
        const result = await waterApi.getAttachment(this.path, this.role)
        if (generation === this.generation) this.dataUrl = result
      } catch (error) {
        if (generation === this.generation) this.error = error.message || '凭证暂时无法读取'
      }
    },
    preview() { if (this.dataUrl) uni.previewImage({ urls: [this.dataUrl] }) },
  },
}
</script>

<style scoped>
.protected-image{display:flex;align-items:center;justify-content:center;min-height:88rpx}
.protected-image image{width:100%;height:100%}
.protected-image text{font-size:28rpx;color:#475569;padding:16rpx}
</style>
