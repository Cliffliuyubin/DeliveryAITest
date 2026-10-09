/**
 * tvbox-base: TVBox Spider 工具库（核心运行时）
 *
 * 这是被 Spider 文件和本地工具脚本共用的一套基础工具：
 *   - 配置合并（headers / proxy / custom / 自定义参数）
 *   - 网络请求（fetch wrapper + 超时 + 默认 headers + mask）
 *   - 结构化日志（[tvbox][site][api] status elapsed error）
 *   - 错误模型兜底（异常返回 {} 或 {list:[]}，并记录 ERROR 日志）
 *   - 工具函数（mask / pick / safeJson / retry / etc.）
 *
 * 重要：
 *   1) 本文件可以 require 使用（Node 工具链 / 测试）；
 *   2) 同时通过 `runtimeSource` 暴露字符串源码，供 Spider 文件 inline 引用（TVBox 客户端直接加载时无 Node 模块系统可用）。
 *   3) 所有日志字段都不允许打印完整 Cookie / Authorization（REQ-004 / L-3）。
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 5000;

const SENSITIVE_HEADER_KEYS = new Set([
  'cookie',
  'authorization',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization'
]);

function mask(value) {
  if (value == null) return value;
  const s = String(value);
  if (s.length <= 4) return '***';
  return s.slice(0, 2) + '***' + s.slice(-2) + '(len=' + s.length + ')';
}

function maskHeaderValue(name, value) {
  if (value == null) return value;
  if (SENSITIVE_HEADER_KEYS.has(String(name).toLowerCase())) {
    return mask(value);
  }
  return value;
}

function maskHeaders(headers) {
  if (!headers) return {};
  const out = {};
  for (const k of Object.keys(headers)) {
    out[k] = maskHeaderValue(k, headers[k]);
  }
  return out;
}

function pick(obj, keys) {
  if (!obj) return {};
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      out[k] = obj[k];
    }
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeConfig(defaults, overrides) {
  const out = Object.assign({}, defaults || {});
  if (!isPlainObject(overrides)) return out;
  for (const key of Object.keys(overrides)) {
    const def = out[key];
    const val = overrides[key];
    if (isPlainObject(def) && isPlainObject(val)) {
      out[key] = mergeConfig(def, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function createLogger(site, sink) {
  const prefix = '[tvbox][' + site + ']';
  const emit = sink || ((level, line) => {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  });
  return {
    log(api, fields) {
      const f = isPlainObject(fields) ? fields : {};
      const status = f.status == null ? 'null' : String(f.status);
      const elapsed = f.elapsed == null ? 'null' : String(f.elapsed) + 'ms';
      const url = f.url == null ? 'null' : String(f.url);
      const error = f.error == null ? 'null' : String(f.error);
      const line = prefix + '[' + api + '] status=' + status + ' elapsed=' + elapsed + ' url=' + url + ' error=' + error;
      const level = f.level || (f.error ? 'error' : status.startsWith('2') ? 'info' : status === 'null' ? 'warn' : 'warn');
      emit(level, line);
    },
    info(api, fields) { fields = Object.assign({}, fields, { level: 'info' }); this.log(api, fields); },
    warn(api, fields) { fields = Object.assign({}, fields, { level: 'warn' }); this.log(api, fields); },
    error(api, fields) { fields = Object.assign({}, fields, { level: 'error' }); this.log(api, fields); }
  };
}

async function safeFetch(url, options, config, logger) {
  const opts = mergeConfig({
    method: 'GET',
    headers: {},
    timeoutMs: DEFAULT_TIMEOUT_MS,
    body: undefined,
    redirect: 'follow'
  }, options || {});
  const timeoutMs = config && config.timeoutMs ? config.timeoutMs : opts.timeoutMs;
  const headers = mergeConfig({}, opts.headers);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  const start = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: opts.method,
      headers: headers,
      body: opts.body,
      redirect: opts.redirect,
      signal: controller ? controller.signal : undefined
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    if (timer) clearTimeout(timer);
    if (logger) {
      logger.warn('fetch', { status: 'timeout-or-network', elapsed: elapsed, url: url, error: err && err.message ? err.message : String(err) });
    }
    const e = new Error('network_error');
    e.code = 'NETWORK_ERROR';
    e.cause = err;
    throw e;
  }
  if (timer) clearTimeout(timer);
  const elapsed = Date.now() - start;
  const status = response.status;
  const text = await response.text();
  if (logger) {
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level]('fetch', { status: status, elapsed: elapsed, url: url, error: null });
  }
  return { status: status, headers: response.headers, text: text, elapsed: elapsed, ok: response.ok };
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function createBase(site, userConfig) {
  const config = mergeConfig({
    headers: {
      'User-Agent': 'Mozilla/5.0 (TVBox-Compatibility; +https://github.com/tvbox)',
      'Accept': 'application/json, text/plain, */*'
    },
    proxy: '',
    custom: {},
    timeoutMs: DEFAULT_TIMEOUT_MS,
    logSink: null
  }, userConfig || {});

  const logger = createLogger(site || 'spider', config.logSink);

  async function fetchJson(url, options) {
    try {
      const r = await safeFetch(url, options, config, logger);
      if (!(r.status >= 200 && r.status < 300)) {
        const e = new Error('http_status_' + r.status);
        e.code = 'HTTP_STATUS';
        e.status = r.status;
        e.body = r.text;
        throw e;
      }
      const j = safeJsonParse(r.text);
      if (!j.ok) {
        const e = new Error('json_parse_failed');
        e.code = 'JSON_PARSE';
        e.cause = j.error;
        throw e;
      }
      return j.value;
    } catch (err) {
      // 错误日志不再重发（safeFetch 已经记录）
      throw err;
    }
  }

  async function fetchText(url, options) {
    try {
      const r = await safeFetch(url, options, config, logger);
      if (!(r.status >= 200 && r.status < 300)) {
        const e = new Error('http_status_' + r.status);
        e.code = 'HTTP_STATUS';
        e.status = r.status;
        e.body = r.text;
        throw e;
      }
      return r.text;
    } catch (err) {
      throw err;
    }
  }

  function maskForLog() {
    return {
      headers: maskHeaders(config.headers),
      custom: config.custom,
      proxy: config.proxy,
      timeoutMs: config.timeoutMs
    };
  }

  return {
    site: site,
    config: config,
    logger: logger,
    headers: config.headers,
    proxy: config.proxy,
    fetchJson: fetchJson,
    fetchText: fetchText,
    maskForLog: maskForLog
  };
}

function emptyListResult() { return { list: [] }; }
function emptyResult() { return {}; }

function withFallback(fn, fallback, logger, api) {
  if (typeof fn !== 'function') {
    return Promise.resolve(fallback());
  }
  return Promise.resolve()
    .then(() => fn())
    .catch((err) => {
      if (logger) {
        logger.error(api, { status: null, elapsed: 0, url: null, error: err && err.message ? err.message : String(err) });
      }
      return fallback();
    });
}

module.exports = {
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  SENSITIVE_HEADER_KEYS: SENSITIVE_HEADER_KEYS,
  mask: mask,
  maskHeaderValue: maskHeaderValue,
  maskHeaders: maskHeaders,
  pick: pick,
  mergeConfig: mergeConfig,
  isPlainObject: isPlainObject,
  createLogger: createLogger,
  safeFetch: safeFetch,
  safeJsonParse: safeJsonParse,
  createBase: createBase,
  emptyListResult: emptyListResult,
  emptyResult: emptyResult,
  withFallback: withFallback
};
