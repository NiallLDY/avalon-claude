#!/usr/bin/env bash
# 起开发环境。宿主机不需要装 node。
set -euo pipefail
cd "$(dirname "$0")/.."

DC=(docker compose -f compose.dev.yaml)

# 依赖有变才重装（pnpm 自己会判断，装过一次是秒回）
"${DC[@]}" run --rm --no-deps app pnpm install

exec "${DC[@]}" up --remove-orphans "$@"
