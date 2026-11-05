'use strict';

/**
 * Shape a subscribe-message send payload (server-side WeChat API style).
 * @param {string} templateId
 * @param {Record<string, {value:string}|string>} data
 * @param {{ touser?: string, page?: string, miniprogramState?: string, lang?: string }} [extra]
 */
function buildSubscribePayload(templateId, data, extra = {}) {
  if (!templateId || typeof templateId !== 'string') {
    throw new TypeError('templateId 必须是非空字符串');
  }
  if (!data || typeof data !== 'object') {
    throw new TypeError('data 必须是对象');
  }

  const normalized = {};
  for (const [key, raw] of Object.entries(data)) {
    if (typeof raw === 'object' && raw !== null && 'value' in raw) {
      normalized[key] = { value: String(raw.value) };
    } else {
      normalized[key] = { value: String(raw) };
    }
  }

  const payload = {
    template_id: templateId,
    data: normalized,
  };
  if (extra.touser) payload.touser = extra.touser;
  if (extra.page) payload.page = extra.page;
  if (extra.miniprogramState) payload.miniprogram_state = extra.miniprogramState;
  if (extra.lang) payload.lang = extra.lang;

  return payload;
}

module.exports = { buildSubscribePayload };
