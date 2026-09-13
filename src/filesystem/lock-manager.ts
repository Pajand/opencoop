import { v4 as uuidv4 } from "uuid";
import {
  runQuery,
  getAllRows,
  getRow,
  getScalar,
} from "../utils/database.js";
import { markDirty } from "../utils/database.js";
import { LockInfo, AcquireLockParams } from "../types/index.js";

const LOCK_TTL_MINUTES = 30;

export class LockManager {
  async initialize(): Promise<void> {
    runQuery(`
      CREATE TABLE IF NOT EXISTS file_locks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        lock_type TEXT DEFAULT 'exclusive',
        reason TEXT,
        acquired_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        UNIQUE(workspace_id, file_path)
      )
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_locks_workspace
        ON file_locks(workspace_id)
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_locks_user
        ON file_locks(user_id)
    `);
  }

  async acquireLock(params: AcquireLockParams): Promise<{
    granted: boolean;
    lock?: LockInfo;
    blockedBy?: LockInfo;
    message: string;
  }> {
    await this.cleanupExpiredLocks(params.workspaceId);

    const existingLock = getRow<{
      id: string;
      workspace_id: string;
      file_path: string;
      user_id: string;
      session_id: string;
      lock_type: string;
      reason: string | null;
      acquired_at: string;
      expires_at: string;
    }>(
      "SELECT * FROM file_locks WHERE workspace_id = ? AND file_path = ? AND user_id != ?",
      [params.workspaceId, params.filePath, params.userId]
    );

    if (existingLock) {
      if (new Date(existingLock.expires_at) > new Date()) {
        return {
          granted: false,
          blockedBy: {
            id: existingLock.id,
            filePath: existingLock.file_path,
            userId: existingLock.user_id,
            userName: existingLock.user_id,
            reason: existingLock.reason || "No reason provided",
            acquiredAt: new Date(existingLock.acquired_at),
            expiresAt: new Date(existingLock.expires_at),
          },
          message: `File is locked by another user. Reason: ${existingLock.reason || "Not specified"}`,
        };
      }
    }

    runQuery(
      "DELETE FROM file_locks WHERE workspace_id = ? AND file_path = ? AND user_id = ?",
      [params.workspaceId, params.filePath, params.userId]
    );

    const lockId = uuidv4();
    const expiresAt = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000);

    runQuery(
      `INSERT INTO file_locks (id, workspace_id, file_path, user_id, session_id, reason, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        lockId,
        params.workspaceId,
        params.filePath,
        params.userId,
        params.sessionId,
        params.reason || null,
        expiresAt.toISOString(),
      ]
    );

    const lock: LockInfo = {
      id: lockId,
      filePath: params.filePath,
      userId: params.userId,
      userName: params.userId,
      reason: params.reason || "",
      acquiredAt: new Date(),
      expiresAt,
    };

    return {
      granted: true,
      lock,
      message: `Lock acquired for: ${params.filePath}`,
    };
  }

  async releaseLock(
    workspaceId: string,
    filePath: string,
    userId: string
  ): Promise<void> {
    runQuery(
      "DELETE FROM file_locks WHERE workspace_id = ? AND file_path = ? AND user_id = ?",
      [workspaceId, filePath, userId]
    );
  }

  async checkLock(
    workspaceId: string,
    filePath: string
  ): Promise<LockInfo | null> {
    const lock = getRow<{
      id: string;
      file_path: string;
      user_id: string;
      reason: string | null;
      acquired_at: string;
      expires_at: string;
    }>(
      "SELECT * FROM file_locks WHERE workspace_id = ? AND file_path = ?",
      [workspaceId, filePath]
    );

    if (!lock) return null;

    if (new Date(lock.expires_at) <= new Date()) {
      runQuery("DELETE FROM file_locks WHERE id = ?", [lock.id]);
      return null;
    }

    return {
      id: lock.id,
      filePath: lock.file_path,
      userId: lock.user_id,
      userName: lock.user_id,
      reason: lock.reason || "",
      acquiredAt: new Date(lock.acquired_at),
      expiresAt: new Date(lock.expires_at),
    };
  }

  async getActiveLocks(workspaceId: string): Promise<LockInfo[]> {
    await this.cleanupExpiredLocks(workspaceId);

    const locks = getAllRows<{
      id: string;
      file_path: string;
      user_id: string;
      reason: string | null;
      acquired_at: string;
      expires_at: string;
    }>(
      "SELECT * FROM file_locks WHERE workspace_id = ? ORDER BY acquired_at DESC",
      [workspaceId]
    );

    return locks.map((lock) => ({
      id: lock.id,
      filePath: lock.file_path,
      userId: lock.user_id,
      userName: lock.user_id,
      reason: lock.reason || "",
      acquiredAt: new Date(lock.acquired_at),
      expiresAt: new Date(lock.expires_at),
    }));
  }

  private async cleanupExpiredLocks(workspaceId: string): Promise<void> {
    runQuery(
      "DELETE FROM file_locks WHERE workspace_id = ? AND expires_at <= datetime('now')",
      [workspaceId]
    );
  }

  async forceReleaseAll(workspaceId: string): Promise<number> {
    const count = getScalar<number>(
      "SELECT COUNT(*) as value FROM file_locks WHERE workspace_id = ?",
      [workspaceId]
    );
    runQuery("DELETE FROM file_locks WHERE workspace_id = ?", [workspaceId]);
    return count || 0;
  }
}
