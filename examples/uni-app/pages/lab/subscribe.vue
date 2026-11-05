<template>
  <view class="page">
    <view class="card">
      <text class="title">订阅消息调试</text>
      <text class="desc">在按钮点击中调用 uni.requestSubscribeMessage，观察 accept / reject / ban。</text>
    </view>

    <view class="card">
      <text class="label">当前 tmplIds</text>
      <text class="mono">{{ tmplIds.join(', ') || '（未配置，请回首页填写）' }}</text>
    </view>

    <button class="btn" type="primary" @tap="onSubscribe">点击授权订阅</button>
    <button class="btn" @tap="onBadTiming">错误示范：假装 onLoad 自动弹（应被拦截）</button>

    <view class="card" v-if="tip">
      <text class="label">输出</text>
      <text class="mono">{{ tip }}</text>
    </view>

    <view class="card">
      <text class="label">平台说明</text>
      <text class="line" v-for="(t, i) in tips" :key="i">{{ i + 1 }}. {{ t }}</text>
      <text class="line">微信基础库需支持订阅消息；uni-app 请确认 mp-weixin 条件编译生效。</text>
      <text class="line">长期订阅与一次性模板不可混用同一次调用。</text>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  loadTmplIdsFromStorage,
  requestSubscribeLab,
  checkTiming,
  PLATFORM_TIPS,
} from '../../utils/subscribe-lab.js'

const tmplIds = ref([])
const tip = ref('')
const tips = PLATFORM_TIPS

onMounted(() => {
  tmplIds.value = loadTmplIdsFromStorage()
})

async function onSubscribe() {
  const r = await requestSubscribeLab(tmplIds.value, { afterUserGesture: true })
  tip.value = r.tip
}

function onBadTiming() {
  const t = checkTiming({ afterUserGesture: false, afterPayCallback: false })
  tip.value = '【本地拦截】' + t.tip + '\n（未调用微信 API，避免无效弹窗）'
}
</script>

<style scoped>
.page { padding: 32rpx; background: #f5f6f8; min-height: 100vh; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 24rpx; }
.title { font-size: 32rpx; font-weight: 600; display: block; }
.desc { font-size: 26rpx; color: #666; margin-top: 12rpx; display: block; }
.label { font-size: 24rpx; color: #888; display: block; margin-bottom: 8rpx; }
.mono { font-size: 26rpx; word-break: break-all; white-space: pre-wrap; }
.btn { margin-bottom: 20rpx; }
.line { display: block; font-size: 24rpx; color: #666; line-height: 1.7; margin-top: 8rpx; }
</style>
