import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";
import net from "net";

let serverInstance: OpenCOOPServer | null = null;
let serverReady = false;
let starting = false;

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function ensureServer() {
  if (serverReady && serverInstance) return;
  if (starting) {
    while (starting && !serverReady) {
      await new Promise(r => setTimeout(r, 100));
    }
    return;
  }

  starting = true;
  try {
    const config = await loadConfig();
    const port = config.port || 31313;

    const inUse = await isPortInUse(port);
    if (inUse) {
      console.log(`[OpenCOOP] Port ${port} already in use - server running from another process`);
      serverReady = true;
      starting = false;
      return;
    }

    serverInstance = new OpenCOOPServer(config);
    await serverInstance.startHttp(port);
    serverReady = true;

    console.log(`[OpenCOOP] Server ready on port ${port}`);
    logger.info("OpenCOOP server started on port %d", port);
  } catch (error) {
    serverReady = false;
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('EADDRINUSE')) {
      console.log(`[OpenCOOP] Port already in use - assuming server is running`);
      serverReady = true;
    } else {
      console.error("[OpenCOOP] Failed to start:", msg);
      logger.error("Failed to start OpenCOOP: %s", msg);
    }
  } finally {
    starting = false;
  }
}

ensureServer().catch(() => {});

const plugin = {
  id: "opencoop",
  setup: async (_context?: any): Promise<void> => {
    console.log("[OpenCOOP] Plugin setup called");
    logger.info("OpenCOOP plugin setup called");
    await ensureServer();
  },
};

export default plugin;
export { OpenCOOPServer, ensureServer };
export type { ServerConfig } from "./types/index.js";
