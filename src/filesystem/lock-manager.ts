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

    // Migration: display name column (for showing WHO holds a lock).
    try {
      runQuery(`ALTER TABLE file_locks ADD COLUMN user_name TEXT`);
    } catch {
      // Column already exists — ignore
    }

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
      user_name: string | null;
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
            userName: existingLock.user_name || existingLock.user_id,
            reason: existingLock.reason || "No reason provided",
            acquiredAt: new Date(existingLock.acquired_at),
            expiresAt: new Date(existingLock.expires_at),
          },
          message:
            `File is locked by ${existingLock.user_name || existingLock.user_id}. ` +
            `Reason: ${existingLock.reason || "Not specified"}. ` +
            `Wait for them to unlock (or lock expiry, 30 min).`,
        };
      }
    }

    // Same user re-acquiring (or refreshing) their own lock: replace it.
    runQuery(
      "DELETE FROM file_locks WHERE workspace_id = ? AND file_path = ? AND user_id = ?",
      [params.workspaceId, params.filePath, params.userId]
    );

    const lockId = uuidv4();
    const expiresAt = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000);

    runQuery(
      `INSERT INTO file_locks (id, workspace_id, file_path, user_id, user_name, session_id, reason, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lockId,
        params.workspaceId,
        params.filePath,
        params.userId,
        params.userName || null,
        params.sessionId,
        params.reason || null,
        expiresAt.toISOString(),
      ]
    );

    const lock: LockInfo = {
      id: lockId,
      filePath: params.filePath,
      userId: params.userId,
      userName: params.userName || params.userId,
      reason: params.reason || "",
      acquiredAt: new Date(),
      expiresAt,
    };

    return {
      granted: true,
      lock,
      message: `Lock acquired for: ${params.filePath} (held by ${lock.userName})`,
    };
  }

  /**
   * Release a lock. Returns what actually happened so callers can report
   * the truth to the AI (the old API silently "succeeded" even when the
   * lock belonged to someone else).
   */
  async releaseLock(
    workspaceId: string,
    filePath: string,
    userId: string,
    opts?: { force?: boolean }
  ): Promise<{
    released: boolean;
    reason: "released" | "not-held" | "not-owner";
    heldBy?: LockInfo;
  }> {
    await this.cleanupExpiredLocks(workspaceId);

    const existing = await this.checkLock(workspaceId, filePath);
    if (!existing) return { released: false, reason: "not-held" };

    if (existing.userId !== userId && !opts?.force) {
      return { released: false, reason: "not-owner", heldBy: existing };
    }

    runQuery(
      "DELETE FROM file_locks WHERE workspace_id = ? AND file_path = ?",
      [workspaceId, filePath]
    );
    return { released: true, reason: "released" };
  }

  async checkLock(
    workspaceId: string,
    filePath: string
  ): Promise<LockInfo | null> {
    const lock = getRow<{
      id: string;
      file_path: string;
      user_id: string;
      user_name: string | null;
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
      userName: lock.user_name || lock.user_id,
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
      user_name: string | null;
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
      userName: lock.user_name || lock.user_id,
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
