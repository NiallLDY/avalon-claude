/**
 * 聊天室。两个频道：**所有人** 和 **队友**。
 *
 * 队友频道只有互认的坏人收得到 —— 那是服务端裁剪的结果（`engine/projection.ts`），
 * 不是这里"不显示"。奥伯伦和红兰斯洛特连消息本体都拿不到，抓包也看不见。
 *
 * 能不能在队友频道发言看 `me.canEvilChat`，那是服务端算好下发的；
 * 前端不照着 vision 自己推，否则「谁算互认」就有了两处判据。
 */

import { useEffect, useRef, useState } from "react";
import { CHAT_TEXT_MAX, type ChatChannel, type ClientGameView, type PublicPlayer } from "@avalon/shared";
import { Avatar } from "./Avatar.js";
import { useStore } from "../store.js";

const CHANNELS: readonly { id: ChatChannel; label: string }[] = [
  { id: "ALL", label: "所有人" },
  { id: "EVIL", label: "队友" },
];

export const Chat = ({
  game,
  seated,
}: {
  game: ClientGameView;
  seated: readonly (PublicPlayer | null)[];
}) => {
  const emit = useStore((s) => s.emit);
  const markChatSeen = useStore((s) => s.markChatSeen);
  const canEvil = game.me?.canEvilChat ?? false;
  const [channel, setChannel] = useState<ChatChannel>("ALL");
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement | null>(null);

  const shown = game.chat.filter((m) => m.channel === channel);

  // 打开着就一直算已读 —— 消息进来时列表就在眼前
  useEffect(() => {
    const last = game.chat[game.chat.length - 1];
    if (last) markChatSeen(last.id);
  }, [game.chat, markChatSeen]);

  // 新消息把列表滚到底。行为参照所有聊天软件，不滚的话新消息在屏幕外
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [shown.length, channel]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    emit("game:chat", { channel, text });
    setDraft("");
  };

  return (
    <div className="flex h-[60dvh] min-h-0 flex-col gap-2 pb-2">
      <div className="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1">
        {CHANNELS.map((c) => {
          // 不在队友频道里的人连这个标签都不该看到 —— 它本身就是一条情报
          if (c.id === "EVIL" && !canEvil) return null;
          const on = channel === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setChannel(c.id)}
              className={`min-h-8 flex-1 rounded-md px-3 text-sm transition
                ${on ? (c.id === "EVIL" ? "bg-red font-medium text-white" : "bg-gold font-medium text-ground") : "text-ink-soft"}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {channel === "EVIL" ? (
        <p className="shrink-0 text-center text-[0.65rem] text-red/80">
          只有互相认得的坏人看得到这里
        </p>
      ) : null}

      {/* 聊天记录是长列表，允许滚 —— 它在 Bottom Sheet 里，不是主界面骨架 */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl bg-surface p-3">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-mute">还没有人说话</p>
        ) : (
          shown.map((m) => {
            const player = seated[m.seat];
            const mine = m.seat === game.me?.seat;
            return (
              <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                {player ? <Avatar avatar={player.avatar} size={26} className="shrink-0" /> : null}
                <div className={`min-w-0 ${mine ? "text-right" : ""}`}>
                  <p className="text-[0.6rem] text-ink-mute">
                    <span className="tabular-nums">{m.seat + 1}</span>
                    {player ? ` ${player.nick}` : ""}
                  </p>
                  <p
                    className={`inline-block max-w-full break-words rounded-xl px-2.5 py-1.5 text-sm
                      ${mine ? "bg-gold/20" : "bg-surface-2"}`}
                  >
                    {m.text}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <div className="flex shrink-0 gap-2">
        <input
          value={draft}
          maxLength={CHAT_TEXT_MAX}
          enterKeyHint="send"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder={channel === "EVIL" ? "只有队友看得到…" : "说点什么…"}
          className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-base outline-none
            focus:ring-1 focus:ring-gold/60"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={send}
          className={`shrink-0 rounded-lg px-4 text-sm font-medium transition disabled:opacity-40
            ${channel === "EVIL" ? "bg-red text-white" : "bg-gold text-ground"}`}
        >
          发送
        </button>
      </div>
    </div>
  );
};
