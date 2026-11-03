<template>
  <view class="protected-image">
    <image v-if="dataUrl" :src="dataUrl" mode="aspectFit" :aria-label="alt" @click="preview" />
    <text v-else role="status">{{ error || '正在读取凭证…' }}</text>
  </view>
</template>

<script>
import { waterApi } from '../services/waterApi.js'
import { toDisplaySource, removeDisplaySource } from '../services/imageFiles.js'

export default {
  props: { path: { type: String, required: true }, alt: { type: String, default: '凭证' }, role: { type: String, default: 'customer' } },
  data: () => ({ dataUrl: '', error: '', generation: 0, tempFile: '' }),
  watch: { path: { immediate: true, handler: 'load' }, role: 'load' },
  beforeUnmount() { this.generation += 1; this.releaseTempFile() },
  methods: {
    async load() {
      const generation = ++this.generation
      this.dataUrl = ''; this.error = ''; this.releaseTempFile()
      try {
        const result = await waterApi.getAttachment(this.path, this.role)
        if (generation !== this.generation) return
        // 小程序里写成本地文件再显示：大图 base64 超过单次 setData 上限会显示失败，预览也不支持 data: 地址
        // 每次加载独立文件名：同一附件出现在两处时，一处卸载删除文件不会影响另一处
        const display = await toDisplaySource(result, `${this.role}:${this.path}:${generation}:${Date.now()}:${Math.random()}`)
        if (generation !== this.generation) return removeDisplaySource(display.tempFile)
        this.tempFile = display.tempFile
        this.dataUrl = display.src
      } catch (error) {
        if (generation === this.generation) this.error = error.message || '凭证暂时无法读取'
      }
    },
    releaseTempFile() { if (this.tempFile) removeDisplaySource(this.tempFile); this.tempFile = '' },
    preview() { if (this.dataUrl) uni.previewImage({ urls: [this.dataUrl], fail: () => uni.showToast({ title: '图片预览失败', icon: 'none' }) }) },
  },
}
</script>

<style scoped>
.protected-image{display:flex;align-items:center;justify-content:center;min-height:88rpx}
.protected-image image{width:100%;height:100%}
.protected-image text{font-size:28rpx;color:#475569;padding:16rpx}
</style>
