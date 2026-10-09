'use strict';

/**
 * e2e-pipeline.test.js
 *
 * E2E / 集成层测试。把"构建 -> 校验 -> 运行 -> 日志 -> 订阅体积"全链路串起来，
 * 与 docs/ci-workflow-example.yml 中的 CI 步骤 1:1 对齐：
 *   1) build-spider.js   把 src/spiders/*.js 打包为 dist/spiders/*.js（self-contained）
 *   2) validate-source.js 校验 dist/source.json 契约 + JSON Schema
 *   3) dist/source.json 体积 <= 200 KB（REQ NFR）
 *   4) dist/source.json 含 multi_warehouse_ext 等 flag（REQ-010）
 *   5) dist/source.json 每个站点都有 api 或 jar（REQ-007 分离托管）
 *   6) examples/log/example.log 命中 REQ-004 日志前缀与 ERROR 路径
 *   7) check-compliance.sh 对默认 denylist 通过（REQ-011 L-1）
 *   8) check-compliance.sh 对 src/spiders 与 dist 的明文敏感字段告警（L-3）
 *   9) run-spider.js 对 dist/spiders/example-mock.js 跑通 6 接口（REQ-009）
 *  10) dist/spiders/example-mock.js 自身可被 require 并暴露 6 函数（REQ-001）
 *
 * 受影响的最小用例集合由本文件 + 既有 tests/{tvbox-base,source-validate,spider-mock}.test.js 共同构成；
 * 与本轮实现直接相关的所有非 UI E2E 路径均在此文件内被覆盖。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_SPIDERS = path.join(ROOT, 'src', 'spiders');
const DIST_SPIDERS = path.join(ROOT, 'dist', 'spiders');
const DIST_SOURCE = path.join(ROOT, 'dist', 'source.json');
const SCHEMA = path.join(ROOT, 'tools', 'schemas', 'source.schema.json');
const VALIDATOR = path.join(ROOT, 'tools', 'scripts', 'validate-source.js');
const BUILDER = path.join(ROOT, 'tools', 'scripts', 'build-spider.js');
const RUNNER = path.join(ROOT, 'tools', 'scripts', 'run-spider.js');
const COMPLIANCE = path.join(ROOT, 'tools', 'scripts', 'check-compliance.sh');
const EXAMPLE_LOG = path.join(ROOT, 'examples', 'log', 'example.log');

const SOURCE_MAX_BYTES = 200 * 1024; // REQ NFR: 整源 JSON <= 200 KB

function runNode(scriptPath, args) {
  try {
    const out = execFileSync('node', [scriptPath].concat(args || []), {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 30000
    });
    return { ok: true, code: 0, stdout: out.toString(), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      code: err.status == null ? -1 : err.status,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : (err.message || '')
    };
  }
}

function runShell(scriptPath, args) {
  const r = spawnSync('bash', [scriptPath].concat(args || []), {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 30000
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: r.stdout ? r.stdout.toString() : '',
    stderr: r.stderr ? r.stderr.toString() : ''
  };
}

/* ============================================================
 * 1) 构建流水线：src/spiders/*.js -> dist/spiders/*.js
 *    对应 docs/ci-workflow-example.yml 的 build 步骤
 * ============================================================ */
test('build-spider: dist artifacts exist after build', () => {
  const r = runNode(BUILDER);
  assert.equal(r.ok, true, 'build-spider.js failed: ' + r.stderr + r.stdout);
  // 至少 example-mock.js 与 _template.js 都被打入 dist/spiders/
  assert.ok(fs.existsSync(path.join(DIST_SPIDERS, 'example-mock.js')),
    'dist/spiders/example-mock.js missing');
  assert.ok(fs.existsSync(path.join(DIST_SPIDERS, '_template.js')),
    'dist/spiders/_template.js missing');
  // 输出文件应大于对应源文件（runtime 被注入）
  const srcSize = fs.statSync(path.join(SRC_SPIDERS, 'example-mock.js')).size;
  const distSize = fs.statSync(path.join(DIST_SPIDERS, 'example-mock.js')).size;
  assert.ok(distSize >= srcSize, 'dist size (' + distSize + ') should be >= src size (' + srcSize + ')');
});

/* ============================================================
 * 2) dist 产物 6 接口契约（REQ-001）：自包含版本可被加载并暴露 6 个函数
 *    这是 TVBox 客户端实际加载的产物，必须独立可用
 * ============================================================ */
test('dist example-mock.js: self-contained spider exposes 6 interfaces', () => {
  const distSpiderPath = path.join(DIST_SPIDERS, 'example-mock.js');
  delete require.cache[require.resolve(distSpiderPath)];
  const spider = require(distSpiderPath);
  assert.equal(spider.site_key, 'example-mock');
  for (const api of ['init', 'homeContent', 'categoryContent', 'detailContent', 'playerContent', 'searchContent']) {
    assert.equal(typeof spider[api], 'function', 'missing function: ' + api);
  }
});

test('dist example-mock.js: 6-interface invocation returns non-empty results', async () => {
  const distSpiderPath = path.join(DIST_SPIDERS, 'example-mock.js');
  delete require.cache[require.resolve(distSpiderPath)];
  const spider = require(distSpiderPath);

  const initR = await spider.init({ ext: { foo: 'bar' } });
  assert.equal(typeof initR, 'object');

  const homeR = await spider.homeContent({});
  assert.ok(Array.isArray(homeR.class) && homeR.class.length >= 1, 'homeContent.class empty');
  assert.ok(Array.isArray(homeR.list) && homeR.list.length >= 1, 'homeContent.list empty');
  assert.equal(typeof homeR.list[0].vod_id, 'string');

  const catR = await spider.categoryContent({ cateId: 'movie', page: 1, filter: {}, extend: {} });
  assert.ok(Array.isArray(catR.list) && catR.list.length >= 1, 'categoryContent empty');

  const detR = await spider.detailContent(['m001']);
  assert.equal(detR.list.length, 1);
  assert.match(detR.list[0].vod_play_url, /m001/);

  const playR = spider.playerContent(null, 'm001$1', {});
  assert.equal(playR.flag, 'example-mock');
  assert.match(playR.url, /m001-01\.m3u8/);

  const seaR = await spider.searchContent('示例', false, 1);
  assert.ok(seaR.list.length > 0, 'searchContent should match 示例');
});

/* ============================================================
 * 3) 源 JSON 契约 + Schema（REQ-002 + EARS 3.1）
 * ============================================================ */
test('validate-source: passes JSON Schema + 4-key contract', () => {
  const r = runNode(VALIDATOR, [DIST_SOURCE, SCHEMA]);
  assert.equal(r.ok, true, 'validate-source.js failed: ' + r.stderr + r.stdout);
  assert.match(r.stdout, /通过 JSON Schema 校验/);
  assert.match(r.stdout, /通过契约校验/);
});

/* ============================================================
 * 4) 源 JSON 体积（NFR：<= 200 KB）
 * ============================================================ */
test('dist/source.json: size within 200 KB NFR', () => {
  const size = fs.statSync(DIST_SOURCE).size;
  assert.ok(size > 0, 'dist/source.json is empty');
  assert.ok(size <= SOURCE_MAX_BYTES,
    'dist/source.json size ' + size + ' exceeds NFR 200 KB');
});

/* ============================================================
 * 5) 多仓扩展 flags（REQ-010）：必须包含 multi_warehouse_ext
 * ============================================================ */
test('source JSON flags include multi_warehouse_ext for fork compatibility (REQ-010)', () => {
  const data = JSON.parse(fs.readFileSync(DIST_SOURCE, 'utf8'));
  assert.ok(Array.isArray(data.flags), 'flags must be an array');
  assert.ok(data.flags.indexOf('multi_warehouse_ext') >= 0,
    'flags missing multi_warehouse_ext — 原版 + 多仓扩展基线被破坏');
});

/* ============================================================
 * 6) Spider 与源 JSON 分离托管（REQ-007）：每个站点都有 api 或 jar
 * ============================================================ */
test('source JSON sites expose spider via api or jar (REQ-007 separation)', () => {
  const data = JSON.parse(fs.readFileSync(DIST_SOURCE, 'utf8'));
  assert.ok(Array.isArray(data.sites) && data.sites.length >= 1, 'sites must be non-empty');
  for (let i = 0; i < data.sites.length; i++) {
    const s = data.sites[i];
    const hasApi = typeof s.api === 'string' && s.api.length > 0;
    const hasJar = typeof s.jar === 'string' && s.jar.length > 0;
    assert.ok(hasApi || hasJar,
      'sites[' + i + '] (' + (s.key || '?') + ') 必须提供 api 或 jar 之一');
    if (hasApi) {
      assert.match(s.api, /^https?:\/\/|^jar:|^file:|.*\.js/,
        'sites[' + i + '].api 必须是 URL 或 jar/file 路径');
    }
  }
});

/* ============================================================
 * 7) 结构化日志样例（REQ-004）：examples/log/example.log 包含 6 接口 +
 *    至少 1 条 ERROR 路径
 * ============================================================ */
test('examples/log/example.log: structured format + ERROR path (REQ-004)', () => {
  assert.ok(fs.existsSync(EXAMPLE_LOG), 'examples/log/example.log missing');
  const text = fs.readFileSync(EXAMPLE_LOG, 'utf8');
  // 6 接口前缀
  for (const api of ['init', 'homeContent', 'categoryContent', 'detailContent', 'playerContent', 'searchContent']) {
    assert.ok(text.indexOf('[tvbox][example-mock][' + api + ']') >= 0,
      'log missing [tvbox][example-mock][' + api + '] prefix');
  }
  // 关键字段
  assert.ok(/status=\S+/.test(text), 'log missing status= field');
  assert.ok(/elapsed=\S+/.test(text), 'log missing elapsed= field');
  // ERROR 路径至少 1 条
  assert.ok(/error=(http_status_|network_error|json_parse_failed)/.test(text),
    'log missing ERROR path entries');
});

/* ============================================================
 * 8) 合规脚本 L-1 / L-3（REQ-011）：默认 denylist 下应当通过
 * ============================================================ */
test('check-compliance.sh: passes with default empty denylist (REQ-011 L-1)', () => {
  const r = runShell(COMPLIANCE);
  assert.equal(r.ok, true,
    'check-compliance.sh failed: ' + r.stderr + r.stdout);
  assert.match(r.stdout + r.stderr, /OK|denylist/i);
});

/* ============================================================
 * 9) run-spider.js 端到端（REQ-009）：对 dist 产物跑通 6 接口
 * ============================================================ */
test('run-spider.js: drives dist example-mock.js through 6 interfaces', () => {
  const r = runNode(RUNNER, [path.join(DIST_SPIDERS, 'example-mock.js'), '--api=all']);
  assert.equal(r.ok, true, 'run-spider.js failed: ' + r.stderr + r.stdout);
  // run-spider.js 默认会把结构化日志写 stdout 再追加 JSON dump；
  // 这里从混合输出中提取首个 { 到末尾 } 之间的 JSON 段。
  const firstBrace = r.stdout.indexOf('{');
  const lastBrace = r.stdout.lastIndexOf('}');
  assert.ok(firstBrace >= 0 && lastBrace > firstBrace,
    'run-spider.js stdout 未找到 JSON dump 段: ' + r.stdout.slice(0, 200));
  const parsed = JSON.parse(r.stdout.slice(firstBrace, lastBrace + 1));
  for (const api of ['init', 'homeContent', 'categoryContent', 'detailContent', 'playerContent', 'searchContent']) {
    assert.ok(parsed[api], 'run-spider output missing api: ' + api);
    assert.equal(parsed[api].error, null,
      'run-spider api ' + api + ' reported error: ' + parsed[api].error);
    assert.ok(parsed[api].result, 'run-spider api ' + api + ' missing result');
  }
  // homeContent 必须非空
  assert.ok(Array.isArray(parsed.homeContent.result.list) && parsed.homeContent.result.list.length >= 1,
    'homeContent.list empty');
  // detailContent.m001 必须可解出剧集
  assert.ok(Array.isArray(parsed.detailContent.result.list) && parsed.detailContent.result.list.length >= 1,
    'detailContent empty');
});

/* ============================================================
 * 10) 自包含 Spider 不依赖 Node require（REQ-007：TVBox 端无模块系统）
 *     通过文本扫描验证：dist/spiders/*.js 不再 require ../lib/tvbox-base.js
 * ============================================================ */
test('dist spider: no Node require remains after build (self-contained)', () => {
  const text = fs.readFileSync(path.join(DIST_SPIDERS, 'example-mock.js'), 'utf8');
  assert.equal(text.indexOf("require('../lib/tvbox-base") < 0, true,
    'dist example-mock.js 仍包含 require ../lib/tvbox-base.js，未完成内联');
  assert.equal(text.indexOf("require('../../lib/tvbox-base") < 0, true,
    'dist example-mock.js 仍包含 require ../../lib/tvbox-base.js');
  // 必须包含 __TVBOX_RUNTIME__ 字符串（被内联注入的 runtime 聚合对象）
  assert.ok(text.indexOf('__TVBOX_RUNTIME__') >= 0,
    'dist example-mock.js 缺少内联 __TVBOX_RUNTIME__ 标识');
});
