import type { PluginModule, PluginInput, Hooks } from "@opencode-ai/plugin";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

let serverInstance: OpenCOOPServer | null = null;
let serverReady = false;

function waitForServer(timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (serverReady) {
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

const server = async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
  console.log("[OpenCOOP] Plugin loading...");
  logger.info("OpenCOOP plugin loading...");

  try {
    const config = await loadConfig(input.project);
    const port = config.port || 31313;

    serverInstance = new OpenCOOPServer(config);
    await serverInstance.startHttp(port);
    serverReady = true;

    console.log(`[OpenCOOP] Server ready on port ${port}`);
    logger.info("OpenCOOP server started on port %d", port);
  } catch (error) {
    serverReady = false;
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[OpenCOOP] Failed to start:", msg);
    logger.error("Failed to start OpenCOOP: %s", msg);
  }

  return {
    dispose: async () => {
      serverReady = false;
      logger.info("OpenCOOP plugin disposing...");
      if (serverInstance) {
        try {
          await serverInstance.stop();
        } catch {
          // Ignore
        }
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
export { OpenCOOPServer, waitForServer };
export type { ServerConfig } from "./types/index.js";
