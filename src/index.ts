import { logger } from "./utils/logger.js";

const plugin = {
  id: "opencoop",
  setup: async (_context?: any): Promise<void> => {
    console.log("[OpenCOOP] Plugin loaded (MCP runs via stdio CLI)");
    logger.info("OpenCOOP plugin loaded - MCP handled by CLI");
  },
};

export default plugin;
export type { ServerConfig } from "./types/index.js";
