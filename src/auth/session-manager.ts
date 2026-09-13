import { v4 as uuidv4 } from "uuid";
import {
  runQuery,
  getAllRows,
} from "../utils/database.js";
import { ActiveSession } from "../types/index.js";

export class SessionManager {
  async initialize(): Promise<void> {
    runQuery(`
      CREATE TABLE IF NOT EXISTS active_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        mcp_session_id TEXT UNIQUE,
        connected_at TEXT DEFAULT (datetime('now')),
        last_heartbeat TEXT DEFAULT (datetime('now')),
        user_agent TEXT
      )
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace
        ON active_sessions(workspace_id)
    `);
  }

  async registerSession(params: {
    userId: string;
    workspaceId: string;
    mcpSessionId?: string;
    userAgent?: string;
  }): Promise<string> {
    const sessionId = uuidv4();

    runQuery(
      `INSERT INTO active_sessions (id, user_id, workspace_id, mcp_session_id, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [
        sessionId,
        params.userId,
        params.workspaceId,
        params.mcpSessionId || null,
        params.userAgent || null,
      ]
    );

    return sessionId;
  }

  async updateHeartbeat(sessionId: string): Promise<void> {
    runQuery(
      "UPDATE active_sessions SET last_heartbeat = datetime('now') WHERE id = ?",
      [sessionId]
    );
  }

  async removeSession(sessionId: string): Promise<void> {
    runQuery("DELETE FROM active_sessions WHERE id = ?", [sessionId]);
  }

  async getOnlineUsers(workspaceId: string): Promise<ActiveSession[]> {
    runQuery(
      `DELETE FROM active_sessions
       WHERE workspace_id = ? AND last_heartbeat < datetime('now', '-5 minutes')`,
      [workspaceId]
    );

    return getAllRows<ActiveSession>(
      "SELECT * FROM active_sessions WHERE workspace_id = ? ORDER BY connected_at DESC",
      [workspaceId]
    );
  }

  async isUserOnline(
    workspaceId: string,
    userId: string
  ): Promise<boolean> {
    const session = getAllRows<{ id: string }>(
      `SELECT id FROM active_sessions
       WHERE workspace_id = ? AND user_id = ? AND last_heartbeat > datetime('now', '-5 minutes')`,
      [workspaceId, userId]
    );

    return session.length > 0;
  }
}
