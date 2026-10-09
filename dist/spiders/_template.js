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
'use strict';

/**
 * Spider 接入模板（template）— TVBox Spider JS 通用接入骨架
 *
 * 使用步骤：
 *   1) 复制本文件为 src/spiders/<your-site>.js；
 *   2) 替换 SITE_KEY / SITE_NAME / API_BASE 等基础配置；
 *   3) 改造 homeContent / categoryContent / detailContent / playerContent / searchContent
 *      五个接口的真实站点实现；
 *   4) 真实站点接入必须通过《资源站合规与责任清单》（U-1/U-2/U-3）合规前置审核，
 *      并在 PR 中明确《清单》编号；不允许内置任何已知盗版/版权侵权站点
 *      （URL / 接口路径 / 解析特征 / Cookie/Token 字段 — 见 L-1）。
 *   5) 在 dist/source.json 的 sites 数组追加此站点的 entry，
 *      api 字段指向本文件构建后的 dist/spiders/<your-site>.js。
 *
 * === ⚠️ 合规前置 ===
 *   本模板默认 example-public 站点，使用 stable、可公网访问且无版权风险的公共 API
 *   （JSONPlaceholder）作为占位示例。任何替换为实际影视/网盘站点前，必须先完成 §3.7 的合规审核。
 */

var tvboxBase = __TVBOX_RUNTIME__;

var SITE_KEY = 'example-public';
var SITE_NAME = '示例·公共模板';
var API_BASE = 'https://jsonplaceholder.typicode.com';

var base = tvboxBase.createBase(SITE_KEY, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (TVBox-Compatibility; Example-Public)',
    'Accept': 'application/json'
  },
  // 自定义参数（在 source.json 中通过 custom.timeoutMs、custom.enabled 覆盖）
  custom: {
    timeoutMs: 4000,
    enabled: true
  },
  timeoutMs: 4000
});
var logger = base.logger;

if (base.config.custom.enabled === false) {
  // 站点被禁用：所有接口直接返回空结果 + ERROR 日志，TVBox 不会崩
  module.exports = {
    init: function(){ return {}; },
    homeContent: function(){ return { class: [], list: [] }; },
    categoryContent: function(){ return { list: [], page: 1, total: 0 }; },
    detailContent: function(){ return { list: [] }; },
    playerContent: function(){ return { url: '' }; },
    searchContent: function(){ return { list: [], page: 1, total: 0 }; },
    site_key: SITE_KEY, site_name: SITE_NAME, site_type: 1,
    _meta: { site: SITE_KEY, type: 'disabled', description: '本站点被禁用' }
  };
} else {
  // 正常分支
}

/* ----------------------------------------------------------
 * 通用工具
 *   - normalizeArgs: 同时支持位置参数与对象参数
 *   - logApi: 统一接口日志前缀
 * ---------------------------------------------------------- */
function normalizeArgs(args, keys) {
  // 兼容调用：函数(a,b,c) 与 函数({a,b,c})
  if (args.length >= 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0];
  }
  return null;
}

function mapToVodItem(post) {
  // 这里把 JSONPlaceholder 的 post 字段映射成 TVBox VodItem 形态；实际接入时按目标站点规则替换
  return {
    vod_id: 'pub_' + post.id,
    vod_name: post.title,
    vod_pic: 'https://via.placeholder.com/240x360?text=' + encodeURIComponent(post.title.slice(0, 6)),
    vod_remarks: '示例·公共',
    vod_year: '2024',
    vod_area: '示例',
    type_id: 'public'
  };
}

/* ----------------- 6 接口契约 ----------------- */

function init(_ext) {
  // 把 ext 字段存起来，以便后续接口读取
  base.ext = _ext || {};
  if (logger) logger.info('init', { status: 200, elapsed: 0, url: '', error: null });
  return { ext: base.ext };
}

function homeContent(filter) {
  return tvboxBase.withFallback(async function(){
    var data = await base.fetchJson(API_BASE + '/posts');
    var list = Array.isArray(data) ? data.slice(0, 6).map(mapToVodItem) : [];
    if (logger) logger.info('homeContent', { status: 200, elapsed: 1, url: API_BASE + '/posts', error: null });
    return {
      class: [
        { type_id: 'public', type_name: '公共示例' }
      ],
      list: list
    };
  }, function(){
    return { class: [{ type_id: 'public', type_name: '公共示例' }], list: [] };
  }, logger, 'homeContent');
}

function categoryContent(tid, pg, filter, extend) {
  // TVBox 标准: categoryContent(tid, pg, filter, extend)
  if (tid && typeof tid === 'object') {
    var o = tid;
    pg = o.page; tid = o.cateId; filter = o.filter; extend = o.extend;
  }
  pg = Number(pg) || 1;
  return tvboxBase.withFallback(async function(){
    var data = await base.fetchJson(API_BASE + '/posts?_page=' + pg);
    var list = Array.isArray(data) ? data.map(mapToVodItem) : [];
    if (logger) logger.info('categoryContent', { status: 200, elapsed: 1, url: API_BASE + '/posts?_page=' + pg, error: null });
    return { list: list, page: pg, total: 100, pagecount: 10 };
  }, function(){
    return { list: [], page: pg, total: 0, pagecount: 1 };
  }, logger, 'categoryContent');
}

function detailContent(ids) {
  var list = Array.isArray(ids) ? ids : [ids];
  return tvboxBase.withFallback(async function(){
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var id = String(list[i] || '').replace(/^pub_/, '');
      try {
        var item = await base.fetchJson(API_BASE + '/posts/' + encodeURIComponent(id));
        out.push(Object.assign({}, mapToVodItem(item), {
          vod_content: item.body || '',
          vod_play_from: '示例线路',
          vod_play_url: '剧集1$mp4$https://example.com/v/' + id + '.m3u8',
          vod_tag: 'public-template'
        }));
      } catch (err) {
        if (logger) logger.warn('detailContent-item', { status: 'failed', elapsed: 0, url: id, error: err && err.message ? err.message : String(err) });
      }
    }
    if (logger) logger.info('detailContent', { status: 200, elapsed: 1, url: API_BASE + '/posts', error: null });
    return { list: out };
  }, function(){ return { list: [] }; }, logger, 'detailContent');
}

function playerContent(flag, id, vipFlags) {
  if (flag && typeof flag === 'object') { var o = flag; id = o.id; vipFlags = o.vipFlags; flag = o.flag; }
  if (logger) logger.info('playerContent', { status: 200, elapsed: 1, url: API_BASE, error: null });
  return {
    parse: 0,
    url: 'https://example.com/v/' + encodeURIComponent(String(id || '')) + '.m3u8',
    header: JSON.stringify(base.config.headers || {}),
    flag: flag || SITE_KEY,
    vipFlags: vipFlags || {},
    timeoutMs: base.config.timeoutMs
  };
}

function searchContent(key, quick, pg) {
  if (key && typeof key === 'object') { var o = key; pg = o.page; quick = o.quick; key = o.key; }
  pg = Number(pg) || 1;
  return tvboxBase.withFallback(async function(){
    var data = await base.fetchJson(API_BASE + '/posts?_page=' + pg);
    var kw = String(key || '').toLowerCase();
    var arr = Array.isArray(data) ? data : [];
    var matched = kw ? arr.filter(function(p){ return String(p.title).toLowerCase().indexOf(kw) >= 0; }) : arr;
    if (logger) logger.info('searchContent', { status: 200, elapsed: 1, url: API_BASE + '/posts', error: null });
    return { list: matched.map(mapToVodItem), page: pg, total: matched.length, pagecount: 1, key: kw, quick: !!quick };
  }, function(){
    return { list: [], page: pg, total: 0, pagecount: 1, key: String(key || ''), quick: !!quick };
  }, logger, 'searchContent');
}

/* ----------------- 导出/全局挂载 ----------------- */

var api = {
  init: init,
  homeContent: homeContent,
  categoryContent: categoryContent,
  detailContent: detailContent,
  playerContent: playerContent,
  searchContent: searchContent,
  site_key: SITE_KEY,
  site_name: SITE_NAME,
  site_type: 1,
  apiUrl: API_BASE,
  _meta: {
    site: SITE_KEY,
    type: 'template',
    description: '模板 spider，占位公共 API；改造并完成合规审核后可用于真实站点'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== 'undefined') {
  globalThis.init = init;
  globalThis.homeContent = homeContent;
  globalThis.categoryContent = categoryContent;
  globalThis.detailContent = detailContent;
  globalThis.playerContent = playerContent;
  globalThis.searchContent = searchContent;
  globalThis._site_meta = api._meta;
}
