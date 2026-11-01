import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { SecurityManager, WRITE_TOOLS, ADMIN_TOOLS, PUBLIC_TUNNEL_HEADER, MEMBER_TOKEN_TTL_DAYS } from "../../src/security/guard.js";
import { initDatabase } from "../../src/utils/database.js";
import type { ServerConfig } from "../../src/types/index.js";
import type { MemberLookupResult } from "../../src/security/guard.js";

/**
 * Security acceptance tests for the v1.15.x hardening (GHSA-8627-5r8q-pp5p).
 *
 * These run against a real express app on a real ephemeral port, not mocks —
 * the bug being guarded against was a wiring mistake (middleware order and
 * binding), which a unit mock would happily hide.
 *
 * The suite is deliberately self-contained: it builds its own SecurityManager
 * with an in-memory member table, so it needs no workspace, database file or
 * network access.
 */

const JWT_SECRET = "test-secret-not-a-real-one";

// The security event log writes to the shared sql.js singleton. In production
// initDatabase() always runs first; here we do the same so the log assertions
// exercise the real path instead of the swallow-on-error fallback.
beforeAll(async () => {
  await initDatabase(":memory:");
});

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    mode: "host",
    port: 0,
    workspacePath: "/tmp/opencoop-test-workspace",
    userName: "Host",
    jwtSecret: JWT_SECRET,
    ...overrides,
  } as ServerConfig;
}

/** In-memory team table — stands in for the SQLite lookup. */
class FakeTeam {
  members = new Map<string, MemberLookupResult>();
  add(userId: string, permissions: string[], name = userId): MemberLookupResult {
    const m: MemberLookupResult = { permissions, name };
    this.members.set(userId, m);
    return m;
  }
  lookup = (userId: string): MemberLookupResult | null => this.members.get(userId) ?? null;
}

interface Harness {
  base: string;
  sec: SecurityManager;
  team: FakeTeam;
  close: () => Promise<void>;
}

/**
 * Build a real server that mirrors how the plugin wires auth:
 *   contextMiddleware -> requireAuth -> (route)
 */
async function harness(opts: {
  config?: Partial<ServerConfig>;
  routes?: (app: Express, sec: SecurityManager) => void;
} = {}): Promise<Harness> {
  const team = new FakeTeam();
  const sec = new SecurityManager({
    config: makeConfig(opts.config),
    tunnelSecret: "tunnel-secret-" + randomUUID(),
    lookupMember: team.lookup,
  });
  const app = express();
  app.use(sec.contextMiddleware);
  app.get("/mcp", sec.requireAuth, (_req, res) => res.json({ ok: true, tool: "mcp" }));
  app.get("/sse", sec.requireAuth, (_req, res) => res.json({ ok: true, tool: "sse" }));
  app.get("/ui/api/status", (_req, res) => res.json({ ok: true, tool: "status" }));
  app.get("/ui/api/me", sec.requireAuth, (req, res) =>
    res.json({ identity: sec.getIdentity(req) })
  );
  app.post(
    "/ui/api/config",
    sec.requireAuth,
    sec.requirePermission("admin"),
    sec.csrfGuard,
    (_req, res) => res.json({ ok: true })
  );
  app.post(
    "/ui/api/write-thing",
    sec.requireAuth,
    sec.csrfGuard,
    (_req, res) => res.json({ ok: true })
  );
  if (opts.routes) opts.routes(app, sec);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    sec,
    team,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** GET with a custom Host header (fetch forbids overriding Host, so use http). */
function rawRequest(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Security: unauthenticated transport (GHSA-8627-5r8q-pp5p)", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  // ---- Loopback is the trusted path -------------------------------------

  it("allows loopback without a token (local OpenCode instance)", async () => {
    const res = await fetch(`${h.base}/mcp`);
    expect(res.status).toBe(200);
  });

  it("reports local identity with full permissions for loopback", async () => {
    const res = await fetch(`${h.base}/ui/api/me`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.identity.type).toBe("local");
    expect(body.identity.permissions).toContain("admin");
  });

  it("does not require a token on public endpoints that are read-only", async () => {
    const res = await fetch(`${h.base}/ui/api/status`);
    expect(res.status).toBe(200);
  });

  // ---- Tunnel traffic can never masquerade as local ----------------------

  it("rejects tunnel traffic without a token even though it arrives from 127.0.0.1", async () => {
    const res = await fetch(`${h.base}/mcp`, {
      headers: { [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret() },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a forged tunnel stamp (wrong secret) and still treats it as local", async () => {
    const res = await fetch(`${h.base}/mcp`, {
      headers: { [PUBLIC_TUNNEL_HEADER]: "not-the-secret" },
    });
    // A wrong stamp is not a tunnel request, so loopback trust applies.
    // The point of the test: guessing the stamp does not gain access to the
    // remote path, and the real stamp does not gain local trust.
    expect(res.status).toBe(200);
  });

  it("accepts tunnel traffic that carries a valid admin token", async () => {
    const res = await fetch(`${h.base}/mcp`, {
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${h.sec.getAdminToken()}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid token on the tunnel path", async () => {
    const res = await fetch(`${h.base}/sse`, {
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: "Bearer totally-invalid",
      },
    });
    expect(res.status).toBe(401);
  });

  // ---- Admin token ------------------------------------------------------

  it("derives a stable admin token from jwtSecret (multi-instance agreement)", () => {
    const a = new SecurityManager({
      config: makeConfig(),
      tunnelSecret: "t1",
      lookupMember: () => null,
    });
    const b = new SecurityManager({
      config: makeConfig(),
      tunnelSecret: "t2",
      lookupMember: () => null,
    });
    expect(a.getAdminToken()).toBe(b.getAdminToken());
    expect(a.getAdminToken()).not.toBe(b.getAdminToken() + "x");
  });

  it("derives a different admin token for a different jwtSecret", () => {
    const a = new SecurityManager({
      config: makeConfig({ jwtSecret: "one" }),
      tunnelSecret: "t",
      lookupMember: () => null,
    });
    const b = new SecurityManager({
      config: makeConfig({ jwtSecret: "two" }),
      tunnelSecret: "t",
      lookupMember: () => null,
    });
    expect(a.getAdminToken()).not.toBe(b.getAdminToken());
  });

  it("issues a 64-char hex admin token", () => {
    expect(h.sec.getAdminToken()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Security: member tokens and revocation", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  it("accepts a member token minted by the host", async () => {
    h.team.add("u1", ["read"], "Alice");
    const token = h.sec.issueMemberToken({
      userId: "u1",
      name: "Alice",
      permissions: ["read"],
      workspaceId: h.sec["config"].workspacePath,
    });
    const res = await fetch(`${h.base}/ui/api/me`, {
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity.type).toBe("member");
    expect(body.identity.userId).toBe("u1");
    expect(body.identity.userName).toBe("Alice");
  });

  it("revokes instantly: a valid token for a deleted member is rejected", async () => {
    h.team.add("u1", ["read"], "Alice");
    const token = h.sec.issueMemberToken({
      userId: "u1",
      name: "Alice",
      permissions: ["read"],
      workspaceId: h.sec["config"].workspacePath,
    });
    const headers = {
      [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
      Authorization: `Bearer ${token}`,
    };
    expect((await fetch(`${h.base}/ui/api/me`, { headers })).status).toBe(200);
    h.team.members.delete("u1"); // simulated revoke_access
    expect((await fetch(`${h.base}/ui/api/me`, { headers })).status).toBe(401);
  });

  it("rejects a token minted for a different workspace", async () => {
    h.team.add("u1", ["read"], "Alice");
    const token = h.sec.issueMemberToken({
      userId: "u1",
      name: "Alice",
      permissions: ["read"],
      workspaceId: "/some/other/project",
    });
    const res = await fetch(`${h.base}/mcp`, {
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    h.team.add("u1", ["read"], "Alice");
    const other = new SecurityManager({
      config: makeConfig({ jwtSecret: "different-secret" }),
      tunnelSecret: "x",
      lookupMember: h.team.lookup,
    });
    const token = other.issueMemberToken({
      userId: "u1",
      name: "Alice",
      permissions: ["read"],
      workspaceId: h.sec["config"].workspacePath,
    });
    const res = await fetch(`${h.base}/mcp`, {
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(401);
  });

  it("uses permissions from the database, not the token (live permission changes)", async () => {
    h.team.add("u1", ["read"], "Alice");
    const token = h.sec.issueMemberToken({
      userId: "u1",
      name: "Alice",
      permissions: ["read", "admin"], // stale claim in the token
      workspaceId: h.sec["config"].workspacePath,
    });
    const res = await fetch(`${h.base}/ui/api/config`, {
      method: "POST",
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${token}`,
        "x-opencoop-client": "web",
      },
    });
    expect(res.status).toBe(403); // DB says read-only
  });

  it("member tokens expire in 30 days", () => {
    expect(MEMBER_TOKEN_TTL_DAYS).toBe(30);
  });
});

describe("Security: per-tool permissions", () => {
  let sec: SecurityManager;

  beforeEach(() => {
    sec = new SecurityManager({
      config: makeConfig(),
      tunnelSecret: "t",
      lookupMember: () => null,
    });
  });

  it("classifies every mutating tool as a write tool", () => {
    for (const t of ["write_file", "edit_file", "rollback_file", "lock_file", "unlock_file"]) {
      expect(WRITE_TOOLS.has(t)).toBe(true);
    }
  });

  it("classifies team management as admin tools", () => {
    expect(ADMIN_TOOLS.has("invite_member")).toBe(true);
    expect(ADMIN_TOOLS.has("revoke_access")).toBe(true);
  });

  it("does not classify read tools as write tools", () => {
    for (const t of ["read_file", "list_files", "grep_content", "list_locks"]) {
      expect(WRITE_TOOLS.has(t)).toBe(false);
    }
  });

  it("allows in-process host execution (undefined identity) unrestricted", () => {
    expect(sec.toolPermissionDenied("write_file", undefined)).toBeNull();
    expect(sec.toolPermissionDenied("revoke_access", undefined)).toBeNull();
  });

  it("denies an unauthenticated caller every tool", () => {
    expect(sec.toolPermissionDenied("read_file", null)).toContain("authentication required");
    expect(sec.toolPermissionDenied("write_file", null)).toContain("authentication required");
  });

  it("denies writes to a read-only member", () => {
    const identity = { type: "member" as const, userId: "u1", userName: "A", permissions: ["read"] };
    expect(sec.toolPermissionDenied("read_file", identity)).toBeNull();
    expect(sec.toolPermissionDenied("write_file", identity)).toContain("write permission");
    expect(sec.toolPermissionDenied("edit_file", identity)).toContain("write permission");
  });

  it("denies admin tools to a writer", () => {
    const identity = { type: "member" as const, userId: "u1", userName: "A", permissions: ["read", "write"] };
    expect(sec.toolPermissionDenied("invite_member", identity)).toContain("admin permission");
    expect(sec.toolPermissionDenied("revoke_access", identity)).toContain("admin permission");
  });

  it("lets admin do everything", () => {
    const identity = { type: "admin" as const, userId: "a", userName: "A", permissions: ["read", "write", "admin"] };
    for (const t of ["read_file", "write_file", "rollback_file", "invite_member", "revoke_access"]) {
      expect(sec.toolPermissionDenied(t, identity)).toBeNull();
    }
  });

  it("treats admin as implying read and write", () => {
    const adminOnly = { type: "admin" as const, userId: "a", userName: "A", permissions: ["admin"] };
    expect(sec.hasPermission(adminOnly, "read")).toBe(true);
    expect(sec.hasPermission(adminOnly, "write")).toBe(true);
  });

  it("gives a null identity no permission at all", () => {
    expect(sec.hasPermission(null, "read")).toBe(false);
  });
});

describe("Security: CSRF guard", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  it("rejects a browser mutation without the x-opencoop-client header", async () => {
    const res = await fetch(`${h.base}/ui/api/write-thing`, {
      method: "POST",
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${h.sec.getAdminToken()}`,
      },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF_GUARD");
  });

  it("accepts the mutation with the header", async () => {
    const res = await fetch(`${h.base}/ui/api/write-thing`, {
      method: "POST",
      headers: {
        [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret(),
        Authorization: `Bearer ${h.sec.getAdminToken()}`,
        "x-opencoop-client": "web",
      },
    });
    expect(res.status).toBe(200);
  });

  it("does not apply the CSRF guard to GET", async () => {
    const res = await fetch(`${h.base}/mcp`);
    expect(res.status).toBe(200);
  });
});

describe("Security: Host header allowlist (DNS rebinding)", () => {
  it("allows localhost, private ranges and the tunnel domain", () => {
    const sec = new SecurityManager({ config: makeConfig(), tunnelSecret: "t", lookupMember: () => null });
    const host = (h: string) => sec.isAllowedHostHeader({ headers: { host: h } } as never);
    expect(host("localhost:31313")).toBe(true);
    expect(host("127.0.0.1:31313")).toBe(true);
    expect(host("192.168.1.5:31313")).toBe(true);
    expect(host("10.0.0.7")).toBe(true);
    expect(host("172.16.0.9")).toBe(true);
    expect(host("abc.tinyfi.sh")).toBe(true);
  });

  it("rejects an unrelated public hostname", () => {
    const sec = new SecurityManager({ config: makeConfig(), tunnelSecret: "t", lookupMember: () => null });
    const host = (h: string) => sec.isAllowedHostHeader({ headers: { host: h } } as never);
    expect(host("evil.example.com")).toBe(false);
    expect(host("attacker.test")).toBe(false);
  });

  it("allows an explicitly configured extra host", () => {
    const sec = new SecurityManager({
      config: makeConfig(),
      tunnelSecret: "t",
      lookupMember: () => null,
      extraAllowedHosts: ["myboxes.example.org"],
    });
    expect(
      sec.isAllowedHostHeader({ headers: { host: "myboxes.example.org" } } as never)
    ).toBe(true);
  });

  it("answers 403 with an unknown Host header", async () => {
    const h = await harness();
    const port = Number(new URL(h.base).port);
    const res = await rawRequest(port, "/mcp", { host: "evil.example.com" });
    expect(res.status).toBe(403);
    await h.close();
  });

  it("still answers 200 with a normal Host header", async () => {
    const h = await harness();
    const port = Number(new URL(h.base).port);
    const res = await rawRequest(port, "/mcp", { host: `localhost:${port}` });
    expect(res.status).toBe(200);
    await h.close();
  });
});

describe("Security: CORS", () => {
  let sec: SecurityManager;

  beforeEach(() => {
    sec = new SecurityManager({ config: makeConfig(), tunnelSecret: "t", lookupMember: () => null });
  });

  it("echoes a same-origin request", () => {
    expect(sec.corsOrigin("http://localhost:31313", "localhost:31313")).toBe("http://localhost:31313");
  });

  it("refuses an unrelated origin", () => {
    expect(sec.corsOrigin("https://evil.example.com", "localhost:31313")).toBe(false);
  });

  it("allows requests with no Origin (non-browser clients)", () => {
    expect(sec.corsOrigin(undefined, "localhost:31313")).toBe(true);
  });

  it("refuses a malformed origin", () => {
    expect(sec.corsOrigin("not a url", "localhost:31313")).toBe(false);
  });
});

describe("Security: rate limiting", () => {
  let sec: SecurityManager;

  beforeEach(() => {
    sec = new SecurityManager({ config: makeConfig(), tunnelSecret: "t", lookupMember: () => null });
  });

  it("allows up to the limit then blocks", () => {
    const key = "test-key";
    for (let i = 0; i < 5; i++) expect(sec.checkRate(key, 5)).toBe(true);
    expect(sec.checkRate(key, 5)).toBe(false);
  });

  it("keeps separate buckets per key", () => {
    for (let i = 0; i < 3; i++) sec.checkRate("a", 3);
    expect(sec.checkRate("a", 3)).toBe(false);
    expect(sec.checkRate("b", 3)).toBe(true);
  });

  it("decays over the window", async () => {
    const key = "decay";
    expect(sec.checkRate(key, 1, 50)).toBe(true);
    expect(sec.checkRate(key, 1, 50)).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(sec.checkRate(key, 1, 50)).toBe(true);
  });

  it("counts auth failures per IP for the 401 path", () => {
    const req = { headers: {}, ip: "203.0.113.9", socket: {} } as never;
    expect(sec.authFailureCount(req)).toBe(0);
    sec.rateLimitAuthFailure(req);
    expect(sec.authFailureCount(req)).toBe(1);
  });
});

describe("Security: headers and identity plumbing", () => {
  it("sets the anti-sniffing / anti-framing headers", async () => {
    const h = await harness({
      routes: (app, sec) => {
        app.use(sec.securityHeaders);
        app.get("/h", (_req, res) => res.json({ ok: true }));
      },
    });
    const port = Number(new URL(h.base).port);
    const status = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/h", method: "GET" },
          (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers }));
          }
        );
        req.on("error", reject);
        req.end();
      }
    );
    expect(status.status).toBe(200);
    expect(status.headers["x-content-type-options"]).toBe("nosniff");
    expect(status.headers["x-frame-options"]).toBe("DENY");
    expect(status.headers["referrer-policy"]).toBe("no-referrer");
    await h.close();
  });

  it("exposes the identity inside the async context during a request", async () => {
    const h = await harness({
      routes: (app, sec) => {
        app.get("/ctx", (req, res) => {
          res.json({
            fromRequest: sec.getIdentity(req)?.type ?? null,
            fromContext: sec.getContextIdentity()?.type ?? null,
          });
        });
      },
    });
    const body = await (await fetch(`${h.base}/ctx`)).json();
    expect(body.fromRequest).toBe("local");
    expect(body.fromContext).toBe("local");
    await h.close();
  });

  it("returns null identity for an unauthenticated tunnel request", async () => {
    const h = await harness({
      routes: (app, sec) => {
        app.get("/ctx", (_req, res) => res.json({ identity: sec.getContextIdentity() }));
      },
    });
    const body = await (
      await fetch(`${h.base}/ctx`, { headers: { [PUBLIC_TUNNEL_HEADER]: h.sec.getTunnelSecret() } })
    ).json();
    expect(body.identity).toBeNull();
    await h.close();
  });

  it("records a security event for a rejected Host header", async () => {
    const h = await harness();
    const port = Number(new URL(h.base).port);
    await rawRequest(port, "/mcp", { host: "evil.example.com" });
    const events = h.sec.getRecentEvents(50);
    expect(events.some((e) => e.event === "host_header_rejected")).toBe(true);
    await h.close();
  });

  it("records a security event for a missing token", async () => {
    const h = await harness();
    await fetch(`${h.base}/ui/api/config`, { method: "POST" });
    const events = h.sec.getRecentEvents(50);
    expect(events.some((e) => e.event === "auth_required")).toBe(true);
    await h.close();
  });
});
