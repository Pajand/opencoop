import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../utils/config.js";

const CONNECT_TIMEOUT_MS = 30000;
const CALL_TIMEOUT_MS = 120000;

/**
 * REMOTE-mode proxy.
 *
 * When this server runs in REMOTE mode (mode === "remote" + hostUrl set),
 * every tool call is forwarded to the HOST server over its tunnel URL.
 * The local opencode.json MCP url NEVER changes (always localhost) so no
 * OpenCode restart is ever needed — Connect in the UI takes effect instantly.
 *
 * In HOST mode (or when unconfigured) proxyForward() returns null and the
 * caller must run the original local handler untouched.
 */

let proxyClient: Client | null = null;
let proxyUrl: string | null = null;
let connecting: { target: string; promise: Promise<Client> } | null = null;

export async function getProxyTarget(): Promise<string | null> {
  try {
    // Read fresh from disk every time: the web UI saves here, and every
    // plugin instance (even ones that didn't serve the UI) sees it instantly.
    const cfg = await loadConfig();
    if (cfg.mode === "remote" && cfg.hostUrl) return cfg.hostUrl.replace(/\/+$/, "");
    return null;
  } catch {
    return null;
  }
}

export async function closeProxy(): Promise<void> {
  connecting = null;
  const c = proxyClient;
  proxyClient = null;
  proxyUrl = null;
  if (c) {
    try {
      await c.close();
    } catch {
      // Ignore close errors
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function getClient(target: string): Promise<Client> {
  if (proxyClient && proxyUrl === target) return proxyClient;
  if (connecting && connecting.target === target) return connecting.promise;

  // New (or changed) target: drop everything and reconnect.
  await closeProxy();

  let clientRef: Client | null = null;
  const promise = (async () => {
    const client = new Client({ name: "opencoop-remote-proxy", version: "1.0.0" }, { capabilities: {} });
    clientRef = client;
    // NOTE: Streamable HTTP (not SSE) — plain request/response JSON survives
    // Cloudflare tunnels, while long-lived SSE streams stall (headers arrive,
    // body chunks never do). Our /mcp endpoint is stateless (no session id).
    await client.connect(new StreamableHTTPClientTransport(new URL(`${target}/mcp`)));
    return client;
  })();
  connecting = { target, promise };

  try {
    proxyClient = await promise;
    proxyUrl = target;
    return proxyClient;
  } catch (err) {
    // Never cache failed connections; best-effort cleanup of half-open state.
    if (clientRef) {
      try {
        await (clientRef as Client).close();
      } catch {}
    }
    proxyClient = null;
    proxyUrl = null;
    throw err;
  } finally {
    if (connecting && connecting.promise === promise) connecting = null;
  }
}

/** JSON-RPC-level errors mean the connection is healthy (keep it). Anything else => reconnect next time. */
function isRpcError(err: any): boolean {
  return !!err && typeof err.code === "number";
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Translate low-level failures into actionable guidance for the AI/user.
 * The two common cases:
 *  - Cloudflare 1033/530: tunnel edge answers but the host's OpenCOOP
 *    server behind it is DOWN (closed browser, old version, stale link).
 *  - DNS/fetch failure: the tunnel hostname is gone = stale invite link.
 */
function hostAdvice(target: string, detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("1033") || d.includes(" 530") || d.includes("tunnel error")) {
    return (
      `Error: host tunnel is reachable but the server behind it is DOWN (Cloudflare tunnel error). ` +
      `On the HOST machine: 1) install latest plugin (npm i -g @opencoop/opencode-plugin@latest) and clear the plugin cache, ` +
      `2) fully restart OpenCode, 3) open the web UI and select HOST mode (green tunnel badge must appear), ` +
      `4) Generate a FRESH invite link (tunnel URLs expire on restart) and Connect again here. Detail: ${detail}`
    );
  }
  if (d.includes("fetch failed") || d.includes("enotfound") || d.includes("eai_again") || d.includes("getaddrinfo") || d.includes("econnrefused")) {
    return (
      `Error: cannot reach host at ${target} (tunnel address is gone). ` +
      `The invite link is STALE — Generate a FRESH invite link on the HOST machine and Connect again here. Detail: ${detail}`
    );
  }
  return `Error: host tool call failed (${target}): ${detail}`;
}

/**
 * Forward one tool call to the host. Returns the result text, or null when
 * this server is NOT in REMOTE mode (caller runs its local handler).
 * Never throws: failures come back as "Error: ..." text so the AI sees them.
 *
 * ownPort: this server's own HTTP port. A server must never proxy to itself
 * (e.g. disk config points back at localhost:ownPort) — in that case serve
 * locally instead of ping-ponging until timeout.
 */
export async function proxyForward(toolName: string, args: any, ownPort?: number): Promise<string | null> {
  const target = await getProxyTarget();
  if (!target) return null;

  if (ownPort) {
    try {
      const u = new URL(target);
      const isLoopback = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && Number(u.port) === ownPort;
      if (isLoopback) return null;
    } catch {
      // Unparseable target: let the connection attempt below report the error.
    }
  }

  let client: Client;
  try {
    client = await withTimeout(getClient(target), CONNECT_TIMEOUT_MS, "Host connection");
  } catch (err) {
    return hostAdvice(target, errMsg(err));
  }

  try {
    const result: any = await withTimeout(
      client.callTool({ name: toolName, arguments: (args ?? {}) as Record<string, unknown> }),
      CALL_TIMEOUT_MS,
      `Host tool '${toolName}'`
    );
    const content = (result && result.content ? result.content : []) as Array<{ type?: string; text?: string }>;
    const texts = content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);
    if (texts.length > 0) return texts.join("\n");
    return JSON.stringify(result);
  } catch (err) {
    if (!isRpcError(err)) await closeProxy();
    return hostAdvice(target, `host tool '${toolName}' failed: ${errMsg(err)}`);
  }
}
