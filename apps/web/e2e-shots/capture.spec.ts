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
  // 首次进站先设身份
  await page.getByPlaceholder("你的昵称").fill(nick);
  await page.getByRole("button", { name: "进去玩" }).click();
  await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
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

  // 规则页
  await host.getByRole("button", { name: /看规则/ }).click();
  await shot(host, "规则-流程");
  await host.getByText("几人局都有谁").scrollIntoViewIfNeeded();
  await shot(host, "规则-配牌表");
  await host.getByRole("button", { name: "角色图鉴" }).click();
  await shot(host, "规则-角色图鉴");
  await host.getByRole("button", { name: "← 返回" }).click();

  await host.getByRole("button", { name: "开房间" }).click();
  await host.getByPlaceholder(/的房间$/).fill("周五局");
  await shot(host, "建房");
  await host.getByRole("button", { name: "创建" }).click();

  const code = (await host.locator("p.font-display").first().textContent())!.trim();

  await host.getByRole("button", { name: "坐这 1" }).click();
  for (const [i, page] of pages.slice(1).entries()) {
    await page.getByPlaceholder("房间码").fill(code);
    await page.getByRole("button", { name: "进", exact: true }).click();
    await expect(page.locator("p.font-display").first()).toHaveText(code);
    await page.getByRole("button", { name: `坐这 ${i + 2}` }).click();
  }
  await shot(host, "房间等待");
  for (const page of pages) await page.getByRole("button", { name: "准备" }).click();
  await expect(host.getByRole("button", { name: "开始游戏" })).toBeEnabled();
  await shot(host, "全员准备");

  await host.getByRole("button", { name: "设置" }).click();
  await shot(host, "房间设置");
  await host.keyboard.press("Escape");
  await host.waitForTimeout(400);

  // ── 开局 ──
  await host.getByRole("button", { name: "开始游戏" }).click();
  await expect(host.getByText(/^\d+\/5 已看牌$/)).toBeVisible();
  await shot(host, "发牌");

  // 身份卡开局自动弹出，不用去底部找按钮
  await expect(host.getByText("点击查看身份")).toBeVisible();
  await shot(host, "身份卡-盖住");

  // 翻开就等于确认看牌，没有单独的「我已看牌」
  for (const page of pages) {
    await expect(page.getByText("点击查看身份")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: /点击查看身份/ }).click();
    await expect(page.getByText("点一下盖回")).toBeVisible();
  }
  await shot(host, "身份卡-显形");

  // 每个人都得关掉。卡片是模态，开着的时候背景整块 aria-hidden，
  // getByRole 找不到底下的按钮 —— 后面找队长会一个都找不到
  for (const page of pages) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
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

  let thrown = false;

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

    // 发言阶段互扔一次，拍下动画。只拍第一轮，别每轮都来
    if (!thrown) {
      thrown = true;
      const bystander = pages.find((p) => p !== leader)!;
      // 点自己弹的是表情包，点别人才是扔东西。挨个试到出现「砸蛋」为止
      for (const seat of [0, 1, 2, 3, 4]) {
        await bystander.locator(`button[data-seat="${seat}"]`).click();
        if (await bystander.getByRole("button", { name: "砸蛋" }).isVisible().catch(() => false)) {
          break;
        }
        await bystander.keyboard.press("Escape");
      }
      await shot(bystander, "扔东西-菜单");
      await bystander.getByRole("button", { name: "砸蛋" }).click();
      // 飞行 0.7s。shot 自己会先等 250ms，所以第二张只需再补 300ms 就落在砸中那一瞬
      await shot(host, "献花砸蛋-飞在半路");
      await host.waitForTimeout(300);
      await shot(host, "献花砸蛋-砸中");

      // 左右两列各发一个表情包，验气泡是不是朝屏幕中间弹的
      for (const seat of [0, pages.length - 1]) {
        const who = pages[seat]!;
        await who.locator(`button[data-seat="${seat}"]`).click();
        const pick = who.getByRole("button", { name: "我信你个鬼" });
        if (await pick.isVisible().catch(() => false)) {
          await shot(who, "表情包-菜单");
          await pick.click();
        } else {
          await who.keyboard.press("Escape");
        }
      }
      await shot(host, "表情包-气泡");
    }

    // 依次点座位直到凑够人数
    const need = Number((await leader.getByText(/挑 \d+ 个人/).textContent())!.match(/\d+/)![0]);
    const seatButtons = leader.locator("button[data-seat]:not([disabled])");
    for (let i = 0; i < need; i++) await seatButtons.nth(i).click();
    await shot(leader, "组队-已选");
    await leader.getByRole("button", { name: /^确认 \d/ }).click();

    await expect(host.getByText("全体投票")).toBeVisible();
    await shot(host, "投票");

    // 先投一半停一下 —— 这张图要能看出座位上「谁投了、还在等谁」
    for (const page of pages.slice(1, 3)) {
      await page.getByRole("button", { name: "赞成" }).click();
    }
    await shot(host, "投票-等人");

    for (const page of pages) {
      const yes = page.getByRole("button", { name: "赞成" });
      if (await yes.isVisible().catch(() => false)) await yes.click();
    }

    // 结果弹窗盖住屏幕，要玩家自己点掉；后台会自动往下走
    await expect(host.locator("p.font-display").filter({ hasText: /^组队(成功|失败)$/ })).toBeVisible();
    await shot(host, "揭票弹窗");
    await dismissAll();

    await expect(host.getByText(/队员执行任务/)).toBeVisible();
    // 组队成功，这一车的人出牌
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
  await assassin.locator("button[data-seat]:not([disabled])").first().click();
  await shot(assassin, "刺杀-已选");
  await assassin.getByRole("button", { name: /^刺杀/ }).click();

  await expect(host.getByText(/获胜$/)).toBeVisible();
  await shot(host, "终局");

  await host.getByRole("button", { name: "看战报" }).click();
  await shot(host, "终局战报");
  await host.keyboard.press("Escape");
  await host.waitForTimeout(400);

  // ── 再来一局 ──
  // **各点各的**：非房主先点，他自己回等待页；房主还在看结果，不会被拽走。
  const other = pages[2]!;
  await other.getByRole("button", { name: "再来一局" }).click();
  await expect(other.getByRole("button", { name: "准备" })).toBeVisible();
  await expect(host.getByText(/获胜$/)).toBeVisible();
  await shot(host, "终局-他人已重开");

  for (const page of pages) {
    const again = page.getByRole("button", { name: "再来一局" });
    if (await again.isVisible().catch(() => false)) await again.click();
  }
  for (const page of pages) {
    await expect(page.getByRole("button", { name: "准备" })).toBeVisible();
  }
  await shot(host, "再来一局-回到等待页");

  for (const page of pages) await page.getByRole("button", { name: "准备" }).click();
  await expect(host.getByRole("button", { name: "开始游戏" })).toBeEnabled();
  await host.getByRole("button", { name: "开始游戏" }).click();
  await expect(host.getByText(/^\d+\/5 已看牌$/)).toBeVisible();
  await shot(host, "再来一局-新局开始");

  // ── 本地战绩 ──
  // 上面刚开了新一局：身份卡会自动弹出来，模态盖着的时候 getByRole 看不到底下的按钮
  await host.keyboard.press("Escape");
  await expect(host.getByRole("dialog")).toHaveCount(0);
  // 对局页退出要走确认
  await host.getByRole("button", { name: "退出", exact: true }).click();
  await host.getByRole("button", { name: "离开", exact: true }).click();
  await expect(host.getByRole("button", { name: "开房间" })).toBeVisible();
  await host.getByRole("button", { name: "我的战绩" }).click();
  await expect(host.getByText("总胜率")).toBeVisible();
  await shot(host, "战绩");

  for (const ctx of contexts) await ctx.close();
});
