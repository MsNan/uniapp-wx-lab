'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildNotifySignMessage,
  verifyNotifySignature,
  decryptNotifyResource,
  encryptNotifyResource,
} = require('../lib');

const LAB_KEY = 'uniapp-wx-lab-demo-apiv3-key-32b';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

function sign(ts, nonce, body) {
  return crypto.sign('RSA-SHA256', Buffer.from(buildNotifySignMessage(ts, nonce, body)), privateKey).toString('base64');
}

describe('buildNotifySignMessage', () => {
  it('three lines, each ending with \\n (empty body keeps the last \\n)', () => {
    assert.equal(buildNotifySignMessage('1554209980', 'abc', '{"a":1}'), '1554209980\nabc\n{"a":1}\n');
    assert.equal(buildNotifySignMessage('1', 'n', ''), '1\nn\n\n');
  });
});

describe('verifyNotifySignature', () => {
  const body = '{"id":"EV-1","resource":{"ciphertext":"x"}}';
  const ts = '1762650000';
  const nonce = 'c5ac7061fccab6bf3e254dcf98995b8c';
  const headers = {
    'wechatpay-timestamp': ts,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': sign(ts, nonce, body),
    'wechatpay-serial': 'PUB_KEY_ID_0000000001',
  };

  it('accepts a valid signature from lower-case headers', () => {
    const r = verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts) + 10 });
    assert.equal(r.ok, true, r.reason);
  });

  it('rejects when body was re-serialized', () => {
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    const r = verifyNotifySignature({ headers, body: reformatted, publicKey: pubPem, now: Number(ts) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /签名不匹配/);
  });

  it('treats WECHATPAY/SIGNTEST/ as probe traffic (fail)', () => {
    const r = verifyNotifySignature({
      headers: { ...headers, 'wechatpay-signature': 'WECHATPAY/SIGNTEST/abc' },
      body, publicKey: pubPem, now: Number(ts),
    });
    assert.equal(r.ok, false);
    assert.equal(r.probe, true);
  });

  it('checks serial, timestamp skew and missing headers', () => {
    assert.match(verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts), expectedSerial: 'OTHER' }).reason, /Serial 不匹配/);
    assert.match(verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts) + 301 }).reason, /300 秒/);
    assert.equal(verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts) + 9999, maxSkewSeconds: 0 }).ok, true);
    assert.match(verifyNotifySignature({ body, publicKey: pubPem }).reason, /缺少/);
    assert.match(verifyNotifySignature({ headers, body, now: Number(ts) }).reason, /publicKey/);
  });

  it('matches openssl dgst -sha256 -verify (independent check)', (t) => {
    let hasOpenssl = true;
    try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }
    if (!hasOpenssl) return t.skip('openssl not installed');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wxlab-'));
    fs.writeFileSync(path.join(dir, 'pub.pem'), pubPem);
    fs.writeFileSync(path.join(dir, 'sig.bin'), Buffer.from(headers['wechatpay-signature'], 'base64'));
    fs.writeFileSync(path.join(dir, 'msg.txt'), buildNotifySignMessage(ts, nonce, body));
    const out = execFileSync('openssl', ['dgst', '-sha256', '-verify', path.join(dir, 'pub.pem'), '-signature', path.join(dir, 'sig.bin'), path.join(dir, 'msg.txt')]).toString();
    assert.match(out, /Verified OK/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('decryptNotifyResource', () => {
  it('round-trips with encryptNotifyResource', () => {
    const res = encryptNotifyResource({ out_trade_no: 'LAB1', trade_state: 'SUCCESS' }, LAB_KEY);
    assert.equal(res.algorithm, 'AEAD_AES_256_GCM');
    assert.equal(res.nonce.length, 12);
    assert.deepEqual(decryptNotifyResource(res, LAB_KEY), { out_trade_no: 'LAB1', trade_state: 'SUCCESS' });
  });

  it('decrypts the repo sample notify', () => {
    const n = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/payloads/pay-notify-v3.json'), 'utf8'));
    const plain = decryptNotifyResource(n.resource, LAB_KEY);
    assert.equal(plain.out_trade_no, 'LAB20261109001');
    assert.equal(plain.amount.total, 1);
  });

  it('empty associated_data works', () => {
    const res = encryptNotifyResource('hello', LAB_KEY, { associated_data: '' });
    assert.equal(decryptNotifyResource(res, LAB_KEY, { parse: false }), 'hello');
  });

  it('fails clearly on wrong key, wrong aad, tampering, bad key length, bad algorithm', () => {
    const res = encryptNotifyResource({ a: 1 }, LAB_KEY);
    assert.throws(() => decryptNotifyResource(res, 'X'.repeat(32)), /解密失败/);
    assert.throws(() => decryptNotifyResource({ ...res, associated_data: 'certificate' }, LAB_KEY), /解密失败/);
    const buf = Buffer.from(res.ciphertext, 'base64'); buf[0] ^= 1;
    assert.throws(() => decryptNotifyResource({ ...res, ciphertext: buf.toString('base64') }, LAB_KEY), /解密失败/);
    assert.throws(() => decryptNotifyResource(res, 'short'), /32 字节/);
    assert.throws(() => decryptNotifyResource({ ...res, algorithm: 'AES_256_CBC' }, LAB_KEY), /不支持/);
  });
});

describe('cli decrypt-notify', () => {
  const cli = path.join(__dirname, '../bin/cli.js');
  const sample = path.join(__dirname, '../examples/payloads/pay-notify-v3.json');
  it('decrypts sample with --lab-key and reads key from WXPAY_APIV3_KEY', () => {
    const a = JSON.parse(execFileSync(process.execPath, [cli, 'decrypt-notify', sample, '--lab-key']).toString());
    assert.equal(a.ok, true);
    assert.equal(a.resource.trade_state, 'SUCCESS');
    const env = { ...process.env, WXPAY_APIV3_KEY: LAB_KEY };
    const b = JSON.parse(execFileSync(process.execPath, [cli, 'decrypt-notify', sample], { env }).toString());
    assert.equal(b.event_type, 'TRANSACTION.SUCCESS');
  });
  it('exits 1 without a key', () => {
    const env = { ...process.env }; delete env.WXPAY_APIV3_KEY;
    assert.throws(() => execFileSync(process.execPath, [cli, 'decrypt-notify', sample], { env, stdio: 'pipe' }));
  });
});

describe('verifyNotifySignature option guards', () => {
  const body = '{"id":"EV-2"}';
  const ts = '1762650000';
  const nonce = 'n2';
  const headers = { 'wechatpay-timestamp': ts, 'wechatpay-nonce': nonce, 'wechatpay-signature': sign(ts, nonce, body) };

  it('invalid maxSkewSeconds does not silently disable the timestamp check', () => {
    for (const m of ['', 'abc', '5m', -1, null, NaN]) {
      const r = verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts) + 86400, maxSkewSeconds: m });
      assert.equal(r.ok, false, `maxSkewSeconds=${String(m)}`);
      assert.match(r.reason, /maxSkewSeconds/);
    }
    assert.equal(verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts) + 86400, maxSkewSeconds: 0 }).ok, true);
    assert.equal(verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts) + 10, maxSkewSeconds: '60' }).ok, true);
  });

  it('expectedSerial set but Wechatpay-Serial missing → fail', () => {
    const r = verifyNotifySignature({ headers, body, publicKey: pubPem, now: Number(ts), expectedSerial: 'S1' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /缺少 Wechatpay-Serial/);
    assert.equal(verifyNotifySignature({ headers: { ...headers, 'Wechatpay-Serial': 'S1' }, body, publicKey: pubPem, now: Number(ts), expectedSerial: 'S1' }).ok, true);
  });
});
