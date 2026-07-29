import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      reducedMotion="user" 让 Motion 跟随系统的「减少动态效果」。
      CSS 那边有 @media (prefers-reduced-motion)，但它管不到 JS 驱动的动画 ——
      两边都得接上，否则关了动效还是有一半在动。
    */}
    {/*
      LazyMotion + `m` 组件：只打包动画与退场那部分特性（domAnimation），
      不带拖拽和 layout 动画 —— 那两样一个都没用到，白背几十 KB。
      用 `m.` 而不是 `motion.` 是这套按需加载的前提。
    */}
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <App />
      </LazyMotion>
    </MotionConfig>
  </StrictMode>,
);
