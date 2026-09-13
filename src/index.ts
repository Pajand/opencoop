import type { PluginModule, PluginInput, Hooks } from "@opencode-ai/plugin";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

let serverInstance: OpenCOOPServer | null = null;

const server = async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
  logger.info("OpenCOOP plugin loading...");

  try {
    const config = await loadConfig(input.project);
    const port = config.port || 31313;

    // Start the MCP server
    serverInstance = new OpenCOOPServer(config);
    await serverInstance.startHttp(port);

    logger.info("OpenCOOP server started on port %d", port);
    logger.info("MCP endpoint: http://localhost:%d/mcp", port);
    logger.info("Web UI: http://localhost:%d", port);
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
