/**
 * 端到端回归。每一条都对应一个真实被用户报过的缺陷 ——
 * 加测试是为了它们不会再回来，不是为了凑覆盖率。
 */

import { expect, test, type Page } from "@playwright/test";

/** 每个测试用独立的 localStorage，避免互相串身份 */
test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

/** 打开应用。新的浏览器上下文没有身份，会先被首次设置挡住 */
const openApp = async (page: Page, nick = "玩家") => {
  await page.goto("/");
  const enter = page.getByRole("button", { name: "进去玩" });
  if (await enter.isVisible().catch(() => false)) {
    await page.getByPlaceholder("你的昵称").fill(nick);
    await enter.click();
  }
  // 断言要用大厅独有的东西 —— 首次设置页也有「MELBOURNE 阿瓦隆」这行标题
  await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
};

/** 坐到第 n 个位子（0 起） */
const sit = async (page: Page, seat: number) => {
  await page.getByRole("button", { name: `坐这 ${seat + 1}` }).click();
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

test.describe("断线重连", () => {
  test("网断了再回来要自动回到房间，而不是变成幽灵", async ({ browser }) => {
    const a = await browser.newContext({ locale: "zh-CN" });
    const b = await browser.newContext({ locale: "zh-CN" });
    const pa = await a.newPage();
    const pb = await b.newPage();

    await openApp(pa, "阿隆");
    const code = await createRoom(pa, "重连测试");
    await sit(pa, 0);

    await openApp(pb, "小梅");
    await pb.getByPlaceholder("房间码").fill(code);
    await pb.getByRole("button", { name: "进", exact: true }).click();
    await expect(pb.locator("p.font-display").first()).toHaveText(code);
    await sit(pb, 1);
    await expect(pb.getByText("阿隆")).toBeVisible();

    // 把 A 的网拔了。这不是刷新 —— 页面还在，state 还在内存里
    await a.setOffline(true);
    await expect(pa.getByText("连接断开，正在重连")).toBeVisible();
    await expect(pb.locator("button[data-seat]").filter({ hasText: "掉线" })).toBeVisible();

    await a.setOffline(false);
    await expect(pa.getByText("连接断开，正在重连")).toHaveCount(0);

    // **别人眼里 A 得真的回来。**
    // socket.io 重连建的是一条新连接，服务端那边 roomId 是空的；
    // 前端不重新 join 的话，A 屏幕上一切正常，实际已经收不到任何推送了。
    await expect(pb.locator("button[data-seat]").filter({ hasText: "掉线" })).toHaveCount(0);

    // A 也要能继续收到推送：B 离座，A 那边得看到位子空出来
    await pb.getByRole("button", { name: "离座" }).click();
    await expect(pa.getByRole("button", { name: "坐这 2" })).toBeVisible();

    await a.close();
    await b.close();
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
    await expect(page.getByRole("button", { name: "开房间" })).toHaveCount(0);
  });

  test("主动退出后刷新应该回大厅，不能又被拉回去", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await page.getByRole("button", { name: "← 退出" }).click();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
  });

  test("进房先在等待区，自己挑位子坐", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await expect(page.getByText("点一个空位坐下")).toBeVisible();

    await sit(page, 2);
    await expect(page.getByText("你的座位")).toBeVisible();
    await expect(page.getByText("3号", { exact: true })).toBeVisible();
  });

  test("坐满并全部准备之前开不了局", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await sit(page, 0);
    await expect(page.getByText(/还有 4 个空位没人坐/)).toBeVisible();
    await expect(page.getByRole("button", { name: "开始游戏" })).toBeDisabled();
  });

  test("房主能设几人局", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await page.getByRole("button", { name: "设置" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "7", exact: true }).click();
    await expect(sheet.getByText(/蓝方 4/)).toBeVisible();
    await expect(sheet.getByText(/红方 3/)).toBeVisible();
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

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("几人局")).toBeVisible();
    await expect(sheet.getByText(/蓝方 3/)).toBeVisible();
    await expect(sheet.getByText(/红方 2/)).toBeVisible();
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
    await sit(pa, 0);
    await openApp(pb);
    await pb.getByPlaceholder("房间码").fill(code);
    await pb.getByRole("button", { name: "进", exact: true }).click();
    await expect(pb.locator("p.font-display").first()).toHaveText(code);
    await sit(pb, 1);
    await expect(pa.getByText("2/5 就位").or(pa.getByText(/还有 3 个空位/))).toBeVisible();

    // A 发起换座
    await pa.getByRole("button", { name: "换座" }).click();
    await expect(pa.getByText("点一个人跟他换座")).toBeVisible();
    // 点 B 所在的 2 号座位
    await pa.locator("button").filter({ hasText: /^2 玩家|^2/ }).first().click();

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
    await sit(page, 0);

    await expect(page.getByText("你的座位")).toBeVisible();
    await expect(page.getByText("1号", { exact: true })).toBeVisible();
    // 自己那格照常显示昵称 —— 把它换成「你」等于把自己从名字体系里摘出去；
    // 区分靠号牌配色，不靠改称呼
    await expect(page.locator('button[data-seat="0"]')).toContainText("玩家");
  });
});

test.describe("座位号", () => {
  test("提到玩家的地方都要带号码 —— 线下全靠号码沟通", async ({ browser }) => {
    // 两人局够验证「号码 + 昵称」的拼法，不需要凑满一局
    const a = await browser.newContext({ locale: "zh-CN" });
    const b = await browser.newContext({ locale: "zh-CN" });
    const pa = await a.newPage();
    const pb = await b.newPage();

    await openApp(pa, "阿隆");
    const code = await createRoom(pa, "号码测试");
    await sit(pa, 0);

    await openApp(pb, "小梅");
    await pb.getByPlaceholder("房间码").fill(code);
    await pb.getByRole("button", { name: "进", exact: true }).click();
    await sit(pb, 1);

    // 换座请求里必须出现「1号 阿隆」而不是光秃秃的「阿隆」
    await pa.getByRole("button", { name: "换座" }).click();
    await pa.locator("button[data-seat]").filter({ hasText: "小梅" }).first().click();
    await expect(pb.getByText(/1号 阿隆.*想和你换座位/)).toBeVisible();

    await a.close();
    await b.close();
  });
});


test.describe("退出房间", () => {
  test("等待页点退出要回到大厅", async ({ page }) => {
    await openApp(page);
    await createRoom(page);
    await page.getByRole("button", { name: "← 退出" }).click();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
  });

  test("对局中点退出也要回到大厅", async ({ browser }) => {
    // 要 5 个人才能开局，这条只能起 5 个上下文
    const ctxs = await Promise.all(
      Array.from({ length: 5 }, () => browser.newContext({ locale: "zh-CN" })),
    );
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    for (const p of pages) await openApp(p);

    const host = pages[0]!;
    const code = await createRoom(host, "退出测试");
    await sit(host, 0);
    for (const [i, p] of pages.slice(1).entries()) {
      await p.getByPlaceholder("房间码").fill(code);
      await p.getByRole("button", { name: "进", exact: true }).click();
      await expect(p.locator("p.font-display").first()).toHaveText(code);
      await sit(p, i + 1);
    }
    for (const p of pages) await p.getByRole("button", { name: "准备" }).click();
    await expect(host.getByRole("button", { name: "开始游戏" })).toBeEnabled();
    await host.getByRole("button", { name: "开始游戏" }).click();

    const quitter = pages[4]!;
    // 身份卡开局自动弹出，先关掉才看得到底下的界面
    await expect(quitter.getByText("点击查看身份")).toBeVisible();
    await quitter.keyboard.press("Escape");
    await expect(quitter.getByRole("button", { name: "查看身份" })).toBeVisible();

    // 对局中也要能看到房间名和房间码。以前只藏在「离开这局？」的弹窗里 ——
    // 等你想退出时才看得到房间码，那时候已经晚了
    await expect(quitter.getByText("退出测试")).toBeVisible();
    await expect(quitter.locator("p.font-display, span.font-display").filter({ hasText: code }).first()).toBeVisible();

    await quitter.getByRole("button", { name: "退出" }).click();
    // 对局中退出要先确认 —— 座位会保留，这件事必须说清楚
    await expect(quitter.getByText(/座位会一直留着/)).toBeVisible();
    await quitter.getByRole("button", { name: "我自己离开" }).click();

    // 之前这里什么都不会发生：客户端本地状态没清，一直停在对局页
    await expect(quitter.getByRole("button", { name: "开房间" })).toBeVisible();
    // 而且刷新之后不该又被自动拉回房间
    await quitter.reload();
    await expect(quitter.getByRole("button", { name: "开房间" })).toBeVisible();

    for (const c of ctxs) await c.close();
  });
});

test.describe("个人中心", () => {
  test("进了房也能改昵称头像，改完桌上其他人立刻看到", async ({ browser }) => {
    const a = await browser.newContext({ locale: "zh-CN" });
    const b = await browser.newContext({ locale: "zh-CN" });
    const pa = await a.newPage();
    const pb = await b.newPage();

    await openApp(pa, "阿隆");
    const code = await createRoom(pa, "改名测试");
    await sit(pa, 0);

    await openApp(pb, "小梅");
    await pb.getByPlaceholder("房间码").fill(code);
    await pb.getByRole("button", { name: "进", exact: true }).click();
    await sit(pb, 1);
    await expect(pa.getByText("小梅")).toBeVisible();

    // 进房之后回不到大厅，改名入口必须在房里就有
    await pb.getByRole("button", { name: "我的资料" }).click();
    const nick = pb.getByRole("dialog").getByPlaceholder("你的昵称");
    await nick.fill("梅林本林");
    await nick.blur();

    await expect(pa.getByText("梅林本林")).toBeVisible();
    await expect(pa.getByText("小梅")).toHaveCount(0);

    await a.close();
    await b.close();
  });
});

test.describe("终局", () => {
  test("别人点了再来一局，我还没看完就不该被拽走", async ({ browser }) => {
    test.setTimeout(90_000);
    const ctxs = await Promise.all(
      Array.from({ length: 5 }, () => browser.newContext({ locale: "zh-CN" })),
    );
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    for (const [i, p] of pages.entries()) await openApp(p, `玩家${i}`);

    const host = pages[0]!;
    const code = await createRoom(host, "终局测试");
    await sit(host, 0);
    for (const [i, p] of pages.slice(1).entries()) {
      await p.getByPlaceholder("房间码").fill(code);
      await p.getByRole("button", { name: "进", exact: true }).click();
      await expect(p.locator("p.font-display").first()).toHaveText(code);
      await sit(p, i + 1);
    }
    for (const p of pages) await p.getByRole("button", { name: "准备" }).click();
    await host.getByRole("button", { name: "开始游戏" }).click();
    // 身份卡开局自动弹出，翻开就算确认看牌。
    // **必须等它真的关掉**：卡片是模态，打开时背景整块 aria-hidden，
    // getByRole 看不到底下的按钮，后面找队长会一个都找不到
    for (const p of pages) {
      await p.getByRole("dialog").getByRole("button", { name: /点击查看身份/ }).click();
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog")).toHaveCount(0);
    }

    // 打到终局最快的路子是连续 5 次流局 —— 红方直接赢，不用打完三车任务
    for (let round = 0; round < 5; round++) {
      await expect(host.getByText(/挑 \d+ 个人/)).toBeVisible();
      let leader = host;
      for (const p of pages) {
        // 还没选够人时按钮是「选 N 个人」，选够了才变成「确认 N」
        if (
          await p
            .getByRole("button", { name: /选 \d+ 个人|^确认 \d/ })
            .isVisible()
            .catch(() => false)
        ) {
          leader = p;
          break;
        }
      }
      const need = Number((await leader.getByText(/挑 \d+ 个人/).textContent())!.match(/\d+/)![0]);
      const seats = leader.locator("button[data-seat]:not([disabled])");
      for (let i = 0; i < need; i++) await seats.nth(i).click();
      await leader.getByRole("button", { name: /^确认 \d/ }).click();

      await expect(host.getByText("全体投票")).toBeVisible();
      for (const p of pages) await p.getByRole("button", { name: "反对" }).click();

      for (const p of pages) {
        const ok = p.getByRole("button", { name: "知道了" });
        if (await ok.isVisible().catch(() => false)) await ok.click();
      }
      const skip = host.getByRole("button", { name: "立即继续" });
      if (await skip.isVisible().catch(() => false)) await skip.click();
    }

    for (const p of pages) await expect(p.getByText(/获胜$/)).toBeVisible();

    // 3 号先点「再来一局」，他自己回等待页
    await pages[2]!.getByRole("button", { name: "再来一局" }).click();
    await expect(pages[2]!.getByRole("button", { name: "准备" })).toBeVisible();

    // **其他人必须还停在终局。**
    // 之前重开是整个房间一起走的，还在看身份揭晓和战报的人被当场拽走，
    // 结果一闪而过 —— 这条就是防它回来的
    for (const p of [host, pages[1]!, pages[3]!, pages[4]!]) {
      await expect(p.getByText(/获胜$/)).toBeVisible();
      await expect(p.getByRole("button", { name: "再来一局" })).toBeVisible();
    }

    await host.getByRole("button", { name: "再来一局" }).click();
    await expect(host.getByRole("button", { name: "准备" })).toBeVisible();

    /*
     * 打完的局要进本地战绩。服务端不知道「你」跨局是同一个人（无账号系统），
     * 所以战绩只能记在这台手机上。
     */
    await host.getByRole("button", { name: "← 退出" }).click();
    await expect(host.getByRole("button", { name: "开房间" })).toBeVisible();
    await host.getByRole("button", { name: "我的战绩" }).click();

    await expect(host.getByText("总胜率")).toBeVisible();
    // 这一局是红方靠连续流局赢的
    await expect(host.getByText("连续五次流局")).toBeVisible();
    await expect(host.getByText(/共 1 局/)).toBeVisible();

    // 刷新之后战绩还在 —— 存 localStorage 才算数，存内存等于没存
    await host.reload();
    await expect(host.getByRole("button", { name: "开房间" })).toBeVisible();
    await host.getByRole("button", { name: "我的战绩" }).click();
    await expect(host.getByText(/共 1 局/)).toBeVisible();

    // 点开某一局能看到那局的完整战报（服务端存着，7 天内有效）
    await host.getByText("连续五次流局").click();
    await expect(host.getByText("← 回到战绩")).toBeVisible();
    await expect(host.getByText(/第 1 轮/)).toBeVisible();

    for (const c of ctxs) await c.close();
  });
});

test.describe("首次进站", () => {
  test("没设过身份先挡一道，设完才进大厅", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "zh-CN" });
    const page = await ctx.newPage();
    await page.goto("/");

    await expect(page.getByText("先给自己起个名字，桌上好认人")).toBeVisible();
    await expect(page.getByRole("button", { name: "开房间" })).toHaveCount(0);
    // 名字不填不让进
    await expect(page.getByRole("button", { name: "进去玩" })).toBeDisabled();

    await page.getByPlaceholder("你的昵称").fill("阿隆");
    await page.getByRole("button", { name: "进去玩" }).click();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();

    // 设过之后刷新不再问
    await page.reload();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
    await expect(page.getByPlaceholder("你的昵称")).toHaveValue("阿隆");
    await ctx.close();
  });
});

test.describe("规则", () => {
  test("大厅能打开规则，含流程表和角色图鉴", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /看规则/ }).click();

    await expect(page.getByText("每轮上几个人")).toBeVisible();
    await expect(page.getByText(/保护轮/).first()).toBeVisible();

    // 几人局发什么牌要写在规则页里，不能只丢一句「去房间设置里看」
    await expect(page.getByText("几人局都有谁")).toBeVisible();
    await expect(page.getByText(/忠臣×2/).first()).toBeVisible();
    // 9 人才有莫德雷德，5 人没有 —— 表里得能查到这种差别
    await expect(page.getByText(/莫甘娜、刺客、莫德雷德/).first()).toBeVisible();
    await expect(page.getByText(/兰斯洛特模式（7 人起）/)).toBeVisible();

    await page.getByRole("button", { name: "角色图鉴" }).click();
    await expect(page.getByText("莫德雷德", { exact: true })).toBeVisible();
    await expect(page.getByText(/梅林看不见你/)).toBeVisible();

    await page.getByRole("button", { name: "← 返回" }).click();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
  });
});

test.describe("扔东西和表情包", () => {
  /** 起一局 5 人，推进到组队阶段 */
  const startGame = async (browser: import("@playwright/test").Browser) => {
    const ctxs = await Promise.all(
      Array.from({ length: 5 }, () => browser.newContext({ locale: "zh-CN" })),
    );
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    for (const [i, p] of pages.entries()) await openApp(p, `玩家${i + 1}`);

    const host = pages[0]!;
    const code = await createRoom(host, "互动测试");
    await sit(host, 0);
    for (const [i, p] of pages.slice(1).entries()) {
      await p.getByPlaceholder("房间码").fill(code);
      await p.getByRole("button", { name: "进", exact: true }).click();
      await sit(p, i + 1);
    }
    for (const p of pages) await p.getByRole("button", { name: "准备" }).click();
    await host.getByRole("button", { name: "开始游戏" }).click();

    // 身份卡开局自动弹出，翻开就等于确认看牌；看完必须关掉 ——
    // 它是模态的，开着时底下的座位按钮点不到
    for (const p of pages) {
      await p.getByRole("dialog").getByRole("button", { name: /点击查看身份/ }).click();
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog")).toHaveCount(0);
    }
    await expect(host.getByText(/挑 \d+ 个人/)).toBeVisible();
    return { ctxs, pages, host };
  };

  test("点别人头像弹小浮层，扔出去的东西真的会飞", async ({ browser }) => {
    const { ctxs, pages, host } = await startGame(browser);
    // 找一个不是队长的人来扔 —— 队长点头像是选人，不是扔东西
    let thrower = pages[0]!;
    for (const p of pages) {
      const isLeader = await p
        .getByRole("button", { name: /^选 \d+ 个人|^确认 \d/ })
        .isVisible()
        .catch(() => false);
      if (!isLeader) {
        thrower = p;
        break;
      }
    }
    const me = pages.indexOf(thrower);
    const targetSeat = me === 0 ? 1 : 0;

    await thrower.locator(`button[data-seat="${targetSeat}"]`).click();
    // 不是 Sheet —— 页面上不该出现 dialog
    await expect(thrower.getByRole("dialog")).toHaveCount(0);
    await expect(thrower.getByRole("button", { name: "砸蛋" })).toBeVisible();
    await expect(thrower.getByRole("button", { name: "扔番茄" })).toBeVisible();
    await expect(thrower.getByRole("button", { name: "泼水" })).toBeVisible();

    await thrower.getByRole("button", { name: "砸蛋" }).click();
    // 全场都该看到它飞
    await expect(host.locator('[data-toss="EGG"]')).toHaveCount(1);

    /*
     * 逐帧采样，验两件事 —— 截图对不准这种时间点，只能在页面里量：
     *
     * 1. **落地效果真的显现过。** 之前收摊挂在抛射动画上，抛射一结束
     *    就把整条 reaction 删了，落地那一下只有几十毫秒的命且还在
     *    opacity 0 —— WebKit 上永远看不到。
     * 2. **抛射物落地就消失。** 不淡掉的话，鸡蛋会一直杵在对方脸上，
     *    等落地效果放完了它还在，看起来就是「先炸开又冒出个蛋」。
     */
    const trace = await host.evaluate(async () => {
      const frames: { fly: number; hit: number }[] = [];
      for (let i = 0; i < 24; i++) {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? Number(getComputedStyle(el).opacity) : 0;
        };
        frames.push({ fly: read("[data-toss]"), hit: read("[data-toss-hit]") });
        await new Promise((r) => setTimeout(r, 50));
      }
      return frames;
    });

    expect(Math.max(...trace.map((f) => f.hit)), "落地效果从没显现过").toBeGreaterThan(0.7);
    expect(Math.max(...trace.map((f) => f.fly)), "抛射物从没显现过").toBeGreaterThan(0.7);
    // 交接：不该有哪一帧两个都还很实
    const overlap = trace.filter((f) => f.fly > 0.6 && f.hit > 0.6);
    expect(overlap, "抛射物落地后没消失，和落地效果同时杵着").toHaveLength(0);

    // 放完了自己收摊
    await expect(host.locator("[data-toss]")).toHaveCount(0, { timeout: 4000 });
    await expect(host.locator("[data-toss-hit]")).toHaveCount(0);

    for (const c of ctxs) await c.close();
  });

  test("点自己头像弹的是表情包", async ({ browser }) => {
    const { ctxs, pages, host } = await startGame(browser);
    const notLeader = pages.find(
      (p) => p !== host,
    )!;
    // 找到自己那格：座位号和进房顺序一致
    const mySeat = pages.indexOf(notLeader);

    await notLeader.locator(`button[data-seat="${mySeat}"]`).click();
    await expect(notLeader.getByRole("button", { name: "我信你个鬼" })).toBeVisible();
    // 不该出现扔东西的选项
    await expect(notLeader.getByRole("button", { name: "砸蛋" })).toHaveCount(0);

    await notLeader.getByRole("button", { name: "我信你个鬼" }).click();
    // 全场都看得到，气泡上带那句话
    await expect(host.getByText("我信你个鬼")).toBeVisible();

    for (const c of ctxs) await c.close();
  });
});

test.describe("排行榜", () => {
  test("排行榜页能打开，口径都写清楚了", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "排行榜" }).click();

    // 别断言「库是空的」—— 同一次 e2e 里前面的用例可能已经打完过局。
    // 要验的是**页面本身**：口径说明和身份提示在任何数据状态下都必须在
    // 每个指标都得有口径说明
    await expect(page.getByText(/你当队长、车通过了，车上有红方的比例/)).toBeVisible();
    await expect(page.getByText(/你投反对的车里，确实有红方的比例/)).toBeVisible();
    // 没有账号系统这件事要挑明
    await expect(page.getByText(/清了浏览器数据或换设备/)).toBeVisible();

    await page.getByRole("button", { name: "对局记录" }).click();
    // 有数据就该列出来，没数据就该说清楚，两者必居其一
    await expect(
      page.getByText("还没有打完的对局").or(page.getByRole("button", { name: /详情|收起/ }).first()),
    ).toBeVisible();

    await page.getByRole("button", { name: "← 返回" }).click();
    await expect(page.getByRole("button", { name: "开房间" })).toBeVisible();
  });
});
