import pino from "pino";

const isTTY = process.stdout.isTTY;

export const logger = pino(
  isTTY
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
        level: process.env.LOG_LEVEL || "info",
      }
    : { level: process.env.LOG_LEVEL || "info" }
);
