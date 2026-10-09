#!/usr/bin/env node
'use strict';

/**
 * build-spider.js
 *
 * 将 src/spiders/*.js（使用 Node require 的形式）打包成
 *   dist/spiders/*.js（self-contained，内嵌运行时；TVBox 客户端可直接加载）。
 *
 * 工作原理：
 *   1. 读取 src/lib/runtime-source.js 中导出的 RUNTIME_SOURCE 字符串；
 *   2. 读取每个 spider 源文件 `src/spiders/<name>.js`；
 *   3. 在 spider 文件顶部标记 `/* __TVBOX_BASE_RUNTIME__INJECTION_POINT__ *\/`
 *      处替换为 RUNTIME_SOURCE；
 *   4. 把 `require('../lib/tvbox-base.js')` 替换为对 inline 运行时对象 `__TVBOX_RUNTIME__` 的引用；
 *   5. 输出 `dist/spiders/<name>.js`。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src', 'spiders');
const DIST_DIR = path.join(ROOT, 'dist', 'spiders');
const RUNTIME_FILE = path.join(ROOT, 'src', 'lib', 'runtime-source.js');

const RUNTIME_TAG = '__TVBOX_BASE_RUNTIME__INJECTION_POINT__';

function fail(msg) {
  console.error('[build-spider] ' + msg);
  process.exit(2);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function transform(source) {
  const runtime = require(RUNTIME_FILE).RUNTIME_SOURCE;
  const tag = new RegExp('/\\*\\s*' + escapeRegex(RUNTIME_TAG) + '\\s*\\*/');
  if (!tag.test(source)) {
    fail('spider 源文件缺少内联标记 `/* ' + RUNTIME_TAG + ' */`');
  }
  const runtimeInline = runtime
    .replace(/^\/\/ __TVBOX_BASE_RUNTIME__begin[\r\n]+/m, '')
    .replace(/\/\/ __TVBOX_BASE_RUNTIME__end[\r\n]+$/m, '')
    .trim();
  let out = source.replace(tag, runtimeInline);
  // 替换 require('../lib/tvbox-base.js') 为引用 inline runtime 对象
  out = out.replace(/require\(['"](?:\.\.\/)+lib\/tvbox-base(?:\.js)?['"]\)/g, '__TVBOX_RUNTIME__');
  return out;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) fail('未找到 spider 源目录: ' + SRC_DIR);
  ensureDir(DIST_DIR);
  const entries = fs.readdirSync(SRC_DIR).filter(function(f){ return f.endsWith('.js'); });
  if (entries.length === 0) {
    console.log('[build-spider] 无 spider 源文件可构建');
    return;
  }
  const built = [];
  for (const file of entries) {
    const srcPath = path.join(SRC_DIR, file);
    const distPath = path.join(DIST_DIR, file);
    const src = fs.readFileSync(srcPath, 'utf8');
    let out;
    try {
      out = transform(src);
    } catch (err) {
      fail(file + ': ' + err.message);
    }
    fs.writeFileSync(distPath, out, 'utf8');
    built.push(path.relative(ROOT, distPath));
  }
  console.log('[build-spider] built ' + built.length + ' spider(s):');
  for (const p of built) console.log('  ' + p);
}

if (require.main === module) main();
