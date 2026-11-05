'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { start } = require('../server/mock-server');

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('mock server', () => {
  let server;
  let port;

  before(async () => {
    const started = await start(0); // ephemeral
    server = started.server;
    port = started.port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /health', async () => {
    const r = await request(port, 'GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  it('POST /mock/subscribe/send valid', async () => {
    const r = await request(port, 'POST', '/mock/subscribe/send', {
      template_id: 'TMPL_ORDER_SHIPPED',
      data: {
        character_string1: { value: 'ORD1' },
        thing2: { value: '商品' },
        time3: { value: '2026-11-05 10:00' },
        phrase4: { value: '已发货' },
        amount5: { value: '¥1.00' },
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.errcode, 0);
  });

  it('POST /mock/subscribe/send invalid data → 47003', async () => {
    const r = await request(port, 'POST', '/mock/subscribe/send', {
      template_id: 'TMPL_ORDER_SHIPPED',
      data: {
        character_string1: { value: 'ORD1' },
        thing2: { value: '超长'.repeat(20) },
        time3: { value: 'bad' },
        phrase4: { value: '六个汉字啊啊' },
        amount5: { value: 'nope' },
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.errcode, 47003);
    assert.ok(Array.isArray(r.body.lab_errors));
  });

  it('POST /mock/pay/notify with MOCK_SKIP_SIGN', async () => {
    process.env.MOCK_SKIP_SIGN = '1';
    const r = await request(port, 'POST', '/mock/pay/notify', {
      out_trade_no: 'LAB001',
      total_fee: '1',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.return_code, 'SUCCESS');
    delete process.env.MOCK_SKIP_SIGN;
  });

  it('POST /mock/pay/notify verifies HMAC when sign required', async () => {
    delete process.env.MOCK_SKIP_SIGN;
    process.env.MOCK_API_KEY = 'lab-test-key';
    const raw = JSON.stringify({ out_trade_no: 'LAB002', total_fee: '2' });
    const sign = crypto.createHmac('sha256', 'lab-test-key').update(raw).digest('hex');
    const r = await request(port, 'POST', '/mock/pay/notify', raw, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(raw),
      'x-lab-sign': sign,
    });
    // re-send with string body via custom — our helper stringifies objects; pass as already handled
    assert.equal(r.status, 200);
    assert.equal(r.body.errcode, 0);
  });
});
