'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const spider = require('../src/spiders/example-mock.js');

test('mock spider exposes site meta', () => {
  assert.equal(spider.site_key, 'example-mock');
  assert.equal(typeof spider.init, 'function');
  assert.equal(typeof spider.homeContent, 'function');
  assert.equal(typeof spider.categoryContent, 'function');
  assert.equal(typeof spider.detailContent, 'function');
  assert.equal(typeof spider.playerContent, 'function');
  assert.equal(typeof spider.searchContent, 'function');
});

test('init returns object', async () => {
  const r = await spider.init({ ext: { foo: 'bar' } });
  assert.equal(typeof r, 'object');
  assert.equal(typeof r.ext, 'object');
});

test('homeContent returns class + non-empty list', async () => {
  const r = await spider.homeContent({});
  assert.ok(Array.isArray(r.class));
  assert.ok(r.class.length >= 1);
  assert.ok(Array.isArray(r.list));
  assert.ok(r.list.length >= 1);
  // 检查 vod_id 字段
  assert.equal(typeof r.list[0].vod_id, 'string');
  assert.equal(typeof r.list[0].vod_name, 'string');
});

test('categoryContent supports position args', async () => {
  const r = await spider.categoryContent('movie', 1, {}, {});
  assert.ok(Array.isArray(r.list));
  assert.equal(r.page, 1);
});

test('categoryContent supports object args (some forks)', async () => {
  const r = await spider.categoryContent({ cateId: 'tv', page: 1, filter: {}, extend: {} });
  assert.ok(Array.isArray(r.list));
  assert.equal(r.page, 1);
});

test('detailContent returns list with play_url', async () => {
  const r = await spider.detailContent(['m001']);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].vod_id, 'm001');
  assert.match(r.list[0].vod_play_url, /m001/);
});

test('playerContent returns url + flag', () => {
  const r = spider.playerContent(null, 'm001$1', {});
  assert.equal(r.flag, 'example-mock');
  assert.match(r.url, /m001-01\.m3u8/);
});

test('searchContent filters by keyword', async () => {
  const a = await spider.searchContent('示例', false, 1);
  assert.ok(a.list.length > 0);
  const b = await spider.searchContent('zzz_no_match_zzz', false, 1);
  assert.equal(b.list.length, 0);
});

test('homeContent still works even with custom sink config', async () => {
  // 注入一个 special userConfig via require
  // 这里仅做基本健壮性检查：传入 filter=null 不应炸
  const r = await spider.homeContent(null);
  assert.ok(Array.isArray(r.class));
  assert.ok(Array.isArray(r.list));
});
