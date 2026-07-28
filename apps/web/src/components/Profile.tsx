/**
 * 个人资料：昵称 + 头像。无账号系统，改完即生效（铁律 6）。
 *
 * 大厅、等待页、对局页共用同一份 —— 进了房间之后没法回大厅，
 * 编辑器只放在大厅的话，中途想改个名字就只能退房。
 */

import { useEffect, useState } from "react";
import { NICK_MAX, sanitizeText } from "@avalon/shared";
import { Avatar } from "./Avatar.js";
import { Sheet } from "./ui.js";
import { randomAvatar } from "../lib/identity.js";
import { useStore } from "../store.js";

/**
 * 昵称输入框。
 *
 * 之前的写法是每敲一个字就把原始值 setProfile 一次，而 setProfile 会往服务端 emit ——
 * 于是「清空输入框重打」这个再正常不过的动作，中途必然发出一个空昵称，
 * 被服务端 Zod 拒掉弹「参数不合法」；连打几个字还会撞上消息频率限制。
 *
 * 现在：输入框自己持有草稿，**只在失焦或按回车时**提交一次清洗过的值；
 * 清洗后为空就回退到原昵称，不往服务端发。
 */
export const NickInput = () => {
  const { profile, setProfile } = useStore();
  const [draft, setDraft] = useState(profile.nick);

  // 外部改了昵称（比如换设备同步）时跟随
  useEffect(() => setDraft(profile.nick), [profile.nick]);

  const commit = () => {
    const clean = sanitizeText(draft, NICK_MAX);
    if (!clean) {
      setDraft(profile.nick); // 空值不提交，视觉上回滚
      return;
    }
    if (clean !== profile.nick) setProfile({ ...profile, nick: clean });
    else setDraft(clean);
  };

  return (
    <input
      value={draft}
      maxLength={NICK_MAX}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="你的昵称"
      enterKeyHint="done"
      className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-base outline-none
        focus:ring-1 focus:ring-gold/60"
    />
  );
};

/** 头像 + 昵称。点头像换一个 */
export const ProfileEditor = ({ size = 52 }: { size?: number }) => {
  const { profile, setProfile } = useStore();
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setProfile({ ...profile, avatar: randomAvatar() })}
        className="relative shrink-0 active:scale-95"
        aria-label="换个头像"
      >
        <Avatar avatar={profile.avatar} size={size} />
        <span className="absolute -bottom-1 -right-1 rounded-full bg-surface-2 px-1 text-[0.65rem]">
          🎲
        </span>
      </button>
      <NickInput />
    </div>
  );
};

/**
 * 顶栏那颗头像，点开就是个人中心。
 *
 * 它顶掉了原来的「你是 3 号」—— 自己几号在座位区自己那格上写着，
 * 顶栏再写一遍是重复占位，那个位置拿来放真正没有入口的东西更值。
 */
export const ProfileButton = ({ size = 26 }: { size?: number }) => {
  const [open, setOpen] = useState(false);
  const profile = useStore((s) => s.profile);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="我的资料"
        className="shrink-0 rounded-full ring-1 ring-line active:scale-95"
      >
        <Avatar avatar={profile.avatar} size={size} />
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="我">
        <div className="space-y-3 pb-2">
          <ProfileEditor />
          <p className="text-[0.7rem] text-ink-mute">
            改完立刻生效，桌上所有人都会看到新的名字和头像。
            不用注册，这两样只记在这台手机上，换手机要重新设一次。
          </p>
        </div>
      </Sheet>
    </>
  );
};
