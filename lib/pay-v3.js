'use strict';

/**
 * 微信支付 APIv3 回调通知：验签 + 解密（零依赖，仅用 Node 内置 crypto）。
 *
 * 规则来源（微信支付官方文档，2026-11 核对）：
 * - 验签串 = `${Wechatpay-Timestamp}\n${Wechatpay-Nonce}\n${原始请求体}\n`
 *   用 Wechatpay-Serial 对应的「微信支付平台证书 / 微信支付公钥」做 SHA256 with RSA 验签，
 *   签名值是 Wechatpay-Signature 的 Base64 解码结果。
 * - 以 "WECHATPAY/SIGNTEST/" 开头的签名是微信的签名探测流量，必须当作验签失败处理。
 * - resource.algorithm 目前为 AEAD_AES_256_GCM：key = 32 字节 APIv3 密钥，
 *   iv = resource.nonce，aad = resource.associated_data（可为空），
 *   ciphertext Base64 解码后最后 16 字节是 GCM 认证标签。
 *
 * 本模块只做本地离线计算：不联网、不下载平台证书、不保存任何密钥。
 */

const crypto = require('crypto');

const SIGN_PROBE_PREFIX = 'WECHATPAY/SIGNTEST/';
const GCM_TAG_LENGTH = 16;

function buildNotifySignMessage(timestamp, nonce, body) {
  return `${timestamp}\n${nonce}\n${body == null ? '' : body}\n`;
}

function pickHeader(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

/**
 * @param {object} opts
 * @param {object} [opts.headers]   原始请求头（自动取 Wechatpay-Timestamp/Nonce/Signature/Serial）
 * @param {string} [opts.timestamp] / nonce / signature / serial 也可单独传
 * @param {string|Buffer} opts.body 原始请求体（切勿用 JSON.parse 后再 stringify 的字符串）
 * @param {string|crypto.KeyObject} opts.publicKey 平台证书 PEM、公钥 PEM 或 KeyObject
 * @param {string} [opts.expectedSerial] 你持有的证书序列号 / 公钥 ID，填了就会比对
 * @param {number} [opts.maxSkewSeconds=300] 时间戳与当前时间允许的偏差，0 表示不检查
 * @param {number} [opts.now] 当前时间（秒），测试用
 * @returns {{ ok: boolean, reason?: string, probe?: boolean, message?: string }}
 */
function verifyNotifySignature(opts) {
  const o = opts || {};
  const timestamp = o.timestamp ?? pickHeader(o.headers, 'Wechatpay-Timestamp');
  const nonce = o.nonce ?? pickHeader(o.headers, 'Wechatpay-Nonce');
  const signature = o.signature ?? pickHeader(o.headers, 'Wechatpay-Signature');
  const serial = o.serial ?? pickHeader(o.headers, 'Wechatpay-Serial');
  const body = Buffer.isBuffer(o.body) ? o.body.toString('utf8') : o.body;

  if (!timestamp || !nonce || !signature) {
    return { ok: false, reason: '缺少 Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Signature' };
  }
  if (typeof body !== 'string') {
    return { ok: false, reason: 'body 必须是原始请求体字符串或 Buffer' };
  }
  if (String(signature).startsWith(SIGN_PROBE_PREFIX)) {
    return { ok: false, probe: true, reason: '签名探测流量（WECHATPAY/SIGNTEST/），应按验签失败应答 4xx/5xx' };
  }
  if (o.expectedSerial && serial && String(serial) !== String(o.expectedSerial)) {
    return { ok: false, reason: `Wechatpay-Serial 不匹配：收到 ${serial}，期望 ${o.expectedSerial}（可能需要更新平台证书 / 公钥）` };
  }
  if (!/^\d+$/.test(String(timestamp))) {
    return { ok: false, reason: 'Wechatpay-Timestamp 不是秒级数字时间戳' };
  }
  const maxSkew = o.maxSkewSeconds === undefined ? 300 : Number(o.maxSkewSeconds);
  if (maxSkew > 0) {
    const now = o.now === undefined ? Math.floor(Date.now() / 1000) : Number(o.now);
    if (Math.abs(now - Number(timestamp)) > maxSkew) {
      return { ok: false, reason: `时间戳与当前时间相差超过 ${maxSkew} 秒（可能是重放或服务器时间不准）` };
    }
  }
  if (!o.publicKey) {
    return { ok: false, reason: '缺少 publicKey（微信支付平台证书或微信支付公钥 PEM）' };
  }

  const message = buildNotifySignMessage(timestamp, nonce, body);
  let ok = false;
  try {
    ok = crypto.verify('RSA-SHA256', Buffer.from(message, 'utf8'), o.publicKey, Buffer.from(String(signature), 'base64'));
  } catch (err) {
    return { ok: false, reason: `公钥或签名格式错误：${err.message}` };
  }
  return ok ? { ok: true, message } : { ok: false, reason: '签名不匹配（检查是否用了原始 body、是否用了平台证书而不是商户证书）', message };
}

function toKeyBuffer(apiV3Key) {
  const key = Buffer.isBuffer(apiV3Key) ? apiV3Key : Buffer.from(String(apiV3Key || ''), 'utf8');
  if (key.length !== 32) {
    throw new Error(`APIv3 密钥必须是 32 字节，当前 ${key.length} 字节（注意不是 APIv2 密钥，也不要带空格换行）`);
  }
  return key;
}

/**
 * 解密回调通知里的 resource。
 * @param {{algorithm?:string, ciphertext:string, nonce:string, associated_data?:string}} resource
 * @param {string|Buffer} apiV3Key 32 字节 APIv3 密钥
 * @param {{ parse?: boolean }} [options] parse=false 时返回明文字符串
 */
function decryptNotifyResource(resource, apiV3Key, options = {}) {
  if (!resource || typeof resource !== 'object') throw new Error('resource 必须是对象');
  const algorithm = resource.algorithm || 'AEAD_AES_256_GCM';
  if (algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error(`不支持的加密算法：${algorithm}（目前只支持 AEAD_AES_256_GCM）`);
  }
  if (!resource.ciphertext || !resource.nonce) throw new Error('resource 缺少 ciphertext 或 nonce');
  const key = toKeyBuffer(apiV3Key);
  const raw = Buffer.from(String(resource.ciphertext), 'base64');
  if (raw.length <= GCM_TAG_LENGTH) throw new Error('ciphertext 太短，不是合法的 AES-GCM 密文');
  const data = raw.subarray(0, raw.length - GCM_TAG_LENGTH);
  const tag = raw.subarray(raw.length - GCM_TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(resource.nonce), 'utf8'));
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(String(resource.associated_data || ''), 'utf8'));
  let plain;
  try {
    plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('解密失败：APIv3 密钥、nonce 或 associated_data 不对，或密文被改动');
  }
  if (options.parse === false) return plain;
  try {
    return JSON.parse(plain);
  } catch {
    return plain;
  }
}

/**
 * 按同样格式加密（只用于本地造测试数据 / Mock，真实回调由微信支付加密）。
 */
function encryptNotifyResource(plain, apiV3Key, options = {}) {
  const key = toKeyBuffer(apiV3Key);
  const nonce = options.nonce || crypto.randomBytes(6).toString('hex'); // 12 个字符
  const associatedData = options.associated_data ?? 'transaction';
  const text = typeof plain === 'string' ? plain : JSON.stringify(plain);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    original_type: options.original_type || 'transaction',
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: enc.toString('base64'),
    associated_data: associatedData,
    nonce,
  };
}

module.exports = {
  SIGN_PROBE_PREFIX,
  buildNotifySignMessage,
  verifyNotifySignature,
  decryptNotifyResource,
  encryptNotifyResource,
};
