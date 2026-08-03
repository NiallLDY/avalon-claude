import { useEffect } from "react";
import { ResultOverlay } from "./components/ResultOverlay.js";
import { ConnectionBanner, Toasts } from "./components/ui.js";
import { Lobby } from "./pages/Lobby.js";
import { Room } from "./pages/Room.js";
import { Game } from "./pages/Game.js";
import { GameOver } from "./pages/GameOver.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Leaderboard } from "./pages/Leaderboard.js";
import { Rules } from "./pages/Rules.js";
import { useStore } from "./store.js";

/** 正在进房时的占位屏。连接横幅照常挂着，真连不上时不会只剩一句「正在进入」 */
const Entering = () => (
  <div className="flex h-full flex-col items-center justify-center gap-3">
    <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-gold" />
    <p className="text-sm text-ink-mute">正在进入房间…</p>
  </div>
);

export const App = () => {
  const connect = useStore((s) => s.connect);
  const state = useStore((s) => s.state);
  const finishedGame = useStore((s) => s.finishedGame);
  const needsOnboarding = useStore((s) => s.needsOnboarding);
  const rulesOpen = useStore((s) => s.rulesOpen);
  const boardOpen = useStore((s) => s.boardOpen);
  const setBoardOpen = useStore((s) => s.setBoardOpen);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const restoring = useStore((s) => s.restoring);

  useEffect(() => connect(), [connect]);

  // 没设过身份先挡一道 —— 一屋子人全叫「圆桌骑士」是没法玩的
  if (needsOnboarding) {
    return (
      <main className="min-h-0 flex-1">
        <Onboarding />
      </main>
    );
  }

  // 路由就这么点，没必要引 react-router：状态本身决定该显示哪一屏。
  // 唯一的例外是终局：房间可能已经被别人退回等待页了，但我还没看完 ——
  // 那就接着显示本地留的那份，直到我自己点掉（store 里的 finishedGame）。
  const screen = !state ? (
    // 刷新回房或点邀请链接进来时，先别把大厅闪一下 —— 那一下会让人以为没进去
    restoring ? (
      <Entering />
    ) : (
      <Lobby />
    )
  ) : finishedGame ? (
    <GameOver game={finishedGame} />
  ) : state.game === null ? (
    <Room />
  ) : (
    <Game />
  );

  return (
    <>
      <ConnectionBanner />
      <main className="min-h-0 flex-1">{screen}</main>
      <ResultOverlay />
      <Toasts />
      {rulesOpen ? <Rules onClose={() => setRulesOpen(false)} /> : null}
      {boardOpen ? <Leaderboard onClose={() => setBoardOpen(false)} /> : null}
    </>
  );
};
