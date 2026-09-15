import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { nanoid } from "nanoid";
import os from "os";
import {
  runQuery,
  getAllRows,
  getRow,
  getScalar,
} from "../utils/database.js";
import { TeamMember } from "../types/index.js";

export class AuthManager {
  private jwtSecret: string;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }

  async initialize(): Promise<void> {
    runQuery(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        mode TEXT DEFAULT 'host',
        host_url TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    runQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'member',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    runQuery(`
      CREATE TABLE IF NOT EXISTS invite_links (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        email TEXT,
        permissions TEXT DEFAULT 'read,write',
        expires_at TEXT,
        max_uses INTEGER,
        use_count INTEGER DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        revoked_at TEXT
      )
    `);

    runQuery(`
      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        permissions TEXT DEFAULT 'read,write',
        invited_at TEXT DEFAULT (datetime('now')),
        accepted_at TEXT
      )
    `);
  }

  async validateToken(
    token: string
  ): Promise<{
    valid: boolean;
    userId?: string;
    workspaceId?: string;
    permissions?: string[];
  }> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return {
        valid: true,
        userId: decoded.userId,
        workspaceId: decoded.workspaceId,
        permissions: decoded.permissions,
      };
    } catch {
      return { valid: false };
    }
  }

  async generateInviteLink(params: {
    workspaceId: string;
    email: string;
    permissions: string[];
    expiresInDays: number;
    createdBy: string;
    port?: number;
    tunnelUrl?: string;
  }): Promise<{
    link: string;
    token: string;
    expiresAt: Date;
  }> {
    const token = nanoid(32);
    const expiresAt = new Date(
      Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000
    );

    runQuery(
      `INSERT INTO invite_links (id, workspace_id, token, email, permissions, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        params.workspaceId,
        token,
        params.email,
        params.permissions.join(","),
        expiresAt.toISOString(),
        params.createdBy,
      ]
    );

    // Use tunnel URL if available, otherwise fallback to local IP
    let hostAddress: string;
    if (params.tunnelUrl) {
      hostAddress = params.tunnelUrl;
    } else {
      hostAddress = `http://${this.getLocalIP()}:${params.port || 31313}`;
    }

    return {
      link: `${hostAddress}/ui/invite/${token}`,
      token,
      expiresAt,
    };
  }

  async validateInviteLink(
    token: string
  ): Promise<{
    valid: boolean;
    workspaceId?: string;
    permissions?: string[];
    reason?: string;
  }> {
    const link = getRow<{
      workspace_id: string;
      permissions: string;
      revoked_at: string | null;
      expires_at: string | null;
      max_uses: number | null;
      use_count: number;
    }>("SELECT * FROM invite_links WHERE token = ?", [token]);

    if (!link) return { valid: false, reason: "Link not found" };
    if (link.revoked_at) return { valid: false, reason: "Link revoked" };
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return { valid: false, reason: "Link expired" };
    }
    if (link.max_uses && link.use_count >= link.max_uses) {
      return { valid: false, reason: "Max uses reached" };
    }

    return {
      valid: true,
      workspaceId: link.workspace_id,
      permissions: link.permissions.split(","),
    };
  }

  async acceptInvite(token: string, userId: string): Promise<void> {
    const link = await this.validateInviteLink(token);
    if (!link.valid || !link.workspaceId) {
      throw new Error(link.reason || "Invalid invite link");
    }

    runQuery(
      `INSERT OR IGNORE INTO team_members (id, workspace_id, user_id, permissions, accepted_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), link.workspaceId, userId, link.permissions?.join(",")]
    );

    runQuery(
      "UPDATE invite_links SET use_count = use_count + 1 WHERE token = ?",
      [token]
    );
  }

  async getTeamMembers(workspaceId: string): Promise<TeamMember[]> {
    return getAllRows<TeamMember>(
      `SELECT tm.*, u.email, u.name
       FROM team_members tm
       LEFT JOIN users u ON tm.user_id = u.id
       WHERE tm.workspace_id = ?`,
      [workspaceId]
    );
  }

  async revokeAccess(
    workspaceId: string,
    userId: string,
    ownerId: string
  ): Promise<void> {
    const workspace = getRow<{ id: string }>(
      "SELECT id FROM workspaces WHERE id = ? AND owner_id = ?",
      [workspaceId, ownerId]
    );

    if (!workspace) {
      throw new Error("Only the workspace owner can revoke access");
    }

    runQuery(
      "DELETE FROM team_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );
  }

  async createWorkspace(params: {
    name: string;
    path: string;
    ownerId: string;
    mode: "host" | "remote";
    hostUrl?: string;
  }): Promise<string> {
    const workspaceId = uuidv4();

    runQuery(
      `INSERT INTO workspaces (id, name, path, owner_id, mode, host_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        workspaceId,
        params.name,
        params.path,
        params.ownerId,
        params.mode,
        params.hostUrl || null,
      ]
    );

    return workspaceId;
  }

  async getWorkspace(workspaceId: string): Promise<any> {
    return getRow(
      "SELECT * FROM workspaces WHERE id = ?",
      [workspaceId]
    );
  }

  async updateWorkspace(
    workspaceId: string,
    updates: { mode?: string; hostUrl?: string; workspacePath?: string }
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.mode) {
      setClauses.push("mode = ?");
      values.push(updates.mode);
    }
    if (updates.hostUrl !== undefined) {
      setClauses.push("host_url = ?");
      values.push(updates.hostUrl);
    }
    if (updates.workspacePath) {
      setClauses.push("path = ?");
      values.push(updates.workspacePath);
    }

    if (setClauses.length === 0) return;

    values.push(workspaceId);
    runQuery(
      `UPDATE workspaces SET ${setClauses.join(", ")} WHERE id = ?`,
      values
    );
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    const candidates: string[] = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          if (iface.address.startsWith("192.168.") || iface.address.startsWith("10.") || iface.address.startsWith("172.")) {
            return iface.address;
          }
          candidates.push(iface.address);
        }
      }
    }

    return candidates[0] || "localhost";
  }
}
