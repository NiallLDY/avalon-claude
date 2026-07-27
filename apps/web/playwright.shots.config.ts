import { defineConfig, devices } from "@playwright/test";

/** 截图用。跟回归测试分开，免得每次跑 e2e 都去拍一整局 */
export default defineConfig({
  testDir: "./e2e-shots",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:4173",
    locale: "zh-CN",
    ...devices["iPhone 13"],
  },
});
