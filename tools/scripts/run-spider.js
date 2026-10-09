#!/usr/bin/env node
'use strict';

/**
 * run-spider.js
 *
 * 在 Node 环境中以"等同 TVBox 客户端"的方式调用某个 Spider 的 6 个接口，
 * 并把响应内容打印到 stdout，便于本地 curl/自测替代（REQ-009）。
 *
 * 用法：
 *   node tools/scripts/run-spider.js <spider.js> [--api=<name>] [--print]
 *
 * 示例：
 *   node tools/scripts/run-spider.js src/spiders/example-mock.js
 *   node tools/scripts/run-spider.js src/spiders/example-mock.js --api=homeContent
 *   node tools/scripts/run-spider.js src/spiders/example-mock.js --api=categoryContent --args='["movie",1,{},{}]'
 *
 * 同时模拟 TVBox 客户端将调用结果作为 JSON 返回，便于快速回归。
 */

const path = require('path');
const fs = require('fs');

function fail(msg) { console.error('[run-spider] ' + msg); process.exit(1); }

function parseArgs(argv) {
  const opts = { spider: null, api: 'all', args: null, print: false, dump: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--api=')) opts.api = a.slice('--api='.length);
    else if (a.startsWith('--args=')) opts.args = a.slice('--args='.length);
    else if (a === '--print') opts.print = true;
    else if (a === '--dump') opts.dump = true;
    else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/scripts/run-spider.js <spider.js> [--api=<name>] [--args=\'<json>\'] [--print] [--dump]');
      process.exit(0);
    }
    else positional.push(a);
  }
  opts.spider = positional[0] || null;
  return opts;
}

function loadSpider(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) fail('找不到 spider 文件: ' + abs);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function pickArgs(api, argsJson) {
  const defaults = {
    init: [{}],
    homeContent: [{}],
    categoryContent: ['all', 1, {}, {}],
    detailContent: [['m001']],
    playerContent: [null, 'm001$1', {}],
    searchContent: ['示例', false, 1]
  };
  if (argsJson) {
    try {
      const parsed = JSON.parse(argsJson);
      if (!Array.isArray(parsed)) fail('--args 必须是 JSON 数组');
      return parsed;
    } catch (err) {
      fail('--args JSON 解析失败: ' + err.message);
    }
  }
  return defaults[api] || [];
}

async function call(spider, api, args) {
  const fn = spider[api];
  if (typeof fn !== 'function') fail('spider 中没有导出函数: ' + api);
  return await fn.apply(spider, args);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.spider) fail('请提供 spider 路径');
  const spider = loadSpider(opts.spider);
  const apis = opts.api === 'all'
    ? ['init', 'homeContent', 'categoryContent', 'detailContent', 'playerContent', 'searchContent']
    : [opts.api];

  const results = {};
  for (const api of apis) {
    const args = pickArgs(api, opts.args);
    const start = Date.now();
    let res, err = null;
    try {
      res = await call(spider, api, args);
    } catch (e) {
      err = e && e.message ? e.message : String(e);
    }
    results[api] = { elapsedMs: Date.now() - start, error: err, result: res };
  }

  // 输出机器可读结果
  if (opts.dump) {
    process.stdout.write(JSON.stringify(results, null, 2));
  } else if (opts.print) {
    for (const api of apis) {
      const r = results[api];
      console.log('--- ' + api + ' (' + r.elapsedMs + 'ms) ---');
      if (r.error) console.log('ERROR: ' + r.error);
      else console.log(JSON.stringify(r.result, null, 2));
    }
  } else {
    // 默认 dump
    process.stdout.write(JSON.stringify(results, null, 2));
  }
}

if (require.main === module) main();
