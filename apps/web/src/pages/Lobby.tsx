/**
 * 首页 / 大厅。单屏：身份卡 + 房间列表 + 建房/输码加入。
 * 房间列表本身可以滚（它是列表，不是主界面骨架），但页面整体不滚。
 */

import { useEffect, useState } from "react";
import { ROOM_NAME_MAX, sanitizeText } from "@avalon/shared";
import { ProfileEditor } from "../components/Profile.js";
import { Button, Sheet, Toggle } from "../components/ui.js";
import { useStore } from "../store.js";

export const Lobby = () => {
  const { profile, rooms, createRoom, joinRoom, refreshRooms } = useStore();
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [allowSpectators, setAllowSpectators] = useState(true);

  useEffect(() => {
    void refreshRooms();
    const timer = setInterval(() => void refreshRooms(query), 5_000);
    return () => clearInterval(timer);
  }, [refreshRooms, query]);

  const submitCreate = async () => {
    const name = sanitizeText(roomName, ROOM_NAME_MAX) || `${profile.nick}的房间`;
    const id = await createRoom({
      name,
      visibility: isPrivate ? "PRIVATE" : "PUBLIC",
      allowSpectators,
    });
    if (id) setCreating(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 pt-3 safe-top safe-bottom">
      <header className="shrink-0">
        <h1 className="text-center font-display text-xl tracking-[0.2em] text-gold">
          MELBOURNE 阿瓦隆
        </h1>
        <button
          type="button"
          onClick={() => useStore.getState().setRulesOpen(true)}
          className="mx-auto block text-center text-xs text-ink-mute underline decoration-dotted
            underline-offset-4 active:text-gold"
        >
          线下面对面玩阿瓦隆用的发牌器 · 看规则
        </button>
      </header>

      {/* 身份卡 —— 无账号，改完即生效 */}
      <section className="shrink-0 rounded-2xl border border-line bg-surface p-3">
        <ProfileEditor />
        <p className="mt-2 text-[0.7rem] text-ink-mute">
          不用注册。昵称和头像只记在这台手机上，换手机要重新设一次。
        </p>
      </section>

      <div className="flex shrink-0 gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜房间名"
          className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2.5 text-sm outline-none
            focus:ring-1 focus:ring-gold/60"
        />
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="房间码"
          inputMode="text"
          autoCapitalize="characters"
          className="w-24 rounded-lg bg-surface px-3 py-2.5 text-center text-sm tracking-widest
            outline-none focus:ring-1 focus:ring-gold/60"
        />
        <Button tone="gold" disabled={code.length !== 6} onClick={() => joinRoom(code)}>
          进
        </Button>
      </div>

      {/* 唯一允许滚动的区域 */}
      <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface">
        {rooms.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-mute">
            还没有公开房间
            <br />
            开一个吧
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => joinRoom(room.id, room.inGame)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{room.name}</span>
                    <span className="block text-xs text-ink-mute">
                      {room.id} · {room.playerCount} 人
                      {room.inGame ? " · 进行中" : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[0.7rem]
                      ${room.inGame ? "bg-surface-2 text-ink-mute" : "bg-gold/15 text-gold"}`}
                  >
                    {room.inGame ? (room.allowSpectators ? "观战" : "进行中") : "加入"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={creating}
        onOpenChange={setCreating}
        title="开个房间"
        trigger={
          <Button className="shrink-0" onClick={() => setCreating(true)}>
            开房间
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pt-1">
          <input
            value={roomName}
            maxLength={ROOM_NAME_MAX}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder={`${profile.nick}的房间`}
            className="rounded-lg bg-surface-2 px-3 py-3 text-base outline-none
              focus:ring-1 focus:ring-gold/60"
          />
          <div className="divide-y divide-line">
            <Toggle
              label="私密房间"
              hint="不出现在大厅列表，只能凭房间码进"
              checked={isPrivate}
              onChange={setPrivate}
            />
            <Toggle
              label="允许观战"
              hint="没上桌的人可以旁观，但看不到任何人的身份"
              checked={allowSpectators}
              onChange={setAllowSpectators}
            />
          </div>
          <Button onClick={() => void submitCreate()}>创建</Button>
        </div>
      </Sheet>
    </div>
  );
};
