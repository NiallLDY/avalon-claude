/**
 * 首次进站的身份设置。
 *
 * 没有账号系统，但**总得知道桌上谁是谁** —— 一屋子人全叫「圆桌骑士」是没法玩的。
 * 所以第一次打开必须设一次昵称和头像，之后记在这台手机上，不会再问。
 */

import { useState } from "react";
import { NICK_MAX, sanitizeText } from "@avalon/shared";
import { Avatar } from "../components/Avatar.js";
import { Button } from "../components/ui.js";
import { randomAvatar } from "../lib/identity.js";
import { useStore } from "../store.js";

export const Onboarding = () => {
  const { profile, setProfile, completeOnboarding } = useStore();
  const [nick, setNick] = useState("");
  const [avatar, setAvatar] = useState(profile.avatar);

  const clean = sanitizeText(nick, NICK_MAX);

  const submit = () => {
    if (!clean) return;
    setProfile({ nick: clean, avatar });
    completeOnboarding();
  };

  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-6 px-6 safe-top safe-bottom">
      <header className="text-center">
        <h1 className="font-display text-2xl tracking-[0.2em] text-gold">MELBOURNE 阿瓦隆</h1>
        <p className="mt-2 text-sm text-ink-soft">先给自己起个名字，桌上好认人</p>
      </header>

      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={() => setAvatar(randomAvatar())}
          className="relative active:scale-95"
          aria-label="换个头像"
        >
          <Avatar avatar={avatar} size={96} />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs">
            🎲
          </span>
        </button>
        <p className="text-xs text-ink-mute">点头像换一个</p>

        <input
          value={nick}
          maxLength={NICK_MAX}
          autoFocus
          enterKeyHint="done"
          onChange={(e) => setNick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="你的昵称"
          className="w-full rounded-xl bg-surface-2 px-4 py-3 text-center text-lg outline-none
            focus:ring-1 focus:ring-gold/60"
        />
      </div>

      <div className="space-y-3">
        <Button className="w-full" disabled={!clean} onClick={submit}>
          进去玩
        </Button>
        <p className="text-center text-[0.7rem] leading-relaxed text-ink-mute">
          不用注册。昵称和头像只记在这台手机上，随时能改。
          <br />
          换手机要重新设一次。
        </p>
      </div>
    </div>
  );
};
