<template>
  <view class="page">
    <view class="hero">
      <text class="title">支付 + 订阅消息联调实验室</text>
      <text class="sub">uniapp-wx-lab · 拷贝到你的工程后使用</text>
    </view>

    <view class="card">
      <text class="label">模板 ID（逗号分隔，来自小程序后台）</text>
      <input class="input" v-model="tmplInput" placeholder="例如: xxx,yyy" @blur="persist" />
    </view>

    <button class="btn primary" type="primary" @tap="onMockPay">模拟支付成功后订阅</button>
    <button class="btn" @tap="onTapSubscribe">仅点击后订阅</button>
    <button class="btn" @tap="goSubscribePage">进入订阅详情页</button>
    <button class="btn warn" @tap="onValidateDemo">字段校验演示（本地规则）</button>

    <view class="card log" v-if="log">
      <text class="label">结果</text>
      <text class="mono">{{ log }}</text>
    </view>

    <view class="tips">
      <text v-for="(t, i) in tips" :key="i" class="tip">· {{ t }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { loadTmplIdsFromStorage, saveTmplIdsToStorage, PLATFORM_TIPS, checkTiming } from '../../utils/subscribe-lab.js'
import { mockPayThenSubscribe } from '../../utils/pay-lab.js'
import { requestSubscribeLab } from '../../utils/subscribe-lab.js'

const tmplInput = ref('')
const log = ref('')
const tips = PLATFORM_TIPS

onMounted(() => {
  const ids = loadTmplIdsFromStorage()
  tmplInput.value = ids.join(',')
})

function ids() {
  return tmplInput.value
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function persist() {
  saveTmplIdsToStorage(ids())
}

async function onMockPay() {
  persist()
  const r = await mockPayThenSubscribe(ids())
  log.value = JSON.stringify(r, null, 2)
}

async function onTapSubscribe() {
  persist()
  // 必须在 @tap 回调里：afterUserGesture=true
  const r = await requestSubscribeLab(ids(), { afterUserGesture: true })
  log.value = r.tip + (r.result ? '\n' + JSON.stringify(r.result, null, 2) : '')
}

function goSubscribePage() {
  persist()
  uni.navigateTo({ url: '/pages/lab/subscribe' })
}

function onValidateDemo() {
  // 前端演示：说明服务端校验；完整规则见 npm validate / mock server
  const timingBad = checkTiming({})
  const timingGood = checkTiming({ afterUserGesture: true })
  log.value = [
    '【时机】无手势: ' + timingBad.tip,
    '【时机】有点击: ' + timingGood.tip,
    '【字段】thing 最长 20；phrase 最长 5；name 中文≤10 / 英文≤20；amount 如 ¥12.50',
    '请用 CLI: npx -y github:MsNan/uniapp-wx-lab validate examples/payloads/order-shipped.json',
  ].join('\n\n')
}
</script>

<style scoped>
.page { padding: 32rpx; background: #f5f6f8; min-height: 100vh; }
.hero { margin-bottom: 32rpx; }
.title { font-size: 36rpx; font-weight: 600; display: block; }
.sub { font-size: 24rpx; color: #888; margin-top: 8rpx; display: block; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 24rpx; }
.label { font-size: 24rpx; color: #666; display: block; margin-bottom: 12rpx; }
.input { border: 1px solid #e5e5e5; border-radius: 8rpx; padding: 16rpx; font-size: 28rpx; }
.btn { margin-bottom: 20rpx; }
.btn.primary { background: #07c160; color: #fff; }
.btn.warn { background: #fff7e6; }
.log .mono { font-size: 24rpx; white-space: pre-wrap; word-break: break-all; color: #333; }
.tips { margin-top: 24rpx; }
.tip { display: block; font-size: 22rpx; color: #999; line-height: 1.6; }
</style>
