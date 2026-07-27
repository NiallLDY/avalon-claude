import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e 归 Playwright 管（apps/web/playwright.config.ts），
    // 不排除的话 vitest 会去跑它并炸在 @playwright/test 的 import 上
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
