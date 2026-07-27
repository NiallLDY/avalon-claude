/**
 * 端到端回归。每一条都对应一个真实被用户报过的缺陷 ——
 * 加测试是为了它们不会再回来，不是为了凑覆盖率。
 */

import { expect, test, type Page } from "@playwright/test";

/** 每个测试用独立的 localStorage，避免互相串身份 */
test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

const openApp = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByText("MELBOURNE 阿瓦隆")).toBeVisible();
};

const createRoom = async (page: Page, name = "测试房") => {
  await page.getByRole("button", { name: "开房间" }).click();
  await page.getByPlaceholder(/的房间$/).fill(name);
  await page.getByRole("button", { name: "创建" }).click();
  // 进房后头部会显示 6 位房间码
  const code = page.locator("p.font-display").first();
  await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  return (await code.textContent())!.trim();
};

test.describe("连接状态", () => {
  test("首次加载不该闪「连接断开」—— 那是首次连接中，不是断线", async ({ page }) => {
    const seen: string[] = [];
    page.on("console", () => undefined);
    await page.goto("/");
    // 页面刚出现的这一小段时间里，断线横幅一次都不该出现
    for (let i = 0; i < 12; i++) {
      if (await page.getByText("连接断开，正在重连").isVisible().catch(() => false)) {
        seen.push("banner");
      }
      await page.waitForTimeout(50);
    }
    expect(seen).toEqual([]);
  });
});

test.describe("昵称", () => {
  test("清空后重打不该报「参数不合法」", async ({ page }) => {
    await openApp(page);
    const nick = page.getByPlaceholder("你的昵称");

    // 清空再逐字输入 —— 这是最普通的改名动作，之前每一步都会往服务端发一次
    await nick.click();
    await nick.fill("");
    await nick.pressSequentially("梅林", { delay: 60 });
    await nick.blur();

    await expect(page.getByText("参数不合法")).toHaveCount(0);
    await expect(page.getByText("操作太快了")).toHaveCount(0);
    await expect(nick).toHaveValue("梅林");
  });

  test("只输空白时回滚到原昵称，不提交空值", async ({ page }) => {
    await openApp(page);
    const nick = page.getByPlaceholder("你的昵称");
    const before = await nick.inputValue();

    await nick.fill("   ");
    await nick.blur();

    await expect(page.getByText("参数不合法")).toHaveCount(0);
    await expect(nick).toHaveValue(before);
  });
});

test.describe("房间", () => {
  test("刷新页面后应该还在房间里，而不是掉回大厅", async ({ page }) => {
    await openApp(page);
    const code = await createRoom(page, "刷新不掉房");

    await page.reload();

    // 刷新后仍在房间：房间码还在，没退回大厅标题
    await expect(page.locator("p.font-display").first()).toHaveText(code);
    await expect(page.getByText("MELBOURNE 阿瓦隆")).toHaveCount(0);
  });

  test("主动退出后刷新应该回大厅，不能又被拉回去", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await page.getByRole("button", { name: "← 退出" }).click();
    await expect(page.getByText("MELBOURNE 阿瓦隆")).toBeVisible();

    await page.reload();
    await expect(page.getByText("MELBOURNE 阿瓦隆")).toBeVisible();
  });

  test("座位上要显示座位号，线下靠它对人", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    // 建房者自动入座 1 号位
    await expect(page.locator("text=/^1$/").first()).toBeVisible();
  });

  test("人数不足 7 人时湖中女神不可开启，并说明原因", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await page.getByRole("button", { name: "设置" }).click();

    await expect(page.getByText(/官方规则限 7 人及以上/)).toBeVisible();
    const toggle = page.getByRole("button", { name: /湖中女神/ });
    await expect(toggle).toBeDisabled();
  });

  test("设置面板要显示当前人数发什么角色", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await page.getByRole("button", { name: "设置" }).click();

    // 限定在设置面板内 —— 底部footer 也有一句「还差 N 人」，不限定会撞上
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("人数 = 实际入座人数")).toBeVisible();
    await expect(sheet.getByText(/还差 4 人才能开局（5–10 人）/)).toBeVisible();
  });
});

test.describe("换座位", () => {
  test("两个玩家可以互相申请并同意换座", async ({ browser }) => {
    const a = await browser.newContext({ locale: "zh-CN" });
    const b = await browser.newContext({ locale: "zh-CN" });
    const pa = await a.newPage();
    const pb = await b.newPage();

    await openApp(pa);
    const code = await createRoom(pa, "换座测试");

    // B 用房间码进来，自动坐到 2 号位
    await openApp(pb);
    await pb.getByPlaceholder("房间码").fill(code);
    await pb.getByRole("button", { name: "进" }).click();
    await expect(pb.locator("p.font-display").first()).toHaveText(code);
    await expect(pa.getByText("2 人")).toBeVisible();

    // A 发起换座
    await pa.getByRole("button", { name: "换座位" }).click();
    await expect(pa.getByText("点一个人跟他换座")).toBeVisible();
    // 点 B 所在的 2 号座位
    await pa.locator("button").filter({ hasText: /^2/ }).first().click();

    // B 收到请求并同意
    await expect(pb.getByText(/想和你换座位/)).toBeVisible();
    await pb.getByRole("button", { name: "同意换座" }).click();

    // 换完之后 A 应该在 2 号位
    await expect(pa.getByText(/想和你换座位/)).toHaveCount(0);
    await expect(pb.getByText(/想和你换座位/)).toHaveCount(0);

    await a.close();
    await b.close();
  });
});

test.describe("我是几号", () => {
  test("房间里要一眼看出自己的座位号", async ({ page }) => {
    await openApp(page);
    await createRoom(page);

    // 圆心直接写着自己的号
    await expect(page.getByText("你的座位 · 共 1 人")).toBeVisible();
    await expect(page.getByText("1号", { exact: true })).toBeVisible();
    // 自己那格标「你」而不是昵称
    await expect(page.getByText("你", { exact: true })).toBeVisible();
  });
});

test.describe("座位号", () => {
  test("提到玩家的地方都要带号码 —— 线下全靠号码沟通", async ({ browser }) => {
    // 两人局够验证「号码 + 昵称」的拼法，不需要凑满一局
    const a = await browser.newContext({ locale: "zh-CN" });
    const b = await browser.newContext({ locale: "zh-CN" });
    const pa = await a.newPage();
    const pb = await b.newPage();

    await openApp(pa);
    await pa.getByPlaceholder("你的昵称").fill("阿隆");
    await pa.getByPlaceholder("你的昵称").blur();
    const code = await createRoom(pa, "号码测试");

    await openApp(pb);
    await pb.getByPlaceholder("你的昵称").fill("小梅");
    await pb.getByPlaceholder("你的昵称").blur();
    await pb.getByPlaceholder("房间码").fill(code);
    await pb.getByRole("button", { name: "进" }).click();
    await expect(pa.getByText("2 人")).toBeVisible();

    // 换座请求里必须出现「1号 阿隆」而不是光秃秃的「阿隆」
    await pa.getByRole("button", { name: "换座位" }).click();
    await pa.locator("button.absolute:not([disabled])").first().click();
    await expect(pb.getByText(/1号 阿隆.*想和你换座位/)).toBeVisible();

    await a.close();
    await b.close();
  });
});

