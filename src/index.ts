import type { PluginModule, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

let serverInstance: OpenCOOPServer | null = null;
let serverPort: number = 31313;

const server = async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
  logger.info("OpenCOOP plugin loading...");

  try {
    const config = await loadConfig(input.project);
    serverPort = config.port || 31313;

    // Start the MCP server
    serverInstance = new OpenCOOPServer(config);
    await serverInstance.startHttp(serverPort);

    logger.info("OpenCOOP server started on port %d", serverPort);
  } catch (error) {
    logger.error("Failed to start OpenCOOP: %s", error instanceof Error ? error.message : String(error));
  }

  return {
    // Modify config to add MCP server
    config: async (inputConfig: Config) => {
      logger.info("OpenCOOP: Modifying config to add MCP server");

      // Add our MCP server to the config
      if (!inputConfig.mcp) {
        (inputConfig as any).mcp = {};
      }

      (inputConfig as any).mcp["opencoop"] = {
        type: "remote",
        url: `http://localhost:${serverPort}/mcp`,
        enabled: true,
      };
    },

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
