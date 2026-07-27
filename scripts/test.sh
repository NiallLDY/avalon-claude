#!/usr/bin/env bash
# 在容器里跑测试。参数透传给 vitest，例如：
#   ./scripts/test.sh                 全量
#   ./scripts/test.sh vision          只跑文件名含 vision 的
#   ./scripts/test.sh --watch         watch 模式
set -euo pipefail
cd "$(dirname "$0")/.."

exec docker compose -f compose.dev.yaml run --rm --no-deps app \
  pnpm exec vitest run "$@"
