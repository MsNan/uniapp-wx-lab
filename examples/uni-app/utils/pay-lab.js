/**
 * 【模拟】支付成功后再拉起订阅 — 不含真实 wx.requestPayment / 商户号。
 * 仅用于联调「支付回调 → 订阅」时机，上线请换成真实支付。
 */

import { requestSubscribeLab } from './subscribe-lab.js';

/**
 * 模拟支付成功（延迟后回调），再调用订阅。
 * @param {string[]} tmplIds
 * @param {{ delayMs?: number, amount?: string }} [opts]
 */
export function mockPayThenSubscribe(tmplIds, opts = {}) {
  const delayMs = opts.delayMs ?? 600;
  return new Promise((resolve) => {
    uni.showLoading({ title: '模拟支付中…', mask: true });
    setTimeout(async () => {
      uni.hideLoading();
      // 这里刻意不调用 uni.requestPayment —— 避免误用真实支付
      uni.showToast({ title: '模拟支付成功', icon: 'success' });
      const sub = await requestSubscribeLab(tmplIds, { afterPayCallback: true });
      resolve({
        pay: { mock: true, amount: opts.amount || '¥0.01', tip: '此为模拟支付，未拉起微信支付收银台' },
        subscribe: sub,
      });
    }, delayMs);
  });
}

/**
 * 真实支付成功回调里应这样调用（示例伪代码，请自行接入）：
 *
 * uni.requestPayment({
 *   ...payParams,
 *   success() {
 *     requestSubscribeLab(tmplIds, { afterPayCallback: true })
 *   }
 * })
 */
export const REAL_PAY_HINT =
  '生产环境请在 uni.requestPayment 的 success 回调中调用 requestSubscribeLab(..., { afterPayCallback: true })。切勿把 mch_id / apiKey / 证书提交进 Git。';
