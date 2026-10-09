# DeliveryAITest
DeliveryAITest

# ──────────────────────────────────────────────────────────────
# TVBox 兼容：爬虫工具与源配置（tvbox-crawler-and-source）

> 本节为新增业务包；不修改上面的 README 主体内容。
> 文档版本：v1（与 `artifacts/AI-Spec生成/AI-Spec-TVBox爬虫与源/spec.md` v1 对齐）。

## 0. 一句话

把本仓库的 `dist/source.json` 部署到 GitHub Pages 后，把 `https://<owner>.github.io/<repo>/source.json` 粘贴到 TVBox 中，即可加载至少 1 个示例（Mock）站点并在 TVBox 中完成「首页 → 分类 → 搜索 → 详情 → 播放」全流程。

## 1. 仓库内容

| 路径 | 说明 |
|------|------|
| `dist/source.json` | TVBox 可订阅的源 JSON（顶层仅 `sites / parses / rules / flags`） |
| `dist/spiders/*.js` | self-contained Spider 产物（TVBox 客户端直接加载） |
| `src/spiders/*.js` | Spider 源码（开发期，使用 `require('../lib/tvbox-base.js')`） |
| `src/lib/tvbox-base.js` | 通用工具：fetch / log / config / 容错 |
| `src/lib/runtime-source.js` | 字符串化 runtime，供 `build-spider.js` 内联 |
| `tools/scripts/build-spider.js` | 把 `src/spiders/*.js` 打包为 self-contained `dist/spiders/*.js` |
| `tools/scripts/validate-source.js` | 源 JSON 契约校验 + JSON Schema 校验 |
| `tools/scripts/run-spider.js` | 本地 6 接口自测（替代 curl） |
| `tools/scripts/check-compliance.sh` | L-1 / L-3 合规静态检查（可选开启） |
| `tools/scripts/compliance-denylist.txt` | L-1 denylist（默认空，需用户提交后填充） |
| `tools/schemas/source.schema.json` | 源 JSON Schema（Draft 7 子集） |
| `tests/` | 单元测试（`node --test`） |
| `docs/编写指南.md` | 接入新站点的 30 分钟指南 |
| `docs/扩展字段.md` | 多仓扩展字段与 flag 启用机制 |
| `docs/协议字段参考.md` | 协议字段速查 |
| `examples/log/example.log` | 结构化日志样例（含 ERROR 路径） |
| `docs/ci-workflow-example.yml` | 可选 CI：build / validate / test / 体积 / 合规（用户按需部署） |
| `package.json` | npm scripts：`test` / `validate:source` / `validate:contract` / `check:compliance` / `test:spider` |

## 2. 5 分钟跑通全流程

```bash
# 1) 安装 Node.js（>=18，本仓库在 Node 22 上验证）
node --version

# 2) 构建 self-contained spider 产物
node tools/scripts/build-spider.js

# 3) 校验源 JSON（契约 + JSON Schema）
node tools/scripts/validate-source.js dist/source.json tools/schemas/source.schema.json

# 4) 跑全部单元测试
node --test tests/*.test.js

# 5) 本地"curl 等价"自测 spider
node tools/scripts/run-spider.js src/spiders/example-mock.js --print
```

## 3. TVBox 订阅用法

> 启用 GitHub Pages（`main` 分支 + `/` 根目录 或 `dist/` 子目录）后，把以下 URL 粘贴进 TVBox：
>
> ```
> https://<owner>.github.io/<repo>/source.json
> ```
>
> - `<owner>` / `<repo>` 替换为 GitHub 用户名 / 仓库名。
> - 也可以使用任意支持静态托管的 URL（CDN / COS / OSS / 自建服务器）。
> - 在 `dist/source.json` 的 `sites[*].api` 中同步替换占位符即可。

## 4. 核心契约（与 `spec.md` §5 对齐）

- **源 JSON 顶层仅 4 键**：`sites / parses / rules / flags`。
- **6 接口契约**：`init / homeContent / categoryContent / detailContent / playerContent / searchContent`。
- **结构化日志前缀**：`[tvbox][{site}][{api}] status=... elapsed=...ms url=... error=...`
- **容错**：网络异常 / HTTP 非 2xx / 解析失败 → 返回兜底 `{}` 或 `{list:[]}`，写入 ERROR 日志。
- **配置可由源 JSON 控制**：`headers / proxy / custom` 三字段按层合并。
- **敏感字段自动 mask**：`Cookie / Authorization / X-API-Key / X-Auth-Token / Proxy-Authorization`。

## 5. 合规红线（§3.7）

> 任何一项缺失或违反都将退回本次提交。

- **L-1**：仓库任何源文件不得包含已知盗版/版权侵权站点的 URL / 接口路径 / 解析特征 / Cookie/Token 字段。
- **L-2**：第三方资源站接入前必须提交《资源站合规与责任清单》（U-1/U-2/U-3）。
- **L-3**：日志不得打印完整 Cookie / Authorization；spider 需在 TVBox 端外部完成登录态配置。
- **C-2**：AI-编码节点默认产出「接入框架 + 占位 Mock」；用户在提交清单后再追加 patch。

CI 默认 denylist 为空；如需启用拦截，请将已知违规域名前缀追加到 `tools/scripts/compliance-denylist.txt`。

## 6. 接入新站点（30 分钟）

见 [`docs/编写指南.md`](docs/编写指南.md)。

## 7. 维护与扩展

- 升级 Spider：修改 `src/spiders/<name>.js` → `node tools/scripts/build-spider.js` → CI 自动验证。
- 升级源 JSON：修改 `dist/source.json` → 推送后 GitHub Pages 自动更新。
- 升级协议字段：同步更新 `tools/schemas/source.schema.json` 与 `docs/扩展字段.md`。

## 8. REQ → 实现 索引

| REQ | 实现位置 |
|-----|---------|
| REQ-001 6 接口 | `src/spiders/example-mock.js` / `_template.js` |
| REQ-002 顶层仅 4 键 | `dist/source.json` / `tools/scripts/validate-source.js` |
| REQ-003 配置由源 JSON 控制 | `src/lib/tvbox-base.js#createBase#mergeConfig` |
| REQ-004 结构化日志 | `src/lib/tvbox-base.js#createLogger` + `examples/log/example.log` |
| REQ-005 容错契约 | `src/lib/tvbox-base.js#withFallback` + `safeFetch` |
| REQ-006 GitHub Pages 订阅 | 本 README §3 / `dist/source.json` |
| REQ-007 分离托管 | `dist/source.json`（api 字段）+ `dist/spiders/*.js` |
| REQ-008 Mock 站点 | `src/spiders/example-mock.js` |
| REQ-009 文档 | `docs/` 三份 + `examples/log/` |
| REQ-010 多仓扩展字段 | `docs/扩展字段.md` + `dist/source.json.flags` |
| REQ-011 合规前置 | `tools/scripts/check-compliance.sh` + `examples/log/` (mask) |
| REQ-012 跨客户端兼容 | 双形态参数兼容 + JSON Schema 校验原版协议字段 |
