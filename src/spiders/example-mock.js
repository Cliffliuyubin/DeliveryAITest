/* __TVBOX_BASE_RUNTIME__INJECTION_POINT__ */
'use strict';

var tvboxBase = require('../lib/tvbox-base.js');
var base = tvboxBase.createBase('example-mock', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (TVBox-Compatibility; Example-Mock)',
    'X-Mock-Source': 'tvbox-crawler-and-source'
  },
  timeoutMs: 4000
});
var logger = base.logger;

/* ----------------------------------------------------------
 * 合成数据池
 * 全部为非真实第三方资源；仅为 6 接口演示与回归测试用。
 * ---------------------------------------------------------- */
var MOCK_CATEGORIES = [
  { type_id: 'all',   type_name: '全部' },
  { type_id: 'movie', type_name: '电影' },
  { type_id: 'tv',    type_name: '电视剧' },
  { type_id: 'doc',   type_name: '纪录片' }
];

var MOCK_VODS = [
  { vod_id: 'm001', vod_name: '示例-流浪地球',   vod_pic: 'https://via.placeholder.com/240x360?text=m001', vod_remarks: '科幻·2023',  vod_year: '2023', vod_area: '中国大陆', type_id: 'movie', desc: '示例剧集 A：行星发动机启动。', play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m001-01.m3u8#第02集$mp4$https://example.com/v/m001-02.m3u8' },
  { vod_id: 'm002', vod_name: '示例-三体',       vod_pic: 'https://via.placeholder.com/240x360?text=m002', vod_remarks: '科幻·剧集',  vod_year: '2023', vod_area: '中国大陆', type_id: 'tv',    desc: '示例剧集 B：三体文明接触。',   play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m002-01.m3u8#第02集$mp4$https://example.com/v/m002-02.m3u8#第03集$mp4$https://example.com/v/m002-03.m3u8' },
  { vod_id: 'm003', vod_name: '示例-隐秘的角落', vod_pic: 'https://via.placeholder.com/240x360?text=m003', vod_remarks: '悬疑·12集',  vod_year: '2020', vod_area: '中国大陆', type_id: 'tv',    desc: '示例剧集 C：孩子们的秘密。', play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m003-01.m3u8#第02集$mp4$https://example.com/v/m003-02.m3u8' },
  { vod_id: 'm004', vod_name: '示例-沉默的真相', vod_pic: 'https://via.placeholder.com/240x360?text=m004', vod_remarks: '悬疑·剧集',  vod_year: '2020', vod_area: '中国大陆', type_id: 'tv',    desc: '示例剧集 D：检察官追寻真相。', play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m004-01.m3u8#第02集$mp4$https://example.com/v/m004-02.m3u8#第03集$mp4$https://example.com/v/m004-03.m3u8' },
  { vod_id: 'm005', vod_name: '示例-漫长的季节', vod_pic: 'https://via.placeholder.com/240x360?text=m005', vod_remarks: '年代·12集',  vod_year: '2023', vod_area: '中国大陆', type_id: 'tv',    desc: '示例剧集 E：东北小城的命运。', play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m005-01.m3u8#第02集$mp4$https://example.com/v/m005-02.m3u8' },
  { vod_id: 'm006', vod_name: '示例-地球脉动',   vod_pic: 'https://via.placeholder.com/240x360?text=m006', vod_remarks: '纪录·自然',  vod_year: '2022', vod_area: '英国',     type_id: 'doc',   desc: '示例剧集 F：地球生态全景。',  play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m006-01.m3u8#第02集$mp4$https://example.com/v/m006-02.m3u8' },
  { vod_id: 'm007', vod_name: '示例-蓝色星球',   vod_pic: 'https://via.placeholder.com/240x360?text=m007', vod_remarks: '纪录·海洋',  vod_year: '2021', vod_area: '英国',     type_id: 'doc',   desc: '示例剧集 G：深海秘境。',      play_from: '示例线路A', play_url: '第01集$mp4$https://example.com/v/m007-01.m3u8' }
];

/* ---------------------- 工具函数 ------------------- */

function normalizeArgs(args) {
  // 同时支持位置参数和对象参数
  var out = {};
  if (args.length === 1 && args[0] && typeof args[0] === 'object') return args[0];
  return out;
}

function filterVods(typeId) {
  if (!typeId || typeId === 'all') return MOCK_VODS.slice();
  return MOCK_VODS.filter(function(v){ return v.type_id === typeId; });
}

function pageOf(arr, pg) {
  var page = Number(pg) || 1;
  if (page < 1) page = 1;
  var size = 4;
  var start = (page - 1) * size;
  var end = start + size;
  return { page: page, total: arr.length, list: arr.slice(start, end) };
}

function toVodItem(v) {
  return {
    vod_id: v.vod_id,
    vod_name: v.vod_name,
    vod_pic: v.vod_pic,
    vod_remarks: v.vod_remarks,
    vod_year: v.vod_year,
    vod_area: v.vod_area,
    type_id: v.type_id
  };
}

function toVodDetail(v) {
  return {
    vod_id: v.vod_id,
    vod_name: v.vod_name,
    vod_pic: v.vod_pic,
    vod_remarks: v.vod_remarks,
    vod_year: v.vod_year,
    vod_area: v.vod_area,
    type_id: v.type_id,
    vod_content: v.desc,
    vod_play_from: v.play_from,
    vod_play_url: v.play_url,
    vod_tag: 'mock'
  };
}

/* ------------------ 6 接口契约 ------------------- */

function init(_ext) {
  // 初始化扩展字段
  base.ext = _ext || {};
  if (logger) logger.info('init', { status: 200, elapsed: 0, url: 'in-memory', error: null });
  return { ext: base.ext };
}

function homeContent(filter) {
  return tvboxBase.withFallback(function(){
    var f = filter && typeof filter === 'object' ? filter : {};
    var list = filterVods('all').slice(0, 6).map(toVodItem);
    if (logger) logger.info('homeContent', { status: 200, elapsed: 1, url: 'in-memory', error: null });
    return { class: MOCK_CATEGORIES, list: list, filters: f };
  }, function(){ return { class: [], list: [] }; }, logger, 'homeContent');
}

function categoryContent(tid, pg, filter, extend) {
  // TVBox Wiki 形态：categoryContent(tid, pg, filter, extend)
  // 兼容调用：categoryContent({cateId, page, filter, extend})
  if (tid && typeof tid === 'object' && !Array.isArray(tid)) {
    var o = tid;
    pg = o.page; tid = o.cateId; filter = o.filter; extend = o.extend;
  }
  return tvboxBase.withFallback(function(){
    var result = pageOf(filterVods(tid), pg);
    if (logger) logger.info('categoryContent', { status: 200, elapsed: 1, url: 'in-memory:' + String(tid) + '?page=' + String(result.page), error: null });
    return { list: result.list.map(toVodItem), page: result.page, total: result.total, pagecount: Math.ceil(result.total / 4), filter: filter || {}, extend: extend || {} };
  }, function(){ return { list: [], page: 1, total: 0, pagecount: 1 }; }, logger, 'categoryContent');
}

function detailContent(ids) {
  // ids 可能是数组或单值
  var list = Array.isArray(ids) ? ids : [ids];
  return tvboxBase.withFallback(function(){
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = MOCK_VODS.find(function(x){ return x.vod_id === list[i]; });
      if (v) out.push(toVodDetail(v));
    }
    if (logger) logger.info('detailContent', { status: 200, elapsed: 1, url: 'in-memory', error: null });
    return { list: out };
  }, function(){ return { list: [] }; }, logger, 'detailContent');
}

function playerContent(flag, id, vipFlags) {
  if (flag && typeof flag === 'object') { var o = flag; id = o.id; vipFlags = o.vipFlags; flag = o.flag; }
  // id 形如 m001$1 表示 vod_id m001 的第 1 集
  var parts = String(id || '').split('$');
  var vodId = parts[0];
  var ep = parts[1] || '1';
  var v = MOCK_VODS.find(function(x){ return x.vod_id === vodId; });
  if (!v) return { url: '', error: 'vod_not_found' };
  var episodes = v.play_url.split('#').map(function(line){
    var segs = line.split('$');
    return { ep: segs[0] || '', type: segs[1] || 'mp4', url: segs[2] || '' };
  });
  var target = episodes.find(function(e){ return e.ep === ('第' + (ep.length < 2 ? '0' + ep : ep) + '集'); }) || episodes[0];
  if (logger) logger.info('playerContent', { status: 200, elapsed: 1, url: 'in-memory:' + vodId, error: null });
  return {
    parse: 0,
    url: target ? target.url : '',
    header: JSON.stringify(base.config.headers || {}),
    flag: flag || 'example-mock',
    vipFlags: vipFlags || {},
    timeoutMs: base.config.timeoutMs
  };
}

function searchContent(key, quick, pg) {
  if (key && typeof key === 'object') { var o = key; pg = o.page; quick = o.quick; key = o.key; }
  return tvboxBase.withFallback(function(){
    var kw = String(key || '').trim().toLowerCase();
    var matched = MOCK_VODS.filter(function(v){
      if (!kw) return true;
      return String(v.vod_name).toLowerCase().indexOf(kw) >= 0;
    });
    var paged = pageOf(matched, pg);
    if (logger) logger.info('searchContent', { status: 200, elapsed: 1, url: 'in-memory:q=' + kw, error: null });
    return { list: paged.list.map(toVodItem), page: paged.page, total: paged.total, pagecount: Math.ceil(paged.total / 4), key: kw, quick: !!quick };
  }, function(){ return { list: [], page: 1, total: 0, pagecount: 1, key: String(key || ''), quick: !!quick }; }, logger, 'searchContent');
}

/* --------------------- 导出/全局挂载 ------------------ */

var api = {
  init: init,
  homeContent: homeContent,
  categoryContent: categoryContent,
  detailContent: detailContent,
  playerContent: playerContent,
  searchContent: searchContent,
  site_key: 'example-mock',
  site_name: '示例·Mock 站点',
  site_type: 1,
  apiUrl: 'in-memory://mock',
  _meta: {
    site: 'example-mock',
    type: 'mock',
    description: '内置合成数据 Spider；不抓取真实第三方资源站'
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
