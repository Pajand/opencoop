import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ServerConfig } from "../types/index.js";
import { saveConfig } from "../utils/config.js";
import { AuthManager } from "../auth/auth-manager.js";
import { ChangeTracker } from "../filesystem/change-tracker.js";
import { SessionManager } from "../auth/session-manager.js";
import { LockManager } from "../filesystem/lock-manager.js";
import { initDatabase, getAllRows, getRow } from "../utils/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createWebUI(config: ServerConfig): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  const authManager = new AuthManager(config.jwtSecret);
  const changeTracker = new ChangeTracker();
  const sessionManager = new SessionManager();
  const lockManager = new LockManager();

  // ==================== CONFIG API ====================
  app.get("/api/config", (req, res) => {
    res.json({
      mode: config.mode,
      workspacePath: config.workspacePath,
      hostUrl: config.hostUrl,
      port: config.port,
    });
  });

  app.post("/api/config", async (req, res) => {
    try {
      const { mode, workspacePath, hostUrl } = req.body;
      if (mode) config.mode = mode;
      if (workspacePath) config.workspacePath = workspacePath;
      if (hostUrl !== undefined) config.hostUrl = hostUrl;
      await saveConfig(config);
      res.json({ success: true, config });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to save config" });
    }
  });

  // ==================== CHANGES API ====================
  app.get("/api/changes", async (req, res) => {
    try {
      const { file_path, user_id, limit, offset } = req.query;
      const changes = await changeTracker.getChanges({
        workspaceId: config.workspacePath,
        filePath: file_path as string | undefined,
        userId: user_id as string | undefined,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });
      res.json({ changes, total: changes.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch changes" });
    }
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
      res.json({ members, online });
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

  // ==================== STATUS API ====================
  app.get("/api/status", (req, res) => {
    res.json({
      status: "running",
      mode: config.mode,
      workspace: config.workspacePath,
      port: config.port,
      version: "1.0.0",
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
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}
