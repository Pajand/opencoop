import type { PluginModule, PluginInput, Hooks } from "@opencode-ai/plugin";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

let serverInstance: OpenCOOPServer | null = null;

const server = async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
  logger.info("OpenCOOP plugin loading...");

  try {
    const config = await loadConfig(input.project);

    // Start the MCP server on port 31313
    serverInstance = new OpenCOOPServer(config);
    await serverInstance.startHttp(config.port || 31313);

    logger.info("OpenCOOP plugin ready on port %d", config.port || 31313);
  } catch (error) {
    logger.error("Failed to start OpenCOOP: %s", error instanceof Error ? error.message : String(error));
  }

  return {
    dispose: async () => {
      logger.info("OpenCOOP plugin disposing...");
      if (serverInstance) {
        await serverInstance.stop();
        serverInstance = null;
      }
    },
  };
};

const plugin: PluginModule = {
  id: "opencoop",
  server,
};

export default plugin;

export { OpenCOOPServer };
export type { ServerConfig } from "./types/index.js";
