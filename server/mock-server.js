'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { validateSubscribeData } = require('../lib/validate-subscribe-data');
const { SAMPLE_TEMPLATES } = require('./templates');
const fs = require('fs');
const { verifyNotifySignature, decryptNotifyResource, LAB_APIV3_KEY } = require('../lib/pay-v3');

const DEFAULT_PORT = 3789;
const MAX_STORE = 50;
const store = [];
const payStore = [];
const seenPayKeys = new Set();

function envTrue(name) {
  return process.env[name] === '1' || process.env[name] === 'true';
}

// APIv3 应答规则（微信支付官方「支付成功回调通知」文档）：
// 验签通过 → HTTP 200/204、无应答包体；验签失败 → 4XX/5XX，并返回 { code: 'FAIL', message }。
function v3Fail(res, status, message, extra) {
  const body = { code: 'FAIL', message };
  if (extra) body.lab = extra;
  return json(res, status, body);
}

function pushPay(entry) {
  payStore.push(entry);
  if (payStore.length > MAX_STORE) payStore.shift();
}

function loadPublicKey() {
  const inline = process.env.MOCK_WXPAY_PUBLIC_KEY;
  if (inline && inline.includes('-----BEGIN')) return inline;
  const file = process.env.MOCK_WXPAY_PUBLIC_KEY_FILE;
  if (file) return fs.readFileSync(file, 'utf8');
  return null;
}

async function handlePayNotifyV3(req, res) {
  const raw = await readBody(req);
  const at = new Date().toISOString();
  const skip = envTrue('MOCK_SKIP_SIGN');
  const signature = String(req.headers['wechatpay-signature'] || '');

  // 探测签名不管是否跳过验签都按失败处理：这正是要练习的分支
  if (signature.startsWith('WECHATPAY/SIGNTEST/')) {
    pushPay({ at, ok: false, step: 'verify', probe: true });
    return v3Fail(res, 401, '签名验证失败', { probe: true, tip: '签名探测流量（WECHATPAY/SIGNTEST/），按验签失败应答 4xx/5xx 即可，微信会带正确签名重发' });
  }

  if (!skip) {
    let publicKey;
    try {
      publicKey = loadPublicKey();
    } catch (err) {
      return v3Fail(res, 500, '读取公钥失败', { tip: `MOCK_WXPAY_PUBLIC_KEY_FILE 读取失败：${err.message}` });
    }
    if (!publicKey) {
      pushPay({ at, ok: false, step: 'verify', reason: 'no public key configured' });
      return v3Fail(res, 401, '签名验证失败', {
        tip: '设置 MOCK_WXPAY_PUBLIC_KEY_FILE（平台证书 / 微信支付公钥 PEM 路径）以验签，或 MOCK_SKIP_SIGN=1 只练习解密',
      });
    }
    const maxSkew = process.env.MOCK_MAX_SKEW_SECONDS === undefined ? undefined : process.env.MOCK_MAX_SKEW_SECONDS;
    const v = verifyNotifySignature({
      headers: req.headers,
      body: raw,
      publicKey,
      expectedSerial: process.env.MOCK_WXPAY_SERIAL || undefined,
      maxSkewSeconds: maxSkew,
    });
    if (!v.ok) {
      pushPay({ at, ok: false, step: 'verify', reason: v.reason });
      return v3Fail(res, 401, '签名验证失败', { reason: v.reason });
    }
  }

  let notify;
  try {
    notify = JSON.parse(raw);
  } catch {
    pushPay({ at, ok: false, step: 'parse', reason: 'body is not JSON' });
    return v3Fail(res, 400, '报文格式错误', { reason: '回调 body 不是 JSON' });
  }
  if (!notify || typeof notify.resource !== 'object' || notify.resource === null) {
    pushPay({ at, ok: false, step: 'parse', reason: 'missing resource' });
    return v3Fail(res, 400, '报文格式错误', { reason: '缺少 resource 字段' });
  }

  let resource;
  try {
    resource = decryptNotifyResource(notify.resource, process.env.MOCK_APIV3_KEY || LAB_APIV3_KEY);
  } catch (err) {
    pushPay({ at, ok: false, step: 'decrypt', reason: err.message });
    return v3Fail(res, 400, '解密失败', { reason: err.message });
  }

  // 幂等：同一通知可能重复送达，已处理过也继续应答成功
  const outTradeNo = resource && typeof resource === 'object' ? resource.out_trade_no : undefined;
  const dedupKey = outTradeNo ? `${notify.event_type || ''}:${outTradeNo}` : notify.id ? `id:${notify.id}` : null;
  const duplicate = dedupKey ? seenPayKeys.has(dedupKey) : false;
  if (dedupKey) seenPayKeys.add(dedupKey);

  pushPay({
    at,
    ok: true,
    id: notify.id,
    event_type: notify.event_type,
    out_trade_no: outTradeNo,
    trade_state: resource && resource.trade_state,
    duplicate,
    skip_sign: skip,
    resource,
  });
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  return res.end();
}

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseMaybeJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function parseSimpleXml(xml) {
  const out = {};
  const re = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>([^<]*)<\/\3>/g;
  let m;
  while ((m = re.exec(xml))) {
    const key = m[1] || m[3];
    const val = m[2] !== undefined ? m[2] : m[4];
    out[key] = val;
  }
  return out;
}

function verifyHmacSha256(payload, sign, key) {
  const expected = crypto.createHmac('sha256', key).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sign).toLowerCase()));
  } catch {
    return false;
  }
}

function createApp() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      return json(res, 204, {});
    }

    if (method === 'GET' && path === '/health') {
      return json(res, 200, { ok: true, service: 'uniapp-wx-lab-mock', port: server.address()?.port || DEFAULT_PORT });
    }

    if (method === 'GET' && path === '/mock/subscribe/recent') {
      return json(res, 200, { count: store.length, items: store.slice(-MAX_STORE) });
    }

    if (method === 'GET' && path === '/mock/templates') {
      return json(res, 200, { templates: SAMPLE_TEMPLATES });
    }

    if (method === 'POST' && path === '/mock/subscribe/send') {
      const raw = await readBody(req);
      const body = parseMaybeJson(raw);
      const templateId = body.template_id || body.templateId;
      const data = body.data || {};
      const fields = SAMPLE_TEMPLATES[templateId];

      if (!templateId) {
        return json(res, 400, { errcode: 40037, errmsg: 'invalid template_id' });
      }
      if (!fields) {
        return json(res, 400, {
          errcode: 40037,
          errmsg: `unknown template_id (lab samples: ${Object.keys(SAMPLE_TEMPLATES).join(', ')})`,
        });
      }

      const result = validateSubscribeData(fields, data);
      if (!result.ok) {
        const entry = {
          at: new Date().toISOString(),
          template_id: templateId,
          ok: false,
          errors: result.errors,
        };
        store.push(entry);
        if (store.length > MAX_STORE) store.shift();
        return json(res, 400, {
          errcode: 47003,
          errmsg: 'argument invalid! data is invalid',
          lab_errors: result.errors,
        });
      }

      const entry = {
        at: new Date().toISOString(),
        template_id: templateId,
        ok: true,
        data,
        touser: body.touser || 'oLAB_TEST_OPENID',
      };
      store.push(entry);
      if (store.length > MAX_STORE) store.shift();
      return json(res, 200, { errcode: 0, errmsg: 'ok' });
    }

    if (method === 'GET' && path === '/mock/pay/recent') {
      return json(res, 200, { count: payStore.length, items: payStore.slice(-MAX_STORE) });
    }

    if (method === 'POST' && path === '/mock/pay/notify-v3') {
      return handlePayNotifyV3(req, res);
    }

    if (method === 'POST' && path === '/mock/pay/notify') {
      const raw = await readBody(req);
      const ct = String(req.headers['content-type'] || '');
      let notify;
      if (ct.includes('xml') || raw.trim().startsWith('<')) {
        notify = parseSimpleXml(raw);
        notify._format = 'xml';
      } else {
        notify = parseMaybeJson(raw);
        notify._format = 'json';
      }

      const skip = process.env.MOCK_SKIP_SIGN === '1' || process.env.MOCK_SKIP_SIGN === 'true';
      const apiKey = process.env.MOCK_API_KEY || 'lab-test-key';

      if (!skip) {
        const sign = notify.sign || notify.signature || req.headers['x-lab-sign'];
        const payloadForSign = notify._raw || raw;
        if (!sign || !verifyHmacSha256(payloadForSign, sign, apiKey)) {
          return json(res, 401, {
            errcode: 401,
            errmsg: 'sign verify failed',
            tip: '设置 MOCK_SKIP_SIGN=1 可跳过验签；否则用 MOCK_API_KEY（默认 lab-test-key）对 body 做 HMAC-SHA256 hex',
          });
        }
      }

      return json(res, 200, {
        errcode: 0,
        errmsg: 'ok',
        return_code: 'SUCCESS',
        return_msg: 'OK',
        received: {
          out_trade_no: notify.out_trade_no || notify.outTradeNo,
          total_fee: notify.total_fee || notify.amount,
          format: notify._format,
          skip_sign: skip,
        },
      });
    }

    json(res, 404, { errcode: 404, errmsg: `not found: ${method} ${path}` });
  });

  return server;
}

function start(port = Number(process.env.PORT) || DEFAULT_PORT) {
  const server = createApp();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, host: '127.0.0.1' });
    });
  });
}

module.exports = { createApp, start, DEFAULT_PORT, SAMPLE_TEMPLATES, store, payStore };
