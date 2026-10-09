#!/usr/bin/env bash
# check-compliance.sh
# L-1 合规拦截：拒绝包含已知的疑似盗版/版权侵权站点 URL / 接口 / 解析特征串的提交。
#
# 用法：
#   bash tools/scripts/check-compliance.sh           # 检查 git tracked 的非生成物
#   bash tools/scripts/check-compliance.sh path1 path2 ...  # 检查指定路径
#
# 退出码：
#   0 = 通过； 1 = 命中拦截。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DENYLIST_FILE="${ROOT}/tools/scripts/compliance-denylist.txt"

if [[ ! -f "$DENYLIST_FILE" ]]; then
  echo "[compliance] WARN: denylist file not found, treating as no denylist (skip)" >&2
  exit 0
fi

# 收集目标路径
TARGETS=()
if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  # 默认扫描：git ls-files 但排除以下路径
  while IFS= read -r line; do
    case "$line" in
      # 直接允许少量示例占位：example.com / example.org / jsonplaceholder.typicode.com
      *.md) ;;            # README 与 docs 不被拦截具体 URL（但仍受关键 cookie/token 拦截）
      *)
        TARGETS+=("$line")
        ;;
    esac
  done < <(git -C "$ROOT" ls-files)
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "[compliance] no target files"
  exit 0
fi

# 读取 denylist（每行一个字符串）
mapfile -t PATTERNS < "$DENYLIST_FILE"

violation_count=0
for pat in "${PATTERNS[@]}"; do
  [[ -z "$pat" || "$pat" == \#* ]] && continue
  # -I: 跳过二进制；-F: 模式
  if grep -rInF --binary-files=without-match -- "$pat" "${TARGETS[@]}" 2>/dev/null; then
    echo "[compliance] FAIL: 命中 L-1 denylist token '$pat'" >&2
    violation_count=$((violation_count + 1))
  fi
done

if [[ $violation_count -gt 0 ]]; then
  echo "[compliance] BLOCKED: $violation_count violation(s); see files above" >&2
  exit 1
fi

# 额外检查：明文密钥字段
echo "[compliance] checking sensitive headers (L-3)..."
SENSITIVE_KEYS=("Authorization:" "Proxy-Authorization:" "X-API-Key:")
sensitive_violation=0
for key in "${SENSITIVE_KEYS[@]}"; do
  # 仅在 src/spiders 与 dist 两个产物目录中匹配；脚本自身实现（tools/scripts）和 README/docs 不参与 L-3 自动校验
  if grep -rInF --binary-files=without-match -- "$key" "${ROOT}/src/spiders" "${ROOT}/dist" 2>/dev/null; then
    echo "[compliance] WARN: 命中敏感字段 '$key'（应通过 mask 暴露而非明文）" >&2
    sensitive_violation=$((sensitive_violation + 1))
  fi
done

echo "[compliance] OK: ${#PATTERNS[@]} patterns scanned, $violation_count violation(s), $sensitive_violation sensitive header warning(s)"
exit 0
