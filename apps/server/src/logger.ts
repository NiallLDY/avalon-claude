import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? (config.env === "production" ? "info" : "debug"),
  // 日志里绝不出现 token、角色、任务牌 —— 服务器日志也是泄漏面
  redact: {
    paths: ["token", "*.token", "roles", "*.roles", "cardsBySeat", "*.cardsBySeat"],
    censor: "[redacted]",
  },
  ...(config.env === "production"
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }),
});
