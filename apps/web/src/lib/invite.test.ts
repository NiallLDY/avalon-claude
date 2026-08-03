/**
 * 邀请码解析。这一层要挡的是**被聊天软件改过的链接** ——
 * 尾部多斜杠、被截断、后面粘了别的东西。解析错了不会崩，
 * 只会拿一个半截的码去 join，用户看到的是一句莫名其妙的「房间不存在」。
 */

import { describe, expect, it } from "vitest";
import { parseInviteCode } from "./invite.js";

describe("parseInviteCode", () => {
  it("认得出正常的邀请路径", () => {
    expect(parseInviteCode("/j/123456")).toBe("123456");
    expect(parseInviteCode("/j/000000")).toBe("000000");
  });

  it("尾部多余的斜杠不影响 —— 有些客户端会自己补一个", () => {
    expect(parseInviteCode("/j/123456/")).toBe("123456");
    expect(parseInviteCode("/j/123456///")).toBe("123456");
  });

  it("不是邀请路径就返回 null", () => {
    for (const p of ["/", "/lobby", "/join/123456", "j/123456", ""]) {
      expect(parseInviteCode(p), p).toBeNull();
    }
  });

  it("码本身不合法一律当没有，绝不拿半截的码去撞房间", () => {
    for (const p of [
      "/j/12345", // 短一位，链接被截断
      "/j/1234567", // 多一位
      "/j/ABC234", // 旧的字母码
      // 真实的 location.pathname 里不会有 ?，追踪参数落在 search 上、不影响解析。
      // 这条只是钉住「整段必须是六位数字」，别哪天为了兼容改成前缀匹配
      "/j/123456?from=wechat",
      "/j/123 456",
      "/j/",
    ]) {
      expect(parseInviteCode(p), p).toBeNull();
    }
  });
});
