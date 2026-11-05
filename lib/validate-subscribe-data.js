/**
 * WeChat subscribe-message data field validators (offline, deterministic).
 * Rules mirror documented WeChat template keyword types.
 */

'use strict';

/** Count "display units": CJK ideographs / fullwidth = 1, ASCII letter/digit/symbol = 1 each. */
function displayLen(str) {
  return [...String(str)].length;
}

function isAsciiLetters(str) {
  return /^[A-Za-z\s.'-]+$/.test(str);
}

function mostlyChinese(str) {
  const chars = [...String(str)].filter((c) => c.trim());
  if (!chars.length) return false;
  const cjk = chars.filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
  return cjk / chars.length >= 0.5;
}

const TYPE_RULES = {
  thing: {
    check(value) {
      const v = String(value);
      if (!v) return 'thing 不能为空';
      if (displayLen(v) > 20) return `thing 最长 20 个字符，当前 ${displayLen(v)}`;
      return null;
    },
  },
  time: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'time 不能为空';
      // Accept: YYYY-MM-DD HH:mm[:ss], YYYY/MM/DD HH:mm, HH:mm[:ss], YYYY年MM月DD日 HH:mm
      const patterns = [
        /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/,
        /^\d{1,2}:\d{2}(:\d{2})?$/,
        /^\d{4}年\d{1,2}月\d{1,2}日(\s*\d{1,2}:\d{2}(:\d{2})?)?$/,
      ];
      if (!patterns.some((p) => p.test(v))) {
        return 'time 格式无效，示例：2026-11-05 10:00 或 10:00';
      }
      return null;
    },
  },
  date: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'date 不能为空';
      const patterns = [
        /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
        /^\d{4}年\d{1,2}月\d{1,2}日$/,
      ];
      if (!patterns.some((p) => p.test(v))) {
        return 'date 格式无效，示例：2026-11-05 或 2026年11月5日';
      }
      return null;
    },
  },
  amount: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'amount 不能为空';
      // ¥12.50 / ￥12.50 / 12.50元 / 12.50 / USD 1.00 etc.
      if (!/^[¥￥$]?\s*\d+(\.\d{1,2})?\s*元?$/.test(v) && !/^[A-Z]{3}\s*\d+(\.\d{1,2})?$/.test(v)) {
        return 'amount 格式无效，示例：¥12.50 或 12.50元';
      }
      return null;
    },
  },
  name: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'name 不能为空';
      const len = displayLen(v);
      if (mostlyChinese(v) || /[\u4e00-\u9fff]/.test(v)) {
        if (len > 10) return `name 中文最长 10 个字，当前 ${len}`;
      } else if (isAsciiLetters(v)) {
        if (len > 20) return `name 英文最长 20 个字母，当前 ${len}`;
      } else {
        if (len > 10) return `name 混合内容按中文规则最长 10，当前 ${len}`;
      }
      return null;
    },
  },
  phrase: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'phrase 不能为空';
      if (displayLen(v) > 5) return `phrase 最长 5 个汉字，当前 ${displayLen(v)}`;
      return null;
    },
  },
  number: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'number 不能为空';
      if (!/^-?\d+(\.\d+)?$/.test(v)) return 'number 必须是数字字符串';
      if (v.replace(/^-/, '').length > 32) return 'number 过长（建议 ≤32）';
      return null;
    },
  },
  character_string: {
    check(value) {
      const v = String(value);
      if (!v) return 'character_string 不能为空';
      if (displayLen(v) > 32) return `character_string 最长 32，当前 ${displayLen(v)}`;
      return null;
    },
  },
  phone_number: {
    check(value) {
      const v = String(value).trim();
      if (!v) return 'phone_number 不能为空';
      // Mainland 11-digit, or +86 / with dashes
      if (!/^(\+?86[-\s]?)?1[3-9]\d{9}$/.test(v) && !/^\d{7,15}$/.test(v)) {
        return 'phone_number 格式无效';
      }
      return null;
    },
  },
  car_number: {
    check(value) {
      const v = String(value).trim().toUpperCase();
      if (!v) return 'car_number 不能为空';
      // Simplified CN plate: 京A12345 / 京AD12345 (新能源)
      if (!/^[\u4e00-\u9fff][A-Z][A-Z0-9]{4,6}$/.test(v)) {
        return 'car_number 格式无效，示例：京A12345';
      }
      return null;
    },
  },
  enum: {
    check(value) {
      if (value === undefined || value === null || String(value) === '') {
        return 'enum 不能为空';
      }
      return null;
    },
  },
};

/**
 * @param {Record<string, string|{type:string}>} templateFields
 *   Map of fieldKey -> type string, or { type }
 * @param {Record<string, {value: string}|string>} data
 *   WeChat-style data object
 * @returns {{ ok: boolean, errors: Array<{field:string,type:string,message:string,value:*}> }}
 */
function validateSubscribeData(templateFields, data) {
  const errors = [];
  if (!templateFields || typeof templateFields !== 'object') {
    return { ok: false, errors: [{ field: '*', type: '', message: 'templateFields 必须是对象', value: templateFields }] };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: [{ field: '*', type: '', message: 'data 必须是对象', value: data }] };
  }

  for (const [field, spec] of Object.entries(templateFields)) {
    const type = typeof spec === 'string' ? spec : (spec && spec.type) || '';
    const raw = data[field];
    if (raw === undefined || raw === null) {
      errors.push({ field, type, message: `缺少字段 ${field}`, value: raw });
      continue;
    }
    const value = typeof raw === 'object' && raw !== null && 'value' in raw ? raw.value : raw;
    const rule = TYPE_RULES[type];
    if (!rule) {
      errors.push({ field, type, message: `未知字段类型: ${type}`, value });
      continue;
    }
    const msg = rule.check(value);
    if (msg) {
      errors.push({ field, type, message: msg, value });
    }
  }

  // Extra keys in data that are not in template — warn as soft errors
  for (const key of Object.keys(data)) {
    if (!(key in templateFields)) {
      errors.push({
        field: key,
        type: '',
        message: `数据中存在模板未声明的字段: ${key}`,
        value: typeof data[key] === 'object' && data[key] !== null && 'value' in data[key] ? data[key].value : data[key],
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateSubscribeData,
  TYPE_RULES,
  displayLen,
};
