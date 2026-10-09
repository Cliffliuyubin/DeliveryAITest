# CI Workflow 参考（可选）

> 配套仓库的 CI 配置：`docs/ci-workflow-example.yml`

> **为何不在仓库内启用 `.github/workflows/`**：
> - 部分 GitHub App 的 OAuth scope 缺 `workflow`，推送时会被 GitHub 拒绝；
> - 本仓库对 Workflow 保持"以文档形式随包交付，是否启用交由维护者决定"。

> 启用方式：
> 1. 在 GitHub 仓库的 *Settings → Actions → General* 启用 Workflows；
> 2. 新建 `.github/workflows/ci.yml`，把 `docs/ci-workflow-example.yml` 的内容粘贴进去；
> 3. 提交并推送；CI 会在每次 PR 上自动跑 `build → validate → test → size → compliance`。

如果默认上游 OAuth scope 包含 `workflow`，也可直接把 `docs/ci-workflow-example.yml` 拷贝回 `.github/workflows/ci.yml` 提交。
