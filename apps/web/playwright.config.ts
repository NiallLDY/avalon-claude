import { defineConfig, devices } from "@playwright/test";

/**
 * 浏览器端到端测试。
 *
 * 这一层存在的理由：协议层的测试直接走 socket，**绕开了浏览器**，
 * 于是「刷新掉出房间」「输昵称报参数不合法」「每次刷新闪一下断线」
 * 这类缺陷一个都测不到 —— 它们全在客户端状态管理里。
 *
 * 默认跑在 iPhone 视口，因为这是个手机优先的应用。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // 共用一个服务端实例，串行更好定位问题
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    locale: "zh-CN",
  },
  projects: [
    { name: "iPhone", use: { ...devices["iPhone 13"] } },
  ],
});
