#!/usr/bin/env bash
# 进开发容器的 shell（pnpm / node 都在里面）。
set -euo pipefail
cd "$(dirname "$0")/.."

exec docker compose -f compose.dev.yaml run --rm --no-deps app bash
