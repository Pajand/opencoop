import type { PluginModule, PluginInput } from "@opencode-ai/plugin";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

const plugin: PluginModule = {
  id: "opencoop",
  server: async (_input: PluginInput) => {
    console.log("[OpenCOOP] Plugin server starting...");
    logger.info("OpenCOOP plugin server starting...");

    const config = await loadConfig();
    const port = config.port || 31313;
    const server = new OpenCOOPServer(config);

    try {
      await server.startHttp(port);
      console.log(`[OpenCOOP] Server ready on port ${port}`);
      logger.info("OpenCOOP server started on port %d", port);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[OpenCOOP] Failed to start:", msg);
      logger.error("Failed to start OpenCOOP: %s", msg);
      throw error;
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
