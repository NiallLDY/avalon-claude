import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Melbourne 阿瓦隆",
        short_name: "阿瓦隆",
        description: "线下面对面玩阿瓦隆时用的在线发牌器",
        lang: "zh-CN",
        // standalone 是「单屏不滚动」真正成立的前提：加到桌面后没有浏览器地址栏，
        // 视口高度不会随滚动抖动
        display: "standalone",
        orientation: "portrait",
        background_color: "#0D0F17",
        theme_color: "#0D0F17",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // 角色卡按需缓存，别一次性把 1.5MB 插画全预缓存了
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /\/art\/roles\/.*\.webp$/,
            handler: "CacheFirst",
            options: { cacheName: "role-art", expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/ws": { target: "http://127.0.0.1:3000", ws: true },
      "/art": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
