import { useEffect } from "react";
import { ResultOverlay } from "./components/ResultOverlay.js";
import { ConnectionBanner, Toasts } from "./components/ui.js";
import { Lobby } from "./pages/Lobby.js";
import { Room } from "./pages/Room.js";
import { Game } from "./pages/Game.js";
import { GameOver } from "./pages/GameOver.js";
import { useStore } from "./store.js";

export const App = () => {
  const connect = useStore((s) => s.connect);
  const state = useStore((s) => s.state);

  useEffect(() => connect(), [connect]);

  // 路由就这么点，没必要引 react-router：状态本身决定该显示哪一屏
  const screen = !state ? (
    <Lobby />
  ) : state.game === null ? (
    <Room />
  ) : state.game.phase === "GAME_OVER" ? (
    <GameOver game={state.game} />
  ) : (
    <Game />
  );

  return (
    <>
      <ConnectionBanner />
      <main className="min-h-0 flex-1">{screen}</main>
      <ResultOverlay />
      <Toasts />
    </>
  );
};
