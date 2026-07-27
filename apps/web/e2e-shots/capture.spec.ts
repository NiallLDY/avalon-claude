/**
 * 逐阶段截图。不是回归测试 —— 它的产物是图，给人看的。
 *
 * 用 5 个真实浏览器上下文打完一整局，在每个关键阶段截一张 iPhone 视口的图。
 * 这样「对局中长什么样」不用凑齐 5 个人也能看到，改 UI 之后也能一眼对比。
 *
 *   ./scripts/shots.sh    产物在 apps/web/shots/
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "shots";
let shotIndex = 0;

const shot = async (page: Page, name: string) => {
  shotIndex += 1;
  await page.waitForTimeout(250); // 等过渡动画落定
  await page.screenshot({ path: `${OUT}/${String(shotIndex).padStart(2, "0")}-${name}.png` });
};

const openApp = async (page: Page, nick: string) => {
  await page.goto("/");
  await expect(page.getByText("MELBOURNE 阿瓦隆")).toBeVisible();
  const input = page.getByPlaceholder("你的昵称");
  await input.fill(nick);
  await input.blur();
};

test("拍完整一局", async ({ browser }) => {
  test.setTimeout(300_000);
  await mkdir(OUT, { recursive: true });

  const NICKS = ["阿隆", "小梅", "老王", "阿飞", "球球"];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  for (const nick of NICKS) {
    const ctx = await browser.newContext({ locale: "zh-CN" });
    const page = await ctx.newPage();
    await openApp(page, nick);
    contexts.push(ctx);
    pages.push(page);
  }
  const host = pages[0]!;

  // ── 大厅 ──
  await shot(host, "大厅");

  await host.getByRole("button", { name: "开房间" }).click();
  await host.getByPlaceholder(/的房间$/).fill("周五局");
  await shot(host, "建房");
  await host.getByRole("button", { name: "创建" }).click();

  const code = (await host.locator("p.font-display").first().textContent())!.trim();

  for (const page of pages.slice(1)) {
    await page.getByPlaceholder("房间码").fill(code);
    await page.getByRole("button", { name: "进" }).click();
    await expect(page.locator("p.font-display").first()).toHaveText(code);
  }
  await expect(host.getByText("5 人")).toBeVisible();
  await shot(host, "房间等待");

  await host.getByRole("button", { name: "设置" }).click();
  await shot(host, "房间设置");
  await host.keyboard.press("Escape");
  await host.waitForTimeout(400);

  // ── 开局 ──
  await host.getByRole("button", { name: "开始游戏" }).click();
  await expect(host.getByText(/^\d+\/5 已看牌$/)).toBeVisible();
  await shot(host, "发牌");

  // 身份卡：点一下翻开
  await host.getByRole("button", { name: "身份卡" }).click();
  await expect(host.getByText("点击查看身份")).toBeVisible();
  await shot(host, "身份卡-盖住");

  await host.getByRole("dialog").locator("button.aspect-square").first().click();
  await expect(host.getByText("点击盖回")).toBeVisible();
  await shot(host, "身份卡-显形");
  await host.keyboard.press("Escape");
  await host.waitForTimeout(400);

  for (const page of pages) {
    await page.getByRole("button", { name: "我已看牌" }).click();
  }

  /** 所有人的结果弹窗都点掉，然后房主点「立即继续」跳过自动推进的等待 */
  const dismissAll = async () => {
    for (const page of pages) {
      const ok = page.getByRole("button", { name: "知道了" });
      if (await ok.isVisible().catch(() => false)) await ok.click();
    }
    const skip = host.getByRole("button", { name: "立即继续" });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  };

  /** 打一轮：提名 → 全票通过 → 出牌 */
  const playRound = async (failIt: boolean) => {
    // **先等阶段真的到了组队**，再找队长。
    // 结果阶段是服务端定时自动推进的，抢在它之前找队长必然找不到。
    await expect(host.getByText(/挑 \d+ 个人/)).toBeVisible();

    let leader = host;
    for (const page of pages) {
      if (await page.getByRole("button", { name: /选 \d+ 个人|^确认 \d/ }).isVisible().catch(() => false)) {
        leader = page;
        break;
      }
    }
    await shot(leader, failIt ? "组队" : "组队-2");

    // 依次点座位直到凑够人数
    const need = Number((await leader.getByText(/挑 \d+ 个人/).textContent())!.match(/\d+/)![0]);
    const seatButtons = leader.locator("button.absolute:not([disabled])");
    for (let i = 0; i < need; i++) await seatButtons.nth(i).click();
    await shot(leader, "组队-已选");
    await leader.getByRole("button", { name: /^确认 \d/ }).click();

    await expect(host.getByText("全体投票")).toBeVisible();
    await shot(host, "投票");
    for (const page of pages) {
      await page.getByRole("button", { name: "赞成" }).click();
    }

    // 结果弹窗盖住屏幕，要玩家自己点掉；后台会自动往下走
    await expect(host.locator("p.font-display").filter({ hasText: /^(上车|翻车)$/ })).toBeVisible();
    await shot(host, "揭票弹窗");
    await dismissAll();

    await expect(host.getByText(/队员执行任务/)).toBeVisible();
    // 上车的人出牌
    for (const page of pages) {
      const ok = page.getByRole("button", { name: "任务成功" });
      const bad = page.getByRole("button", { name: "任务失败" });
      if (await bad.isVisible().catch(() => false)) {
        await shot(page, "出牌-红方");
        await (failIt ? bad : ok).click();
      } else if (await ok.isVisible().catch(() => false)) {
        await shot(page, "出牌-蓝方");
        await ok.click();
      }
    }

    await expect(host.locator("p.font-display").filter({ hasText: /^任务(成功|失败)$/ })).toBeVisible();
    await shot(host, failIt ? "任务失败弹窗" : "任务成功弹窗");
    await dismissAll();
  };

  await playRound(false);
  await playRound(true);

  await host.getByRole("button", { name: "战报" }).click();
  await shot(host, "战报");
  await host.keyboard.press("Escape");
  await host.waitForTimeout(400);

  await playRound(false);
  await playRound(false);

  // 三次成功 → 刺杀
  let assassin = host;
  for (const page of pages) {
    if (await page.getByRole("button", { name: /^刺杀/ }).isVisible().catch(() => false)) {
      assassin = page;
      break;
    }
  }
  await shot(assassin, "刺杀");
  await assassin.locator("button.absolute:not([disabled])").first().click();
  await shot(assassin, "刺杀-已选");
  await assassin.getByRole("button", { name: /^刺杀/ }).click();

  await expect(host.getByText(/获胜$/)).toBeVisible();
  await shot(host, "终局");

  await host.getByRole("button", { name: "看战报" }).click();
  await shot(host, "终局战报");

  for (const ctx of contexts) await ctx.close();
});
