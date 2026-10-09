'use strict';

/**
 * runtime-source: 导出 self-contained 形式的 Spider 运行时源码字符串。
 *
 * 用途：当 Spider JS 被打包为 TVBox 客户端直接加载的 self-contained 文件时，
 *       我们需要把 tvbox-base 的 runtime 直接 inline 进 Spider 文件头部，
 *       而不依赖 Node.js require。
 *
 * 字符串末尾会 export `__TVBOX_RUNTIME__`（一个聚合对象），与 src/lib/tvbox-base.js
 * 的 module.exports 形态完全等价。
 */

const RUNTIME_SOURCE = `// __TVBOX_BASE_RUNTIME__begin
'use strict';

var DEFAULT_TIMEOUT_MS = 5000;
var SENSITIVE_HEADER_KEYS = { cookie:1, authorization:1, 'x-api-key':1, 'x-auth-token':1, 'proxy-authorization':1 };

function __tvboxMask(value) {
  if (value == null) return value;
  var s = String(value);
  if (s.length <= 4) return '***';
  return s.slice(0,2) + '***' + s.slice(-2) + '(len=' + s.length + ')';
}
function __tvboxMaskHeaderValue(name, value) {
  if (value == null) return value;
  if (SENSITIVE_HEADER_KEYS[String(name).toLowerCase()]) return __tvboxMask(value);
  return value;
}
function __tvboxMaskHeaders(headers) {
  var out = {};
  if (!headers) return out;
  for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers,k)) out[k] = __tvboxMaskHeaderValue(k, headers[k]);
  return out;
}
function __tvboxIsPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function __tvboxMergeConfig(defs, over) {
  var out = defs || {};
  if (!__tvboxIsPlainObject(over)) {
    out = JSON.parse(JSON.stringify(out));
    return out;
  }
  out = JSON.parse(JSON.stringify(out));
  for (var key in over) {
    if (Object.prototype.hasOwnProperty.call(over, key)) {
      if (__tvboxIsPlainObject(out[key]) && __tvboxIsPlainObject(over[key])) {
        out[key] = __tvboxMergeConfig(out[key], over[key]);
      } else {
        out[key] = over[key];
      }
    }
  }
  return out;
}
function __tvboxCreateLogger(site, sink) {
  var prefix = '[tvbox][' + site + ']';
  function emit(level, line) {
    if (typeof sink === 'function') { try { sink(level, line); } catch(_){} return; }
    if (level === 'error') try{console.error(line)}catch(_){}
    else if (level === 'warn') try{console.warn(line)}catch(_){}
    else try{console.log(line)}catch(_){}
  }
  function log(api, fields) {
    fields = __tvboxIsPlainObject(fields) ? fields : {};
    var status = fields.status == null ? 'null' : String(fields.status);
    var elapsed = fields.elapsed == null ? 'null' : String(fields.elapsed) + 'ms';
    var url = fields.url == null ? 'null' : String(fields.url);
    var error = fields.error == null ? 'null' : String(fields.error);
    var line = prefix + '[' + api + '] status=' + status + ' elapsed=' + elapsed + ' url=' + url + ' error=' + error;
    var level = fields.level || (fields.error ? 'error' : (status === 'null' ? 'warn' : (status.charAt(0) === '2' ? 'info' : 'warn')));
    emit(level, line);
  }
  return {
    log: log,
    info: function(api, f){ log(api, Object.assign({}, f, { level: 'info' })); },
    warn: function(api, f){ log(api, Object.assign({}, f, { level: 'warn' })); },
    error: function(api, f){ log(api, Object.assign({}, f, { level: 'error' })); }
  };
}
async function __tvboxSafeFetch(url, options, config, logger) {
  options = options || {};
  config = config || {};
  var timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  var headers = __tvboxMergeConfig({}, options.headers || {});
  var method = options.method || 'GET';
  var body = options.body;
  var controller = (typeof AbortController === 'function') ? new AbortController() : null;
  var timer = null;
  if (controller) { timer = setTimeout(function(){ try{controller.abort()}catch(_){}}, timeoutMs); }
  var start = Date.now();
  var response;
  try {
    response = await fetch(url, { method: method, headers: headers, body: body, redirect: options.redirect || 'follow', signal: controller ? controller.signal : undefined });
  } catch(err) {
    var e1 = Date.now() - start;
    if (timer) clearTimeout(timer);
    if (logger) logger.warn('fetch', { status: 'network', elapsed: e1, url: url, error: err && err.message ? err.message : String(err) });
    var e = new Error('network_error');
    e.code = 'NETWORK_ERROR';
    e.cause = err;
    throw e;
  }
  if (timer) clearTimeout(timer);
  var elapsed = Date.now() - start;
  var status = response.status;
  var text = await response.text();
  if (logger) {
    var level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level]('fetch', { status: status, elapsed: elapsed, url: url, error: null });
  }
  return { status: status, headers: response.headers, text: text, elapsed: elapsed, ok: response.ok };
}
function __tvboxSafeJsonParse(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
}
function __tvboxCreateBase(site, userConfig) {
  var config = __tvboxMergeConfig({
    headers: { 'User-Agent': 'Mozilla/5.0 (TVBox-Compatibility; +https://github.com/tvbox)', 'Accept': 'application/json, text/plain, */*' },
    proxy: '',
    custom: {},
    timeoutMs: DEFAULT_TIMEOUT_MS,
    logSink: null
  }, userConfig || {});
  var logger = __tvboxCreateLogger(site || 'spider', config.logSink);
  return {
    site: site, config: config, logger: logger, headers: config.headers, proxy: config.proxy,
    fetchJson: async function(url, opts) {
      try {
        var r = await __tvboxSafeFetch(url, opts, config, logger);
        if (!(r.status >= 200 && r.status < 300)) {
          var e = new Error('http_status_' + r.status);
          e.code = 'HTTP_STATUS'; e.status = r.status; e.body = r.text;
          throw e;
        }
        var j = __tvboxSafeJsonParse(r.text);
        if (!j.ok) { var e2 = new Error('json_parse_failed'); e2.code = 'JSON_PARSE'; e2.cause = j.error; throw e2; }
        return j.value;
      } catch(err) { throw err; }
    },
    fetchText: async function(url, opts) {
      try {
        var r = await __tvboxSafeFetch(url, opts, config, logger);
        if (!(r.status >= 200 && r.status < 300)) {
          var e = new Error('http_status_' + r.status);
          e.code = 'HTTP_STATUS'; e.status = r.status; e.body = r.text;
          throw e;
        }
        return r.text;
      } catch(err) { throw err; }
    }
  };
}
function __tvboxEmptyList() { return { list: [] }; }
function __tvboxEmpty() { return {}; }
function __tvboxWithFallback(fn, fb, logger, api) {
  if (typeof fn !== 'function') return Promise.resolve(fb());
  return Promise.resolve().then(function(){ return fn(); }).catch(function(err){
    if (logger) logger.error(api, { status: null, elapsed: 0, url: null, error: err && err.message ? err.message : String(err) });
    return fb();
  });
}

var __TVBOX_RUNTIME__ = {
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  SENSITIVE_HEADER_KEYS: SENSITIVE_HEADER_KEYS,
  mask: __tvboxMask,
  maskHeaderValue: __tvboxMaskHeaderValue,
  maskHeaders: __tvboxMaskHeaders,
  isPlainObject: __tvboxIsPlainObject,
  mergeConfig: __tvboxMergeConfig,
  createLogger: __tvboxCreateLogger,
  safeFetch: __tvboxSafeFetch,
  safeJsonParse: __tvboxSafeJsonParse,
  createBase: __tvboxCreateBase,
  emptyListResult: __tvboxEmptyList,
  emptyResult: __tvboxEmpty,
  withFallback: __tvboxWithFallback
};
// __TVBOX_BASE_RUNTIME__end
`;

module.exports = { RUNTIME_SOURCE: RUNTIME_SOURCE };
