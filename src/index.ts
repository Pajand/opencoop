import type { PluginModule, PluginInput } from "@opencode-ai/plugin";
import { bootstrapOpenCOOP, buildOpenCOOPTools } from "./plugin-core.js";
import { v2Setup } from "./v2.js";

/**
 * OpenCOOP plugin — dual-generation entry point.
 *
 *  - OpenCode V1 (@opencode-ai/plugin) calls `server(input)` and consumes the
 *    returned `{ tool, dispose }` hooks.
 *  - OpenCode V2 (@opencode/plugin) loads the default export and calls
 *    `setup(ctx)` (the V2 definition is `{ id, setup }`; Plugin.define is an
 *    identity function). Config key is `plugins` on V2 vs `plugin` on V1.
 *
 * Both paths share plugin-core, so tools behave identically on both runtimes.
 */

const v1Server = async (_input: PluginInput) => {
  try {
    console.log("[OpenCOOP] Plugin server starting...");

    const b = await bootstrapOpenCOOP();
    if (!b) return {};

    const { tools, dispose } = buildOpenCOOPTools(b);
    console.log(`[OpenCOOP] Registered ${Object.keys(tools).length} tools`);

    return { tool: tools, dispose };
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    console.log("[OpenCOOP] Fatal error (suppressed):", msg);
    return {};
  }
};

const plugin = {
  id: "opencoop",
  // V1 hook (legacy loader)
  server: v1Server,
  // V2 hook (promise plugin API loader)
  setup: v2Setup,
} as unknown as PluginModule;

export default plugin;
export { OpenCOOPServer } from "./server/mcp-server.js";
export type { ServerConfig } from "./types/index.js";
