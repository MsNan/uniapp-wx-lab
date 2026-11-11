'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../server/mock-server');
const { encryptNotifyResource, buildNotifySignMessage, LAB_APIV3_KEY } = require('../lib/pay-v3');

const ENV_KEYS = ['MOCK_SKIP_SIGN', 'MOCK_WXPAY_PUBLIC_KEY', 'MOCK_WXPAY_PUBLIC_KEY_FILE', 'MOCK_WXPAY_SERIAL', 'MOCK_APIV3_KEY', 'MOCK_MAX_SKEW_SECONDS'];

function post(port, pathname, raw, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, text, body: text ? JSON.parse(text) : null });
        });
      }
    );
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: pathname }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    }).on('error', reject);
  });
}

function makeNotify(outTradeNo, key = LAB_APIV3_KEY) {
  const tx = { mchid: '1900000000', out_trade_no: outTradeNo, transaction_id: 'LABTX' + outTradeNo, trade_state: 'SUCCESS', amount: { total: 1, currency: 'CNY' } };
  return JSON.stringify({
    id: 'EV-' + outTradeNo,
    create_time: '2026-11-11T10:00:00+08:00',
    resource_type: 'encrypt-resource',
    event_type: 'TRANSACTION.SUCCESS',
    summary: '支付成功',
    resource: encryptNotifyResource(tx, key, { nonce: 'labnonce0042' }),
  });
}

function signHeaders(raw, privateKey, { ts = Math.floor(Date.now() / 1000), serial = 'PUB_KEY_ID_LAB0001', signature } = {}) {
  const nonce = 'n' + crypto.randomBytes(8).toString('hex');
  const sig = signature || crypto.sign('RSA-SHA256', Buffer.from(buildNotifySignMessage(String(ts), nonce, raw)), privateKey).toString('base64');
  return { 'Wechatpay-Timestamp': String(ts), 'Wechatpay-Nonce': nonce, 'Wechatpay-Signature': sig, 'Wechatpay-Serial': serial };
}

describe('POST /mock/pay/notify-v3', () => {
  let server;
  let port;
  let dir;
  let pubFile;
  let privateKey;

  before(async () => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxlab-v3-'));
    pubFile = path.join(dir, 'pub.pem');
    fs.writeFileSync(pubFile, pair.publicKey.export({ type: 'spki', format: 'pem' }));
    ({ server, port } = await start(0));
  });

  after(async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it('签名正确 → 204 无包体，/mock/pay/recent 能看到解密结果', async () => {
    process.env.MOCK_WXPAY_PUBLIC_KEY_FILE = pubFile;
    const raw = makeNotify('V3OK1');
    const r = await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey));
    assert.equal(r.status, 204);
    assert.equal(r.text, '');
    const recent = await getJson(port, '/mock/pay/recent');
    const last = recent.items[recent.items.length - 1];
    assert.equal(last.ok, true);
    assert.equal(last.out_trade_no, 'V3OK1');
    assert.equal(last.trade_state, 'SUCCESS');
    assert.equal(last.duplicate, false);
  });

  it('重复通知仍应答 204，并标记 duplicate', async () => {
    process.env.MOCK_WXPAY_PUBLIC_KEY_FILE = pubFile;
    const raw = makeNotify('V3DUP');
    assert.equal((await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey))).status, 204);
    assert.equal((await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey))).status, 204);
    const recent = await getJson(port, '/mock/pay/recent');
    assert.equal(recent.items[recent.items.length - 1].duplicate, true);
  });

  it('body 被改动 → 401 + { code: FAIL }', async () => {
    process.env.MOCK_WXPAY_PUBLIC_KEY_FILE = pubFile;
    const raw = makeNotify('V3TAMPER');
    const headers = signHeaders(raw, privateKey);
    const r = await post(port, '/mock/pay/notify-v3', raw.replace('支付成功', '支付成功 '), headers);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'FAIL');
    assert.ok(r.body.message);
  });

  it('签名探测 WECHATPAY/SIGNTEST/ 即使 MOCK_SKIP_SIGN=1 也按失败应答', async () => {
    process.env.MOCK_SKIP_SIGN = '1';
    const raw = makeNotify('V3PROBE');
    const r = await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey, { signature: 'WECHATPAY/SIGNTEST/abc' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'FAIL');
    assert.equal(r.body.lab.probe, true);
  });

  it('未配置公钥且未跳过验签 → 401 并提示怎么配置', async () => {
    const raw = makeNotify('V3NOKEY');
    const r = await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey));
    assert.equal(r.status, 401);
    assert.match(r.body.lab.tip, /MOCK_WXPAY_PUBLIC_KEY_FILE/);
  });

  it('序列号不匹配 / 时间戳过旧 → 401', async () => {
    process.env.MOCK_WXPAY_PUBLIC_KEY_FILE = pubFile;
    process.env.MOCK_WXPAY_SERIAL = 'PUB_KEY_ID_OTHER';
    const raw = makeNotify('V3SERIAL');
    let r = await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey));
    assert.equal(r.status, 401);
    assert.match(r.body.lab.reason, /Serial/);
    delete process.env.MOCK_WXPAY_SERIAL;
    r = await post(port, '/mock/pay/notify-v3', raw, signHeaders(raw, privateKey, { ts: Math.floor(Date.now() / 1000) - 3600 }));
    assert.equal(r.status, 401);
    assert.match(r.body.lab.reason, /时间戳/);
  });

  it('MOCK_SKIP_SIGN=1 时只练解密：错误 APIv3 密钥 → 400 解密失败', async () => {
    process.env.MOCK_SKIP_SIGN = '1';
    process.env.MOCK_APIV3_KEY = 'x'.repeat(32);
    const raw = makeNotify('V3BADKEY');
    const r = await post(port, '/mock/pay/notify-v3', raw);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'FAIL');
    assert.match(r.body.lab.reason, /解密失败/);
  });

  it('仓库样例 pay-notify-v3.json 在 MOCK_SKIP_SIGN=1 下可直接解密', async () => {
    process.env.MOCK_SKIP_SIGN = '1';
    const raw = fs.readFileSync(path.join(__dirname, '..', 'examples', 'payloads', 'pay-notify-v3.json'), 'utf8');
    const r = await post(port, '/mock/pay/notify-v3', raw);
    assert.equal(r.status, 204);
  });

  it('非 JSON / 缺 resource → 400', async () => {
    process.env.MOCK_SKIP_SIGN = '1';
    assert.equal((await post(port, '/mock/pay/notify-v3', 'not json')).status, 400);
    assert.equal((await post(port, '/mock/pay/notify-v3', '{"id":"x"}')).status, 400);
  });
});
