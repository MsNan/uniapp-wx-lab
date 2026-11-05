/**
 * 订阅消息联调辅助（拷贝到你的 uni-app 工程）
 * 纯前端提示 + requestSubscribeMessage 封装，不含真实 appid。
 */

/** 历史一次最多 3 个；平台后续有放开，仍建议 ≤3 */
const RECOMMENDED_MAX_TMPL = 3;

/**
 * @param {{ afterUserGesture?: boolean, afterPayCallback?: boolean }} ctx
 */
export function checkTiming(ctx = {}) {
  const ok = !!(ctx.afterUserGesture || ctx.afterPayCallback);
  return {
    allowed: ok,
    tip: ok
      ? '时机合法：处于用户点击或支付回调中。'
      : '时机不合法：请放在按钮点击或支付 success 回调里调用，onLoad/接口返回后自动弹会失败。',
  };
}

/**
 * @param {string[]} tmplIds
 * @param {{ afterUserGesture?: boolean, afterPayCallback?: boolean }} ctx
 * @returns {Promise<{ ok: boolean, result?: object, tip: string }>}
 */
export function requestSubscribeLab(tmplIds, ctx = {}) {
  const timing = checkTiming(ctx);
  if (!timing.allowed) {
    return Promise.resolve({ ok: false, tip: timing.tip });
  }
  const ids = (tmplIds || []).filter(Boolean);
  if (!ids.length) {
    return Promise.resolve({ ok: false, tip: '请先配置 tmplIds（小程序后台订阅消息模板 ID）' });
  }
  if (ids.length > RECOMMENDED_MAX_TMPL) {
    console.warn(`[subscribe-lab] 一次请求 ${ids.length} 个模板，建议 ≤${RECOMMENDED_MAX_TMPL}`);
  }

  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    uni.requestSubscribeMessage({
      tmplIds: ids,
      success(res) {
        const lines = ids.map((id) => {
          const st = res[id];
          if (st === 'accept') return `${id}: 允许`;
          if (st === 'reject') return `${id}: 拒绝`;
          if (st === 'ban') return `${id}: 已被后台封禁`;
          if (st === 'filter') return `${id}: 标题同名被过滤`;
          return `${id}: ${st || '未知'}`;
        });
        resolve({ ok: true, result: res, tip: lines.join('\n') });
      },
      fail(err) {
        resolve({
          ok: false,
          result: err,
          tip: `调用失败: ${err?.errMsg || JSON.stringify(err)}。检查基础库版本、是否在手势/支付回调中、tmplId 是否属于本小程序。`,
        });
      },
    });
    // #endif
    // #ifndef MP-WEIXIN
    resolve({
      ok: false,
      tip: '当前非微信小程序环境。请在微信开发者工具 / 真机中调试 requestSubscribeMessage。',
    });
    // #endif
  });
}

export function loadTmplIdsFromStorage(key = 'lab_tmpl_ids') {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return String(raw)
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function saveTmplIdsToStorage(ids, key = 'lab_tmpl_ids') {
  uni.setStorageSync(key, ids);
}

export const PLATFORM_TIPS = [
  'iOS 与 Android 弹窗样式/次数限制可能不同，请双端真机验证。',
  '开发者工具里「订阅消息」模拟与真机不完全一致。',
  '用户勾选「总是保持以上选择」后，拒绝态很难再次弹窗，需引导打开设置。',
  '一次性模板与长期订阅模板不要混在同一次调用中。',
];
