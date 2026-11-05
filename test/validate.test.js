'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSubscribeData,
  checkSubscribeTiming,
  buildSubscribePayload,
  displayLen,
} = require('../lib');

describe('validateSubscribeData', () => {
  it('passes a valid order-shipped payload', () => {
    const fields = {
      character_string1: 'character_string',
      thing2: 'thing',
      time3: 'time',
      phrase4: 'phrase',
      amount5: 'amount',
    };
    const data = {
      character_string1: { value: 'ORD001' },
      thing2: { value: '窑河特产' },
      time3: { value: '2026-11-05 10:00' },
      phrase4: { value: '已发货' },
      amount5: { value: '¥128.00' },
    };
    const r = validateSubscribeData(fields, data);
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });

  it('fails thing overflow (>20)', () => {
    const fields = { thing1: 'thing' };
    const data = { thing1: { value: '一二三四五六七八九十一二三四五六七八九十一' } }; // 21
    assert.equal(displayLen(data.thing1.value), 21);
    const r = validateSubscribeData(fields, data);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.field === 'thing1' && /20/.test(e.message)));
  });

  it('accepts Chinese name ≤10 and rejects >10', () => {
    const fields = { name1: 'name' };
    assert.equal(validateSubscribeData(fields, { name1: { value: '郭涛同志好啊啊' } }).ok, true); // 7
    const long = validateSubscribeData(fields, { name1: { value: '一二三四五六七八九十一' } });
    assert.equal(long.ok, false);
    assert.ok(long.errors[0].message.includes('中文'));
  });

  it('accepts English name ≤20 and rejects longer', () => {
    const fields = { name1: 'name' };
    assert.equal(validateSubscribeData(fields, { name1: { value: 'Theo Tangping' } }).ok, true);
    const long = 'A'.repeat(21);
    const r = validateSubscribeData(fields, { name1: { value: long } });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].message.includes('英文'));
  });

  it('fails phrase longer than 5 Chinese chars', () => {
    const fields = { phrase1: 'phrase' };
    const r = validateSubscribeData(fields, { phrase1: { value: '已经发货成功' } }); // 6
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].message.includes('5'));
  });

  it('validates amount formats', () => {
    const fields = { amount1: 'amount' };
    assert.equal(validateSubscribeData(fields, { amount1: { value: '¥12.50' } }).ok, true);
    assert.equal(validateSubscribeData(fields, { amount1: { value: '12.50元' } }).ok, true);
    assert.equal(validateSubscribeData(fields, { amount1: { value: '好多钱' } }).ok, false);
  });

  it('reports missing field', () => {
    const fields = { thing1: 'thing', time2: 'time' };
    const r = validateSubscribeData(fields, { thing1: { value: 'ok' } });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.field === 'time2' && /缺少/.test(e.message)));
  });

  it('reports unknown type', () => {
    const r = validateSubscribeData({ x: 'not_a_real_type' }, { x: { value: '1' } });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].message.includes('未知'));
  });

  it('validates phone_number and car_number', () => {
    const fields = { phone_number4: 'phone_number', car_number5: 'car_number' };
    assert.equal(
      validateSubscribeData(fields, {
        phone_number4: { value: '13800138000' },
        car_number5: { value: '京A12345' },
      }).ok,
      true
    );
    assert.equal(
      validateSubscribeData(fields, {
        phone_number4: { value: 'abc' },
        car_number5: { value: 'XX' },
      }).ok,
      false
    );
  });

  it('validates number and character_string', () => {
    const fields = { n: 'number', c: 'character_string' };
    assert.equal(validateSubscribeData(fields, { n: { value: '42' }, c: { value: 'ABC-001' } }).ok, true);
    assert.equal(validateSubscribeData(fields, { n: { value: 'x' }, c: { value: 'A'.repeat(33) } }).ok, false);
  });

  it('accepts bare string values as well as {value}', () => {
    const fields = { thing1: 'thing' };
    assert.equal(validateSubscribeData(fields, { thing1: '短标题' }).ok, true);
  });
});

describe('checkSubscribeTiming', () => {
  it('allows after user gesture or pay callback', () => {
    assert.equal(checkSubscribeTiming({ afterUserGesture: true }).allowed, true);
    assert.equal(checkSubscribeTiming({ afterPayCallback: true }).allowed, true);
    const bad = checkSubscribeTiming({});
    assert.equal(bad.allowed, false);
    assert.ok(bad.tip.includes('手势') || bad.tip.includes('支付'));
  });
});

describe('buildSubscribePayload', () => {
  it('normalizes data and attaches template_id', () => {
    const p = buildSubscribePayload('TMPL_X', { thing1: 'hello' }, { touser: 'oOPEN', page: 'pages/index/index' });
    assert.equal(p.template_id, 'TMPL_X');
    assert.deepEqual(p.data.thing1, { value: 'hello' });
    assert.equal(p.touser, 'oOPEN');
    assert.equal(p.page, 'pages/index/index');
  });
});
