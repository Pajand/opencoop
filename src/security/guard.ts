import crypto from "crypto";
import os from "os";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "async_hooks";
import { AuthIdentity, ServerConfig } from "../types/index.js";
import { runQuery, getAllRows } from "../utils/database.js";
import { logger } from "../utils/logger.js";

/**
 * Central security guard (v1.15.0).
 *
 * Threat model
 * ------------
 * The HOST server may be exposed to the internet through a public tunnel
 * (and optionally on the LAN). The SSH tunnel forwards connections from
 * 127.0.0.1, so the server CANNOT trust an IP by itself — public traffic
 * looks local. Therefore:
 *
 *   - Traffic that arrives through the tunnel carries a per-process secret
 *     header stamped by our TunnelProxy (the only listener the tunnel can
 *     reach). Only the tunnel-facing proxy adds it.
 *   - Loopback traffic WITHOUT the tunnel stamp is the machine's own user
 *     (their OpenCode MCP client / browser): trusted as "local" admin.
 *   - Everything else (tunnel or LAN) MUST present a token:
 *       · the admin token (host's own secret), or
 *       · a member JWT issued by redeeming an invite link.
 *     Member permissions are re-read from the DB on every request, so
 *     revoking a member takes effect instantly.
 *
 * Additional protections:
 *   - Host header allowlist (anti DNS-rebinding)
 *   - Strict CORS (blocks malicious websites calling the local API)
 *   - Custom-header requirement for browser mutations (anti CSRF)
 *   - Rate limiting on token failures / invite redemption
 *   - Restrictive security headers
 */

export const MEMBER_TOKEN_TTL_DAYS = 30;
export const PUBLIC_TUNNEL_HEADER = "x-opencoop-tunnel";

/** Tools that mutate the workspace (need "write"). */
export const WRITE_TOOLS = new Set<string>([
  "write_file",
  "edit_file",
  "rollback_file",
  "lock_file",
  "unlock_file",
]);

/** Tools that manage the team (need "admin"). */
export const ADMIN_TOOLS = new Set<string>([
  "invite_member",
  "revoke_access",
]);

export const ALL_TOOLS_PERM: Record<string, string[]> = {};

export interface MemberLookupResult {
  permissions: string[];
  email?: string;
  name?: string;
}

export interface SecurityEvent {
  ts: string;
  ip: string;
  event: string;
  detail: string;
  path: string;
}

export interface SecurityOptions {
  config: ServerConfig;
  /** Per-process secret shared with TunnelProxy. */
  tunnelSecret: string;
  /** Fresh member lookup (revocation-safe). */
  lookupMember: (userId: string) => MemberLookupResult | null;
  /** Extra allowed Host header hostnames (e.g. configured hostUrl). */
  extraAllowedHosts?: string[];
}

const tokenStorage = new AsyncLocalStorage<AuthIdentity | null>();

interface DecodedMember {
  typ?: string;
  uid?: string;
  name?: string;
  email?: string;
  perms?: string[];
  ws?: string;
}

function clientIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined) || "";
  const first = xff.split(",")[0]?.trim();
  const raw = first || req.ip || req.socket?.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");
}

function isLoopbackIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function isPrivateHostname(host: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return false;
}

export class SecurityManager {
  private config: ServerConfig;
  private tunnelSecret: string;
  private lookupMember: (userId: string) => MemberLookupResult | null;
  private extraAllowedHosts: Set<string>;
  private localInterfaceIps: Set<string>;
  private rateBuckets = new Map<string, number[]>();
  private revokedTokenIds = new Set<string>();

  constructor(opts: SecurityOptions) {
    this.config = opts.config;
    this.tunnelSecret = opts.tunnelSecret;
    this.lookupMember = opts.lookupMember;
    this.extraAllowedHosts = new Set(
      (opts.extraAllowedHosts || []).map((h) => h.toLowerCase())
    );

    // The machine's own interface addresses are legitimate Host values
    // (direct IP access). Public IPs on interfaces are included so VPS
    // deployments work; auth is still required for non-loopback callers.
    this.localInterfaceIps = new Set();
    try {
      for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces || []) {
          if (iface.address) this.localInterfaceIps.add(iface.address.toLowerCase());
        }
      }
    } catch {
      // Best effort.
    }

    if (!this.config.adminToken) {
      // DETERMINISTIC derivation: OpenCode creates several plugin instances
      // (one per workspace) in parallel; a random token would race and the
      // config could end up holding a different value than the running
      // server. Deriving it from the (stable, on-disk) jwtSecret means every
      // instance computes the SAME token.
      this.config.adminToken = this.deriveAdminToken();
    }

    this.initSecurityTables();
  }

  private deriveAdminToken(): string {
    return crypto
      .createHash("sha256")
      .update(`opencoop-admin-v1:${this.config.jwtSecret}:${this.config.workspacePath}`)
      .digest("hex");
  }

  // ==================== Tokens ====================

  getAdminToken(): string {
    return this.config.adminToken!;
  }

  getTunnelSecret(): string {
    return this.tunnelSecret;
  }

  issueMemberToken(claims: {
    userId: string;
    name: string;
    email?: string;
    permissions: string[];
    workspaceId: string;
  }): string {
    return jwt.sign(
      {
        typ: "member",
        uid: claims.userId,
        name: claims.name,
        email: claims.email,
        perms: claims.permissions,
        ws: claims.workspaceId,
      },
      this.config.jwtSecret,
      { expiresIn: `${MEMBER_TOKEN_TTL_DAYS}d` }
    );
  }

  private safeEqual(a: string, b: string): boolean {
    try {
      const ab = Buffer.from(a);
      const bb = Buffer.from(b);
      if (ab.length !== bb.length) return false;
      return crypto.timingSafeEqual(ab, bb);
    } catch {
      return false;
    }
  }

  private isAdminToken(token: string): boolean {
    const admin = this.config.adminToken;
    return !!admin && !!token && this.safeEqual(token, admin);
  }

  private verifyMemberToken(token: string): DecodedMember | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as DecodedMember;
      if (!decoded || decoded.typ !== "member" || !decoded.uid) return null;
      if (decoded.ws !== this.config.workspacePath) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  // ==================== Identity resolution ====================

  /** Extract a bearer token from Authorization header or ?token= query. */
  extractToken(req: Request): string | null {
    const auth = req.headers["authorization"] as string | undefined;
    if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
    const q = req.query?.token;
    if (typeof q === "string" && q) return q;
    return null;
  }

  /** True when the request arrived through our tunnel proxy (unspoofable secret). */
  isTunnelRequest(req: Request): boolean {
    const stamp = req.headers[PUBLIC_TUNNEL_HEADER] as string | undefined;
    return !!stamp && this.safeEqual(stamp, this.tunnelSecret);
  }

  isLocalRequest(req: Request): boolean {
    return isLoopbackIp(clientIp(req)) && !this.isTunnelRequest(req);
  }

  isAllowedHostHeader(req: Request): boolean {
    const host = (req.headers.host || "").trim();
    if (!host) return true; // Non-browser clients (HTTP/1.0) — edge forwards a Host anyway.
    let hostname = host;
    try {
      hostname = new URL(`http://${host}`).hostname.toLowerCase();
    } catch {
      hostname = host.replace(/:\d+$/, "").toLowerCase();
    }
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
    if (hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true;
    if (hostname.endsWith(".tinyfi.sh")) return true;
    if (isPrivateHostname(hostname)) return true;
    if (this.localInterfaceIps.has(hostname)) return true;
    if (this.extraAllowedHosts.has(hostname)) return true;
    return false;
  }

  /**
   * Resolve the caller's identity. Returns null when the request is neither
   * local nor accompanied by a valid token.
   */
  resolveIdentity(req: Request): AuthIdentity | null {
    if (this.isLocalRequest(req)) {
      return {
        type: "local",
        userId: "local-host",
        userName: this.config.userName || "Host",
        permissions: ["read", "write", "admin"],
      };
    }

    const token = this.extractToken(req);
    if (!token) return null;

    if (this.isAdminToken(token)) {
      return {
        type: "admin",
        userId: "admin-token",
        userName: this.config.userName || "Admin",
        permissions: ["read", "write", "admin"],
      };
    }

    const decoded = this.verifyMemberToken(token);
    if (!decoded) return null;

    // Revocation-safe: verify the member still exists in the team right now.
    const member = this.lookupMember(decoded.uid!);
    if (!member) return null;

    return {
      type: "member",
      userId: decoded.uid!,
      userName: member.name || decoded.name || "member",
      permissions: member.permissions.length > 0 ? member.permissions : decoded.perms || [],
    };
  }

  hasPermission(identity: AuthIdentity | null | undefined, permission: string): boolean {
    if (!identity) return false;
    if (identity.permissions.includes("admin")) return true;
    return identity.permissions.includes(permission);
  }

  toolPermissionDenied(toolName: string, identity: AuthIdentity | null | undefined): string | null {
    // No HTTP context = in-process host execution (trusted).
    if (identity === undefined) return null;
    if (identity === null) {
      return "Access denied: authentication required. Connect with an invite link (see opencoop_guide).";
    }
    if (ADMIN_TOOLS.has(toolName) && !identity.permissions.includes("admin")) {
      return `Access denied: '${toolName}' requires admin permission. Ask the host to issue an admin invite.`;
    }
    if (WRITE_TOOLS.has(toolName) && !this.hasPermission(identity, "write")) {
      return `Access denied: '${toolName}' requires write permission. You have read-only access.`;
    }
    return null;
  }

  // ==================== Async context for tool enforcement ====================

  runWithIdentity<T>(identity: AuthIdentity | null, fn: () => T): T {
    return tokenStorage.run(identity, fn);
  }

  getContextIdentity(): AuthIdentity | null | undefined {
    return tokenStorage.getStore();
  }

  // ==================== Express middleware ====================

  /** Sets req.identity + async context for ALL requests. Never blocks. */
  contextMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
    if (!this.isAllowedHostHeader(req)) {
      this.logEvent(clientIp(req), "host_header_rejected", req.headers.host || "", req.originalUrl);
      _res.status(403).json({ error: "Forbidden: unknown Host header" });
      return;
    }
    const identity = this.resolveIdentity(req);
    (req as any).identity = identity;
    tokenStorage.run(identity, () => next());
  };

  /** Requires a valid identity (local/admin/member). */
  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const identity = (req as any).identity as AuthIdentity | null;
    if (!identity) {
      this.rateLimitAuthFailure(req);
      this.logEvent(clientIp(req), "auth_required", req.method, req.originalUrl);
      res.status(401).json({
        error: "Unauthorized: connect with an invite link (or valid token)",
        code: "AUTH_REQUIRED",
      });
      return;
    }
    next();
  };

  /** Requires a specific permission ("read" | "write" | "admin"). */
  requirePermission = (permission: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      const identity = (req as any).identity as AuthIdentity | null;
      if (!identity) {
        this.rateLimitAuthFailure(req);
        res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
        return;
      }
      if (!this.hasPermission(identity, permission)) {
        this.logEvent(clientIp(req), "permission_denied", permission, req.originalUrl);
        res.status(403).json({
          error: `Forbidden: '${permission}' permission required`,
          code: "PERMISSION_DENIED",
        });
        return;
      }
      next();
    };
  };

  getIdentity(req: Request): AuthIdentity | null {
    return ((req as any).identity as AuthIdentity | null) || null;
  }

  // ==================== CORS / CSRF ====================

  corsOrigin(origin: string | undefined, reqHost: string | undefined): string | boolean {
    if (!origin) return true; // Non-browser client — no CORS headers needed.
    try {
      const o = new URL(origin);
      const oh = o.hostname.toLowerCase();
      if (oh === "localhost" || oh === "127.0.0.1" || oh === "::1") return origin;
      if (oh.endsWith(".localhost")) return origin;
      if (reqHost) {
        let rh = reqHost;
        try {
          rh = new URL(`http://${reqHost}`).hostname.toLowerCase();
        } catch {
          rh = reqHost.replace(/:\d+$/, "").toLowerCase();
        }
        if (oh === rh) return origin;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Anti-CSRF for browser mutations: a custom header cannot be sent
   * cross-origin without a CORS preflight (which we deny for evil origins).
   */
  csrfGuard = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const header = req.headers["x-opencoop-client"];
    if (header !== "web") {
      res.status(403).json({
        error: "Forbidden: missing x-opencoop-client header (CSRF protection)",
        code: "CSRF_GUARD",
      });
      return;
    }
    next();
  };

  securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "interest-cohort=()");
    next();
  };

  // ==================== Rate limiting ====================

  /** Returns true when allowed. */
  checkRate(key: string, max: number, windowMs = 60_000): boolean {
    const now = Date.now();
    const arr = (this.rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      this.rateBuckets.set(key, arr);
      return false;
    }
    arr.push(now);
    this.rateBuckets.set(key, arr);
    if (this.rateBuckets.size > 5000) {
      // Bound memory: drop oldest half arbitrarily.
      const keys = Array.from(this.rateBuckets.keys()).slice(0, 2500);
      for (const k of keys) this.rateBuckets.delete(k);
    }
    return true;
  }

  rateLimitAuthFailure(req: Request): void {
    const key = `authfail:${clientIp(req)}`;
    this.checkRate(key, 30);
  }

  authFailureCount(req: Request): number {
    const key = `authfail:${clientIp(req)}`;
    const now = Date.now();
    return (this.rateBuckets.get(key) || []).filter((t) => now - t < 60_000).length;
  }

  // ==================== Security event log ====================

  private initSecurityTables(): void {
    try {
      runQuery(`
        CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT DEFAULT (datetime('now')),
          ip TEXT,
          event TEXT,
          detail TEXT,
          path TEXT
        )
      `);
    } catch (err) {
      logger.warn(`security_events init failed: ${(err as Error).message}`);
    }
  }

  logEvent(ip: string, event: string, detail: string, path: string): void {
    try {
      runQuery(
        `INSERT INTO security_events (ip, event, detail, path) VALUES (?, ?, ?, ?)`,
        [ip, event, String(detail).slice(0, 300), String(path).slice(0, 300)]
      );
      runQuery(
        `DELETE FROM security_events WHERE id NOT IN (
           SELECT id FROM security_events ORDER BY id DESC LIMIT 500
         )`
      );
    } catch {
      // Logging must never break the request path.
    }
  }

  getRecentEvents(limit = 100): SecurityEvent[] {
    try {
      return getAllRows<SecurityEvent>(
        `SELECT ts, ip, event, detail, path FROM security_events ORDER BY id DESC LIMIT ${Math.min(limit, 500)}`
      );
    } catch {
      return [];
    }
  }
}

/** Find a free loopback port for the tunnel edge proxy. */
export async function findFreePort(start: number): Promise<number> {
  const net = await import("net");
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, attempts: number) => {
      if (attempts > 50) return reject(new Error("No free port found"));
      const srv = net.createServer();
      srv.once("error", () => tryPort(port + 1, attempts + 1));
      srv.once("listening", () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, "127.0.0.1");
    };
    tryPort(start, 0);
  });
}
