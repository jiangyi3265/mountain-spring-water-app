<template>
  <view class="legal-page">
    <MobileHeader :title="document.title" @back="goBack" />
    <scroll-view scroll-y class="legal-scroll">
      <view class="legal-article">
        <text class="legal-title">{{ document.title }}</text>
        <text class="legal-meta">更新及生效日期：{{ updated }}</text>
        <text class="legal-intro">{{ document.intro }}</text>
        <view v-for="section in document.sections" :key="section.title" class="legal-section">
          <text class="legal-heading">{{ section.title }}</text>
          <text v-for="paragraph in section.paragraphs" :key="paragraph" class="legal-paragraph">{{ paragraph }}</text>
        </view>
        <view class="legal-contact"><text>{{ operator }}</text><text>服务与隐私咨询：{{ contact }}</text></view>
        <button class="legal-other" @click="switchDocument">查看{{ type === 'privacy' ? '《用户服务协议》' : '《隐私政策》' }}</button>
        <button class="legal-back" @click="goBack">返回</button>
        <text class="legal-footnote">阅读或返回不会自动勾选同意。</text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import MobileHeader from '../../components/MobileHeader.vue'
import { legalDocuments, LEGAL_OPERATOR, LEGAL_CONTACT, LEGAL_UPDATED } from '../../services/legalDocuments.js'
export default {
  components: { MobileHeader },
  data() { return { type: 'privacy', operator: LEGAL_OPERATOR, contact: LEGAL_CONTACT, updated: LEGAL_UPDATED } },
  computed: { document() { return legalDocuments[this.type] } },
  onLoad(query) { this.type = query?.type === 'terms' ? 'terms' : 'privacy' },
  methods: {
    goBack() { if (getCurrentPages().length > 1) uni.navigateBack(); else uni.reLaunch({ url: '/pages/index/index?screen=auth' }) },
    switchDocument() { uni.redirectTo({ url: `/pages/legal/index?type=${this.type === 'privacy' ? 'terms' : 'privacy'}` }) }
  }
}
</script>

<style scoped>
.legal-page { height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: #fbfcf8; }
.legal-scroll { flex: 1; min-height: 0; height: 0; }
.legal-article { max-width: 680px; margin: 0 auto; padding: 24px 24px calc(32px + env(safe-area-inset-bottom)); color: #294538; }
.legal-title { display: block; font-size: 25px; font-weight: 650; line-height: 1.4; }
.legal-meta { display: block; margin: 12px 0 24px; font-size: 13px; color: #63796e; }
.legal-intro, .legal-paragraph { display: block; font-size: 15px; line-height: 1.9; overflow-wrap: anywhere; }
.legal-section { margin-top: 28px; }
.legal-heading { display: block; margin-bottom: 10px; font-size: 18px; line-height: 1.6; font-weight: 650; }
.legal-paragraph + .legal-paragraph { margin-top: 14px; }
.legal-contact { display: flex; flex-direction: column; gap: 8px; margin-top: 32px; padding: 20px 0; border-top: 1px solid #dde5d8; font-size: 14px; line-height: 1.7; }
.legal-other, .legal-back { margin-top: 16px; padding: 12px; min-height: 48px; border-radius: 10px; font-size: 15px; line-height: 24px; }
.legal-other { color: #0b6653; background: #edf2e7; }
.legal-back { color: #f5faf7; background: #0b4f40; }
.legal-footnote { display: block; margin-top: 16px; text-align: center; font-size: 12px; color: #63796e; }
</style>
