#!/usr/bin/env node
'use strict';

/**
 * validate-source.js
 *
 * 校验 source.json：
 *   1) 必须可被 JSON.parse 解析；
 *   2) 顶层仅允许 sites / parses / rules / flags 四个键（R-05 / REQ-002）；
 *   3) sites[i].api / jar / type / key 等关键字段类型正确；
 *   4) 不允许 base64 / 短链 / 暗链（N-6 / D-5 / L-1）。
 *
 * 用法：
 *   node tools/scripts/validate-source.js <source.json>
 *   node tools/scripts/validate-source.js <source.json> <schema.json>
 */

const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error('[validate-source] FAIL: ' + msg);
  process.exit(1);
}

function ok(msg) {
  console.log('[validate-source] OK: ' + msg);
}

const ALLOWED_TOP_KEYS = new Set(['sites', 'parses', 'rules', 'flags']);
const ALLOWED_SITE_KEYS = new Set([
  'key', 'name', 'type', 'api', 'jar', 'ext', 'searchable', 'quickSearch', 'filterable',
  'headers', 'proxy', 'custom', 'playerType', 'timeout', 'ua'
]);

// 直接命中字符串关键字（base64 / 短链）
const FORBIDDEN_TOKEN_PATTERNS = [
  /\bbase64\b/i,
  /b64decode|base64decode/i,
  /\bredirector\b|\bshorturl\b|\bshort\.link\b|\btinyurl\b/i,
  /data:.*base64/i
];

// URL 路径段中长 base64 字符串（>=24 字符，base64 字符集 + URL-safe）
const B64_SEGMENT_PATTERN = /^[A-Za-z0-9+_\-=/]{24,}$/;

function looksLikeBase64Segment(url) {
  if (!url) return false;
  const parts = String(url).split(/[\/?&#:]/);
  for (const p of parts) {
    if (B64_SEGMENT_PATTERN.test(p)) return true;
  }
  return false;
}

function isUrlOrPath(s) {
  if (typeof s !== 'string') return false;
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.startsWith('jar:') || s.startsWith('file:')) return true;
  if (s.startsWith('./') || s.startsWith('/') || s.endsWith('.js')) return true;
  return false;
}

function checkSite(idx, site) {
  if (!site || typeof site !== 'object') fail('sites[' + idx + '] 不是对象');
  if (typeof site.key !== 'string' || !site.key) fail('sites[' + idx + '].key 缺失');
  if (typeof site.name !== 'string' || !site.name) fail('sites[' + idx + '].name 缺失');
  if (!isUrlOrPath(site.api)) fail('sites[' + idx + '].api 必须是 URL 或 jar/file 路径（疑似 base64 / 暗链）');
  if (typeof site.type !== 'number') fail('sites[' + idx + '].type 必须是 number');
  for (const k of Object.keys(site)) {
    if (!ALLOWED_SITE_KEYS.has(k)) {
      fail('sites[' + idx + '].' + k + ' 不是源 JSON 顶层协议字段（请使用 ext/custom 或在 docs/扩展字段.md 登记）');
    }
  }
  // 反 base64 / 暗链 / 短链
  for (const pat of FORBIDDEN_TOKEN_PATTERNS) {
    if (pat.test(site.api || '')) {
      fail('sites[' + idx + '].api 命中禁止模式（疑似 base64 / 暗链 / 短链）: ' + site.api);
    }
  }
  if (looksLikeBase64Segment(site.api)) {
    fail('sites[' + idx + '].api 包含可疑的长 base64 段（疑似暗链）: ' + site.api);
  }
  if (site.jar) {
    if (!isUrlOrPath(site.jar)) fail('sites[' + idx + '].jar 必须是 URL 或 jar 路径');
    if (looksLikeBase64Segment(site.jar)) {
      fail('sites[' + idx + '].jar 包含可疑的长 base64 段（疑似暗链）: ' + site.jar);
    }
  }
  if (site.headers && typeof site.headers !== 'object') fail('sites[' + idx + '].headers 必须是对象');
  if (site.custom && typeof site.custom !== 'object') fail('sites[' + idx + '].custom 必须是对象');
  if (site.proxy && typeof site.proxy !== 'string') fail('sites[' + idx + '].proxy 必须是字符串');
}

function checkJson(obj, sourcePath) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(sourcePath + ' 必须是 JSON 对象');
  const keys = Object.keys(obj);
  if (keys.length === 0) fail(sourcePath + ' 不允许为空');
  for (const k of keys) {
    if (!ALLOWED_TOP_KEYS.has(k)) fail('顶层包含不允许的键: ' + k + '（R-05：仅 sites / parses / rules / flags）');
  }
  if (!Array.isArray(obj.sites) || obj.sites.length === 0) fail('顶层 sites 必须为非空数组');
  if (obj.parses && !Array.isArray(obj.parses)) fail('parses 必须是数组');
  if (obj.rules && !Array.isArray(obj.rules)) fail('rules 必须是数组');
  if (obj.flags && !Array.isArray(obj.flags)) fail('flags 必须是数组');
  obj.sites.forEach(function(s, i){ checkSite(i, s); });
}

function loadJson(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (err) { fail('无法读取文件: ' + p); }
  try { return JSON.parse(raw); }
  catch (err) { fail('JSON 解析失败: ' + p + ': ' + err.message); }
}

function validateJsonSchema(data, schema) {
  const errors = [];
  function fail2(p, msg) { errors.push(p + ' ' + msg); }
  function check(value, sch, p) {
    if (!sch) return;
    if (Array.isArray(sch.anyOf)) {
      const saved = errors.length;
      for (let i = 0; i < sch.anyOf.length; i++) {
        errors.length = 0;
        check(value, sch.anyOf[i], p);
        if (errors.length === 0) { errors.length = saved; return; }
      }
      errors.length = saved;
      fail2(p, '不匹配 anyOf 任何分支');
      return;
    }
    if (sch.type) {
      const t = Array.isArray(sch.type) ? sch.type : [sch.type];
      const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      if (!t.includes(actualType)) { fail2(p, '期望类型 ' + t.join('/') + '，实际 ' + actualType); return; }
    }
    if (sch.enum && sch.enum.indexOf(value) < 0) { fail2(p, '值不在 enum 中: ' + JSON.stringify(value)); return; }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const props = sch.properties || {};
      const required = sch.required || [];
      for (let i = 0; i < required.length; i++) {
        const r = required[i];
        if (!(r in value)) fail2(p, '缺少必填字段: ' + r);
      }
      const allowExtra = sch.additionalProperties !== false;
      if (!allowExtra) {
        for (const k in value) if (!(k in props)) fail2(p + '.' + k, '不允许的额外字段');
      }
      for (const k in props) if (k in value) check(value[k], props[k], p + '.' + k);
    }
    if (Array.isArray(value) && sch.items) {
      for (let i = 0; i < value.length; i++) check(value[i], sch.items, p + '[' + i + ']');
    }
  }
  check(data, schema, '$');
  return errors;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('用法: node tools/scripts/validate-source.js <source.json> [schema.json]');
    process.exit(2);
  }
  const sourcePath = argv[0];
  if (!fs.existsSync(sourcePath)) fail('找不到 source.json: ' + sourcePath);
  const data = loadJson(sourcePath);
  checkJson(data, path.basename(sourcePath));
  if (argv.length >= 2) {
    const schemaPath = argv[1];
    if (!fs.existsSync(schemaPath)) fail('找不到 schema.json: ' + schemaPath);
    const schema = loadJson(schemaPath);
    const errors = validateJsonSchema(data, schema);
    if (errors.length > 0) fail('JSON Schema 不通过: \n  ' + errors.join('\n  '));
    ok('通过 JSON Schema 校验');
  }
  ok('通过契约校验: ' + sourcePath);
}

if (require.main === module) main();
