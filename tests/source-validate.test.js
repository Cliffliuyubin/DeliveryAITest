'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const VALIDATOR = path.resolve(__dirname, '..', 'tools', 'scripts', 'validate-source.js');
const SCHEMA = path.resolve(__dirname, '..', 'tools', 'schemas', 'source.schema.json');

function runValidator(sourcePath, schemaPath) {
  const args = [VALIDATOR, sourcePath];
  if (schemaPath) args.push(schemaPath);
  try {
    const out = execFileSync('node', args, { stdio: 'pipe' });
    return { ok: true, out: out.toString() };
  } catch (err) {
    return { ok: false, out: (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : ''), code: err.status };
  }
}

test('valid source.json passes schema', () => {
  const r = runValidator(path.resolve(__dirname, '..', 'dist/source.json'), SCHEMA);
  assert.equal(r.ok, true, 'validator failed: ' + r.out);
  assert.match(r.out, /通过 JSON Schema 校验/);
});

test('validator rejects extra top-level key', () => {
  const tmp = path.resolve(__dirname, '_tmp_bad_top.json');
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'dist/source.json'), 'utf8'));
  data.extraKey = 'x';
  fs.writeFileSync(tmp, JSON.stringify(data));
  const r = runValidator(tmp);
  fs.unlinkSync(tmp);
  assert.equal(r.ok, false);
  assert.match(r.out, /顶层包含不允许的键/);
});

test('validator rejects missing api', () => {
  const tmp = path.resolve(__dirname, '_tmp_bad_api.json');
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'dist/source.json'), 'utf8'));
  delete data.sites[0].api;
  fs.writeFileSync(tmp, JSON.stringify(data));
  const r = runValidator(tmp);
  fs.unlinkSync(tmp);
  assert.equal(r.ok, false);
  assert.match(r.out, /api/);
});

test('validator rejects extra site key not in protocol', () => {
  const tmp = path.resolve(__dirname, '_tmp_bad_site_key.json');
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'dist/source.json'), 'utf8'));
  data.sites[0].unknown_key = 'x';
  fs.writeFileSync(tmp, JSON.stringify(data));
  const r = runValidator(tmp);
  fs.unlinkSync(tmp);
  assert.equal(r.ok, false);
  assert.match(r.out, /不允许的额外字段|不是源 JSON 顶层协议字段/);
});

test('validator rejects base64 / dark link pattern (no URL prefix)', () => {
  const tmp = path.resolve(__dirname, '_tmp_b64.json');
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'dist/source.json'), 'utf8'));
  data.sites[0].api = 'aHR0cHM6Ly9leG1wbGUuY29tL3NkZmRzZg==extraextraextraextraextra';
  fs.writeFileSync(tmp, JSON.stringify(data));
  const r = runValidator(tmp);
  fs.unlinkSync(tmp);
  assert.equal(r.ok, false);
  // base64 串无 http:// 前缀，会先被 isUrlOrPath 拦截；这是 L-1 的实际拦截面之一
  assert.match(r.out, /api 必须是 URL 或 jar\/file 路径/);
});

test('validator rejects base64 hidden behind http://', () => {
  const tmp = path.resolve(__dirname, '_tmp_b64_url.json');
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'dist/source.json'), 'utf8'));
  // 即使有 http://，超过 16 字符的全 base64 字符段也应被禁止模式命中
  data.sites[0].api = 'https://abc.example.com/aHR0cHM6Ly9leG1wbGUuY29tL3NkZmRzZmFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=';
  fs.writeFileSync(tmp, JSON.stringify(data));
  const r = runValidator(tmp);
  fs.unlinkSync(tmp);
  assert.equal(r.ok, false);
  assert.match(r.out, /base64|禁止模式|暗链/);
});
