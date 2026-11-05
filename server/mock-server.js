'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { validateSubscribeData } = require('../lib/validate-subscribe-data');
const { SAMPLE_TEMPLATES } = require('./templates');

const DEFAULT_PORT = 3789;
const MAX_STORE = 50;
const store = [];

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

module.exports = { createApp, start, DEFAULT_PORT, SAMPLE_TEMPLATES, store };
