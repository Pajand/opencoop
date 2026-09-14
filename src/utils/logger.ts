import pino from "pino";

const isTTY = process.stderr.isTTY;

export const logger = pino(
  { level: process.env.LOG_LEVEL || "info" },
  isTTY
    ? pino.transport({
        target: "pino-pretty",
        options: { colorize: true, destination: 2 },
      })
    : pino.destination(2)
);
