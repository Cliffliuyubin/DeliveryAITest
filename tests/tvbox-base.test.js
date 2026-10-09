'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const base = require('../src/lib/tvbox-base.js');

test('mask - hides middle chars', () => {
  assert.equal(base.mask('abcdef'), 'ab***ef(len=6)');
  assert.equal(base.mask('a'), '***');
  assert.equal(base.mask(null), null);
});

test('maskHeaders - preserves non-sensitive keys; masks cookie', () => {
  const headers = {
    'User-Agent': 'UA',
    'Cookie': 'sid=abcdefgh123',
    'authorization': 'Bearer eyJhbGciOi'
  };
  const m = base.maskHeaders(headers);
  assert.equal(m['User-Agent'], 'UA');
  assert.notEqual(m['Cookie'], 'sid=abcdefgh123');
  assert.notEqual(m['authorization'], 'Bearer eyJhbGciOi');
  // mask 后的字符串不应包含原文
  assert.equal(m['Cookie'].indexOf('abcdefgh123') < 0, true);
});

test('mergeConfig - deep merge with override', () => {
  const def = { headers: { 'User-Agent': 'A', 'X': '1' }, custom: { a: 1, b: 2 } };
  const ov = { headers: { 'X': '2', 'Y': '3' }, custom: { b: 22, c: 3 } };
  const out = base.mergeConfig(def, ov);
  assert.equal(out.headers['User-Agent'], 'A');
  assert.equal(out.headers['X'], '2');
  assert.equal(out.headers['Y'], '3');
  assert.equal(out.custom.a, 1);
  assert.equal(out.custom.b, 22);
  assert.equal(out.custom.c, 3);
});

test('safeJsonParse - returns {ok:true} or {ok:false}', () => {
  const a = base.safeJsonParse('{"x":1}');
  assert.equal(a.ok, true);
  assert.equal(a.value.x, 1);
  const b = base.safeJsonParse('{bad');
  assert.equal(b.ok, false);
  assert.match(b.error, /JSON|JSON/);
});

test('createBase - default config', () => {
  const b = base.createBase('test', null);
  assert.equal(b.site, 'test');
  assert.match(b.headers['User-Agent'], /TVBox/);
  assert.equal(typeof b.fetchJson, 'function');
});

test('createBase - allow custom config override', () => {
  const b = base.createBase('test', {
    headers: { 'User-Agent': 'X' },
    timeoutMs: 1000,
    custom: { foo: 'bar' }
  });
  assert.equal(b.headers['User-Agent'], 'X');
  assert.equal(b.config.timeoutMs, 1000);
  assert.equal(b.config.custom.foo, 'bar');
});

test('withFallback - returns fallback on throw', async () => {
  const logs = [];
  const logger = {
    error: (api, f) => logs.push({ api, f }),
    warn: () => {}, info: () => {}, log: () => {}
  };
  const out = await base.withFallback(
    () => { throw new Error('boom'); },
    () => ({ list: [] }),
    logger,
    'homeContent'
  );
  assert.deepEqual(out, { list: [] });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].api, 'homeContent');
  assert.match(logs[0].f.error, /boom/);
});

test('withFallback - returns fn() result if no throw', async () => {
  const out = await base.withFallback(
    () => ({ list: [1,2,3] }),
    () => ({ list: [] }),
    null,
    'homeContent'
  );
  assert.deepEqual(out, { list: [1,2,3] });
});

test('logger.log line format', () => {
  const captured = [];
  const logger = base.createLogger('S', (level, line) => captured.push({ level, line }));
  logger.info('homeContent', { status: 200, elapsed: 12, url: 'u', error: null });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].line.indexOf('[tvbox][S][homeContent]') >= 0, true);
  assert.equal(captured[0].line.indexOf('status=200') >= 0, true);
});
