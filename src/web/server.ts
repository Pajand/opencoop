import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ServerConfig } from "../types/index.js";
import { saveConfig, normalizeHostUrl } from "../utils/config.js";
import { AuthManager } from "../auth/auth-manager.js";
import { ChangeTracker } from "../filesystem/change-tracker.js";
import { SessionManager } from "../auth/session-manager.js";
import { LockManager } from "../filesystem/lock-manager.js";
import { initDatabase, getAllRows, getRow } from "../utils/database.js";
import { buildGuideText } from "../utils/guide.js";
import {
  getProjectId,
  getProjectMembers,
  getSnapshotsDiskUsage,
  recordProjectMember,
} from "../filesystem/project-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In-memory map: IP -> { userName, lastSeen }
// Tracks remote users who connected via the web UI.
// Used to attribute MCP tool changes to the correct user.
const userSessions = new Map<string, { userName: string; lastSeen: number }>();

export function getActiveUserName(clientIp: string | undefined): string | undefined {
  if (!clientIp) return undefined;
  const ip = clientIp.replace(/^::ffff:/, "");
  const session = userSessions.get(ip);
  return session?.userName;
}

export async function createWebUI(
  config: ServerConfig,
  getTunnelUrl?: () => string | null,
  ensureTunnel?: () => Promise<string | null>
): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  const authManager = new AuthManager(config.jwtSecret);
  const changeTracker = new ChangeTracker();
  const sessionManager = new SessionManager();
  const lockManager = new LockManager();

  // ==================== USER SESSION TRACKING ====================
  // When a remote user sets their display name, register their IP.
  // This allows MCP tools to attribute changes to the correct user.
  app.post("/api/user/register", (req, res) => {
    try {
      const { userName } = req.body;
      if (!userName) return res.status(400).json({ error: "userName required" });
      const rawIp = req.ip || req.socket.remoteAddress || "unknown";
      const ip = rawIp.replace(/^::ffff:/, "");
      userSessions.set(ip, { userName, lastSeen: Date.now() });
      // Persist as a known project contributor (survives restart).
      recordProjectMember(config.workspacePath, userName);
      res.json({ success: true, ip });
    } catch {
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  app.get("/api/user/sessions", (_req, res) => {
    const sessions = Array.from(userSessions.entries()).map(([ip, data]) => ({
      ip,
      ...data,
    }));
    res.json({ sessions });
  });

  // ==================== CONFIG API ====================
  app.get("/api/config", (req, res) => {
    res.json({
      mode: config.mode,
      workspacePath: config.workspacePath,
      hostUrl: config.hostUrl,
      port: config.port,
      userName: config.userName || "",
    });
  });

  app.post("/api/config", async (req, res) => {
    try {
      const { mode, workspacePath, hostUrl, userName } = req.body;
      if (mode) config.mode = mode;
      if (workspacePath) config.workspacePath = workspacePath;
      if (hostUrl !== undefined) config.hostUrl = normalizeHostUrl(hostUrl);
      // Only save userName to host config if explicitly provided AND no remote
      // user is identified. Remote users register via /api/user/register instead.
      // This prevents remote users from overwriting the host's display name.
      if (userName !== undefined) {
        config.userName = userName;
      }
      await saveConfig(config);
      // Also register the user in the session map
      if (userName) {
        const rawIp = req.ip || req.socket.remoteAddress || "unknown";
        const ip = rawIp.replace(/^::ffff:/, "");
        userSessions.set(ip, { userName, lastSeen: Date.now() });
      }
      let tunnelUrl: string | null = null;
      if (config.mode === "host" && ensureTunnel) {
        tunnelUrl = await ensureTunnel();
      }
      res.json({ success: true, config, tunnelUrl });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to save config" });
    }
  });

  // ==================== CHANGES API ====================
  app.get("/api/changes", async (req, res) => {
    try {
      const { file_path, user_id, limit, offset } = req.query;
      const lim = limit ? parseInt(limit as string) : 50;
      const off = offset ? parseInt(offset as string) : 0;

      const [changes, total] = await Promise.all([
        changeTracker.getChanges({
          workspaceId: config.workspacePath,
          filePath: file_path as string | undefined,
          userId: user_id as string | undefined,
          limit: lim,
          offset: off,
        }),
        changeTracker.getTotalCount({
          workspaceId: config.workspacePath,
          filePath: file_path as string | undefined,
          userId: user_id as string | undefined,
        }),
      ]);

      res.json({ changes, total });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch changes" });
    }
  });

  // ==================== SNAPSHOTS + ROLLBACK API ====================
  app.get("/api/snapshots", async (req, res) => {
    try {
      const { file, limit } = req.query;
      const snaps = await changeTracker.getSnapshots({
        workspaceId: config.workspacePath,
        filePath: (file as string | undefined) || undefined,
        limit: limit ? parseInt(limit as string) : 20,
      });
      res.json({ snapshots: snaps });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch snapshots" });
    }
  });

  app.post("/api/rollback", async (req, res) => {
    try {
      const { path: filePath, snapshot_id, change_id } = req.body;
      const rawIp = req.ip || req.socket.remoteAddress || "unknown";
      const ip = rawIp.replace(/^::ffff:/, "");
      const session = userSessions.get(ip);
      const userName = session?.userName || config.userName || "web-admin";
      const ws = config.workspacePath;

      if (!filePath && !change_id) {
        return res.status(400).json({ error: "path or change_id required" });
      }

      const result = change_id
        ? await changeTracker.rollbackToChange({
            workspaceId: ws,
            workspacePath: ws,
            changeId: change_id,
            userId: "web-" + ip,
            userName,
          })
        : snapshot_id
          ? await changeTracker.rollbackToSnapshot({
              workspaceId: ws,
              workspacePath: ws,
              filePath,
              snapshotId: snapshot_id,
              userId: "web-" + ip,
              userName,
            })
          : await changeTracker.rollbackToLatest({
              workspaceId: ws,
              workspacePath: ws,
              filePath,
              userId: "web-" + ip,
              userName,
            });

      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Rollback failed",
      });
    }
  });

  // ==================== PROJECT INFO API ====================
  // Everything stored in <workspace>/.opencoop/ — travels with the project.
  app.get("/api/project", async (req, res) => {
    try {
      const members = getProjectMembers(config.workspacePath);
      const usage = getSnapshotsDiskUsage(config.workspacePath);
      const snapshotRows = await changeTracker.getSnapshots({
        workspaceId: config.workspacePath,
        limit: 1,
      });
      res.json({
        projectId: getProjectId(config.workspacePath),
        workspacePath: config.workspacePath,
        mode: config.mode,
        members,
        snapshots: {
          files: usage.fileCount,
          totalBytes: usage.totalBytes,
        },
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project info" });
    }
  });

  // ==================== GUIDE API ====================
  // Same content the AI receives via the opencoop_guide MCP tool.
  app.get("/api/guide", (_req, res) => {
    res.json({
      guide: buildGuideText({
        mode: config.mode,
        workspacePath: config.workspacePath,
        userName: config.userName,
      }),
    });
  });

  // ==================== STATS API ====================
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await changeTracker.getStats(config.workspacePath);
      const locks = await lockManager.getActiveLocks(config.workspacePath);
      const online = await sessionManager.getOnlineUsers(config.workspacePath);

      res.json({
        ...stats,
        activeLocks: locks.length,
        onlineUsers: online.length,
        locks,
        online,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ==================== TEAM API ====================
  app.get("/api/team", async (req, res) => {
    try {
      const members = await authManager.getTeamMembers(config.workspacePath);
      const online = await sessionManager.getOnlineUsers(config.workspacePath);

      // Merge registered team members with web UI connected users
      const webUsers = Array.from(userSessions.entries()).map(([ip, data]) => ({
        userId: ip,
        email: `${data.userName} (web)`,
        permissions: "read,write",
        role: "connected",
        connectedAt: data.lastSeen,
        source: "web",
      }));

      // Add host as first member
      const hostMember = {
        userId: "host",
        email: config.userName || "Host",
        permissions: "read,write,admin",
        role: "host",
        connectedAt: Date.now(),
        source: "host",
      };

      // Previous contributors persisted in <workspace>/.opencoop/config.json
      // (survive restart; reappear when the same folder is re-selected).
      const knownNames = new Set(
        [hostMember.email, ...members.map((m: any) => m.email), ...webUsers.map((u) => u.email.replace(/ \(web\)$/, ""))]
      );
      const pastContributors = getProjectMembers(config.workspacePath)
        .filter((m) => !knownNames.has(m.name))
        .map((m) => ({
          userId: `past-${m.name}`,
          email: m.name,
          permissions: "read,write",
          role: "contributor",
          connectedAt: new Date(m.lastSeen).getTime(),
          changeCount: m.changeCount,
          source: "history",
        }));

      const allMembers = [hostMember, ...members.map((m: any) => ({
        ...m,
        source: "invite",
      })), ...webUsers, ...pastContributors];

      res.json({ members: allMembers, online });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  // ==================== INVITE API ====================
  app.post("/api/invite", async (req, res) => {
    try {
      const { email, permissions, expires_in_days } = req.body;
      const ownerId = "owner-web";
      const link = await authManager.generateInviteLink({
        workspaceId: config.workspacePath,
        email: email || "team@opencoop.local",
        permissions: permissions || ["read", "write"],
        expiresInDays: expires_in_days || 7,
        createdBy: ownerId,
        port: config.port,
        tunnelUrl: getTunnelUrl?.() || undefined,
      });
      res.json({ success: true, invite: link });
    } catch (error) {
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  app.get("/api/invite/validate/:token", async (req, res) => {
    try {
      const result = await authManager.validateInviteLink(req.params.token);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to validate invite" });
    }
  });

  // ==================== LOCKS API ====================
  app.get("/api/locks", async (req, res) => {
    try {
      const locks = await lockManager.getActiveLocks(config.workspacePath);
      res.json({ locks });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch locks" });
    }
  });

  // ==================== FILE CONTENT API (for diff) ====================
  app.get("/api/file-content/*", async (req, res) => {
    try {
      const filePath = req.params[0];
      const { promises: fs } = await import("fs");
      const path = await import("path");
      const { isProjectStorePath: isStorePath, OPENCOOP_DIR: STORE_DIR } = await import("../filesystem/project-store.js");

      // Never serve the internal project store (snapshots, members, DB).
      if (isStorePath(config.workspacePath, filePath)) {
        return res.status(403).json({ error: `Access denied: "${STORE_DIR}" is internal` });
      }

      const fullPath = path.resolve(config.workspacePath, filePath);

      const normalizedWorkspace = config.workspacePath.endsWith(path.sep)
        ? config.workspacePath
        : config.workspacePath + path.sep;
      if (!fullPath.startsWith(normalizedWorkspace) && fullPath !== config.workspacePath) {
        return res.status(403).json({ error: "Access denied" });
      }

      const content = await fs.readFile(fullPath, "utf-8");
      res.json({ content, path: filePath });
    } catch (error) {
      res.status(404).json({ error: "File not found" });
    }
  });

  // ==================== STATUS API ====================
  app.get("/api/status", (req, res) => {
    res.json({
      status: "running",
      mode: config.mode,
      workspace: config.workspacePath,
      port: config.port,
      version: "1.14.2",
      uptime: process.uptime(),
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ==================== INVITE ACCEPT PAGE ====================
  app.get("/invite/:token", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "invite.html"));
  });

  // ==================== SPA FALLBACK ====================
  app.get("*", (req, res, next) => {
    const p = req.path || "";
    if (
      p === "/sse" ||
      p.startsWith("/sse/") ||
      p === "/mcp" ||
      p.startsWith("/mcp/") ||
      p === "/messages" ||
      p.startsWith("/messages") ||
      p === "/health" ||
      p.startsWith("/api/")
    ) {
      return next();
    }
    const accept = req.headers.accept || "";
    if (!accept.includes("text/html")) {
      if (accept !== "" && !accept.includes("*/*")) {
        return next();
      }
      if (p.includes(".") && !p.endsWith(".html")) {
        return next();
      }
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}
