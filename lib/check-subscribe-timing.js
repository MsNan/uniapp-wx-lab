'use strict';

/**
 * WeChat / uni-app: requestSubscribeMessage 必须在用户点击手势或支付成功回调中触发。
 * @param {{ afterUserGesture?: boolean, afterPayCallback?: boolean }} opts
 * @returns {{ allowed: boolean, tip: string, reason: string }}
 */
function checkSubscribeTiming(opts = {}) {
  const afterUserGesture = Boolean(opts.afterUserGesture);
  const afterPayCallback = Boolean(opts.afterPayCallback);

  if (afterUserGesture || afterPayCallback) {
    return {
      allowed: true,
      reason: afterPayCallback ? 'after_pay_callback' : 'after_user_gesture',
      tip: afterPayCallback
        ? '当前处于支付成功回调上下文，可以调用 uni.requestSubscribeMessage。'
        : '当前处于用户点击手势上下文，可以调用 uni.requestSubscribeMessage。',
    };
  }

  return {
    allowed: false,
    reason: 'no_gesture_or_pay',
    tip:
      '不能直接调用 requestSubscribeMessage。请放在按钮 @tap/@click 回调，或 uni.requestPayment success / 支付完成回调里。' +
      '页面 onLoad/onShow、定时器、接口返回后自动弹都不行。',
  };
}

module.exports = { checkSubscribeTiming };
