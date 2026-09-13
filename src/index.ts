import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

let serverInstance: OpenCOOPServer | null = null;
let serverReady = false;

async function startServer() {
  console.log("[OpenCOOP] Plugin loading...");
  logger.info("OpenCOOP plugin loading...");

  try {
    const config = await loadConfig();
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
}

const plugin = {
  id: "opencoop",
  setup: async (): Promise<void> => {
    await startServer();
  },
};

export default plugin;
export { OpenCOOPServer };
export type { ServerConfig } from "./types/index.js";
