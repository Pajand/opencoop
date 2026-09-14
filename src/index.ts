import type { PluginModule, PluginInput } from "@opencode-ai/plugin";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

async function isServerAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

const plugin: PluginModule = {
  id: "opencoop",
  server: async (_input: PluginInput) => {
    console.log("[OpenCOOP] Plugin server starting...");
    logger.info("OpenCOOP plugin server starting...");

    let config;
    try {
      config = await loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OpenCOOP] Failed to load config:", msg);
      logger.error("Failed to load config: %s", msg);
      return {};
    }

    const port = config.port || 31313;
    const server = new OpenCOOPServer(config);

    try {
      await server.startHttp(port);
      console.log(`[OpenCOOP] Server ready on port ${port}`);
      logger.info("OpenCOOP server started on port %d", port);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isPortBusy =
        (error as any)?.code === "EADDRINUSE" ||
        msg.includes("EADDRINUSE") ||
        msg.includes("already in use") ||
        msg.includes("address in use") ||
        msg.includes("in use");

      if (isPortBusy) {
        const alive = await isServerAlive(port);
        if (alive) {
          console.log(`[OpenCOOP] Port ${port} already in use and server is alive - reusing`);
          logger.warn("OpenCOOP port %d in use, server alive - reusing existing instance", port);
          return {};
        }
        console.log(`[OpenCOOP] Port ${port} in use but server not responding - waiting and retrying`);
        logger.warn("OpenCOOP port %d in use, server not alive", port);
        await new Promise((r) => setTimeout(r, 2000));
        const retryAlive = await isServerAlive(port);
        if (retryAlive) {
          console.log(`[OpenCOOP] Server came up on port ${port} after wait`);
          return {};
        }
      }

      console.error("[OpenCOOP] Failed to start:", msg);
      logger.error("Failed to start OpenCOOP: %s", msg);
      return {};
    }

    return {
      dispose: async () => {
        await server.stop();
      },
    };
  },
};

export default plugin;
export { OpenCOOPServer };
export type { ServerConfig } from "./types/index.js";
