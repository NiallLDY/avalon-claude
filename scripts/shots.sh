#!/usr/bin/env bash
# 用 5 个真实浏览器打完一整局，逐阶段截 iPhone 视口的图。
# 产物在 apps/web/shots/。改完 UI 想看效果、或者想给人展示界面时用。
set -euo pipefail
cd "$(dirname "$0")/.."
PW_CONFIG=playwright.shots.config.ts exec ./scripts/e2e.sh "$@"
