import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import {
  runQuery,
  getAllRows,
  getRow,
  getScalar,
} from "../utils/database.js";
import { ChangeLogEntry, SnapshotInfo } from "../types/index.js";
import {
  ensureProjectStore,
  getSnapshotsDir,
  recordProjectMember,
  MAX_SNAPSHOTS_PER_FILE,
  MAX_SNAPSHOT_BYTES,
} from "./project-store.js";
import { FileManager } from "./file-manager.js";

export class ChangeTracker {
  async initialize(): Promise<void> {
    runQuery(`
      CREATE TABLE IF NOT EXISTS change_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT,
        action TEXT NOT NULL,
        old_content_hash TEXT,
        new_content_hash TEXT,
        old_path TEXT,
        new_path TEXT,
        metadata TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      )
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_changes_workspace
        ON change_logs(workspace_id)
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_changes_file
        ON change_logs(workspace_id, file_path)
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_changes_user
        ON change_logs(workspace_id, user_id)
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_changes_timestamp
        ON change_logs(workspace_id, timestamp DESC)
    `);

    // Migration: add user_name column if missing (for existing databases)
    try {
      runQuery(`ALTER TABLE change_logs ADD COLUMN user_name TEXT`);
    } catch {
      // Column already exists — ignore
    }

    // Snapshots: previous file versions for rollback.
    // Content lives in <workspace>/.opencoop/snapshots/<sha256>,
    // this table is the index (who / when / which file).
    runQuery(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        change_id TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    runQuery(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
        ON snapshots(workspace_id, file_path, created_at DESC)
    `);
  }

  async logChange(
    entry: Omit<ChangeLogEntry, "id" | "timestamp">
  ): Promise<void> {
    runQuery(
      `INSERT INTO change_logs (id, workspace_id, file_path, user_id, user_name, action,
        old_content_hash, new_content_hash, old_path, new_path, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        entry.workspaceId,
        entry.filePath,
        entry.userId,
        entry.userName || null,
        entry.action,
        entry.oldContentHash || null,
        entry.newContentHash || null,
        entry.oldPath || null,
        entry.newPath || null,
        entry.metadata || null,
      ]
    );
  }

  async getChanges(params: {
    workspaceId: string;
    filePath?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ChangeLogEntry[]> {
    let query = "SELECT * FROM change_logs WHERE workspace_id = ?";
    const args: any[] = [params.workspaceId];

    if (params.filePath) {
      query += " AND file_path = ?";
      args.push(params.filePath);
    }

    if (params.userId) {
      query += " AND user_id = ?";
      args.push(params.userId);
    }

    query += " ORDER BY timestamp DESC";

    const limit = params.limit || 20;
    const offset = params.offset || 0;
    query += ` LIMIT ${limit} OFFSET ${offset}`;

    const rows = getAllRows<{
      id: string;
      workspace_id: string;
      file_path: string;
      user_id: string;
      user_name: string | null;
      action: string;
      old_content_hash: string | null;
      new_content_hash: string | null;
      old_path: string | null;
      new_path: string | null;
      metadata: string | null;
      timestamp: string;
    }>(query, args);

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      filePath: row.file_path,
      userId: row.user_id,
      userName: row.user_name || undefined,
      action: row.action as ChangeLogEntry["action"],
      oldContentHash: row.old_content_hash || undefined,
      newContentHash: row.new_content_hash || undefined,
      oldPath: row.old_path || undefined,
      newPath: row.new_path || undefined,
      metadata: row.metadata || undefined,
      timestamp: new Date(row.timestamp),
    }));
  }

  async getStats(workspaceId: string): Promise<{
    totalChanges: number;
    changesByUser: Record<string, number>;
    changesByAction: Record<string, number>;
    recentActivity: ChangeLogEntry[];
  }> {
    const total =
      getScalar<number>(
        "SELECT COUNT(*) as value FROM change_logs WHERE workspace_id = ?",
        [workspaceId]
      ) || 0;

    const byUserRows = getAllRows<{ user_id: string; count: number }>(
      "SELECT user_id, COUNT(*) as count FROM change_logs WHERE workspace_id = ? GROUP BY user_id ORDER BY count DESC",
      [workspaceId]
    );

    const byActionRows = getAllRows<{ action: string; count: number }>(
      "SELECT action, COUNT(*) as count FROM change_logs WHERE workspace_id = ? GROUP BY action",
      [workspaceId]
    );

    const recent = await this.getChanges({ workspaceId, limit: 10 });

    return {
      totalChanges: total,
      changesByUser: Object.fromEntries(
        byUserRows.map((r) => [r.user_id, r.count])
      ),
      changesByAction: Object.fromEntries(
        byActionRows.map((r) => [r.action, r.count])
      ),
      recentActivity: recent,
    };
  }

  async getTotalCount(params: {
    workspaceId: string;
    filePath?: string;
    userId?: string;
  }): Promise<number> {
    let query = "SELECT COUNT(*) as value FROM change_logs WHERE workspace_id = ?";
    const args: any[] = [params.workspaceId];

    if (params.filePath) {
      query += " AND file_path = ?";
      args.push(params.filePath);
    }

    if (params.userId) {
      query += " AND user_id = ?";
      args.push(params.userId);
    }

    return getScalar<number>(query, args) || 0;
  }

  // ==================== SNAPSHOTS ====================

  /**
   * Save a version of a file's content as a restorable snapshot.
   * Returns the snapshot id, or null when the content is not snapshottable
   * (empty / binary / too large) — callers treat null as "no snapshot needed".
   * Identical consecutive content is de-duplicated (existing id is returned).
   */
  async saveSnapshot(params: {
    workspaceId: string;
    workspacePath: string;
    filePath: string;
    content: string;
    changeId?: string;
    createdBy?: string;
  }): Promise<string | null> {
    const { workspaceId, workspacePath, filePath, content } = params;

    const size = Buffer.byteLength(content, "utf-8");
    if (size === 0 || size > MAX_SNAPSHOT_BYTES) return null;
    if (content.includes("\0")) return null; // binary — skip

    try {
      ensureProjectStore(workspacePath);

      const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");

      // De-dupe: if the newest snapshot of this file is identical, reuse it.
      const latest = getRow<{ id: string; content_hash: string }>(
        `SELECT id, content_hash FROM snapshots
          WHERE workspace_id = ? AND file_path = ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        [workspaceId, filePath]
      );
      if (latest && latest.content_hash === hash) return latest.id;

      // Content file (shared by hash across files — written once).
      const snapFile = path.join(getSnapshotsDir(workspacePath), hash);
      try {
        await fs.access(snapFile);
      } catch {
        await fs.writeFile(snapFile, content, "utf-8");
      }

      const id = uuidv4();
      runQuery(
        `INSERT INTO snapshots (id, workspace_id, file_path, content_hash, size, change_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          workspaceId,
          filePath,
          hash,
          size,
          params.changeId || null,
          params.createdBy || null,
        ]
      );

      if (params.createdBy) recordProjectMember(workspacePath, params.createdBy);

      this.pruneSnapshots(workspaceId, workspacePath, filePath);
      return id;
    } catch {
      // Snapshots are best-effort: never break the actual file operation.
      return null;
    }
  }

  /**
   * Convenience helper: snapshot the CURRENT on-disk content of a file
   * BEFORE it gets overwritten. Call this before every write/edit.
   */
  async snapshotBeforeChange(
    workspacePath: string,
    filePath: string,
    createdBy?: string
  ): Promise<string | null> {
    try {
      const full = path.resolve(workspacePath, filePath);
      const content = await fs.readFile(full, "utf-8");
      return this.saveSnapshot({
        workspaceId: workspacePath,
        workspacePath,
        filePath,
        content,
        createdBy,
      });
    } catch {
      // File doesn't exist yet (first write) or unreadable — nothing to snapshot.
      return null;
    }
  }

  /** Drop snapshots beyond MAX_SNAPSHOTS_PER_FILE (+ delete orphaned files). */
  private pruneSnapshots(
    workspaceId: string,
    workspacePath: string,
    filePath: string
  ): void {
    try {
      const stale = getAllRows<{ id: string; content_hash: string }>(
        `SELECT id, content_hash FROM snapshots
          WHERE workspace_id = ? AND file_path = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT -1 OFFSET ${MAX_SNAPSHOTS_PER_FILE}`,
        [workspaceId, filePath]
      );
      for (const row of stale) {
        runQuery(`DELETE FROM snapshots WHERE id = ?`, [row.id]);
        const stillUsed =
          getScalar<number>(
            `SELECT COUNT(*) as value FROM snapshots WHERE workspace_id = ? AND content_hash = ?`,
            [workspaceId, row.content_hash]
          ) || 0;
        if (!stillUsed && /^[a-f0-9]{64}$/.test(row.content_hash)) {
          fs.unlink(path.join(getSnapshotsDir(workspacePath), row.content_hash)).catch(() => {});
        }
      }
    } catch {
      // Pruning is best-effort.
    }
  }

  async getSnapshots(params: {
    workspaceId: string;
    filePath?: string;
    limit?: number;
  }): Promise<SnapshotInfo[]> {
    let query = "SELECT * FROM snapshots WHERE workspace_id = ?";
    const args: any[] = [params.workspaceId];

    if (params.filePath) {
      query += " AND file_path = ?";
      args.push(params.filePath);
    }

    query += " ORDER BY created_at DESC, rowid DESC";
    query += ` LIMIT ${params.limit || 20}`;

    const rows = getAllRows<{
      id: string;
      workspace_id: string;
      file_path: string;
      content_hash: string;
      size: number;
      change_id: string | null;
      created_by: string | null;
      created_at: string;
    }>(query, args);

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      filePath: row.file_path,
      contentHash: row.content_hash,
      size: row.size,
      changeId: row.change_id || undefined,
      createdBy: row.created_by || undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  /** Read the stored content of a snapshot (hash validated against traversal). */
  async getSnapshotContent(
    workspacePath: string,
    snapshotId: string
  ): Promise<string> {
    const row = getRow<{
      workspace_id: string;
      file_path: string;
      content_hash: string;
    }>(`SELECT workspace_id, file_path, content_hash FROM snapshots WHERE id = ?`, [
      snapshotId,
    ]);
    if (!row) throw new Error("Snapshot not found");
    if (!/^[a-f0-9]{64}$/.test(row.content_hash)) {
      throw new Error("Snapshot is corrupted");
    }
    return fs.readFile(
      path.join(getSnapshotsDir(workspacePath), row.content_hash),
      "utf-8"
    );
  }

  /**
   * Restore a file to a snapshot. SAFE BY DESIGN:
   * the current content is snapshotted FIRST, so a bad rollback
   * can itself be rolled back. The rollback is audit-logged.
   */
  async rollbackToSnapshot(params: {
    workspaceId: string;
    workspacePath: string;
    filePath: string;
    snapshotId: string;
    userId: string;
    userName?: string;
  }): Promise<{
    filePath: string;
    restoredFrom: string;
    restoredAt: string;
    backupSnapshotId: string | null;
  }> {
    const { workspaceId, workspacePath, filePath, snapshotId, userId, userName } = params;

    const row = getRow<{
      workspace_id: string;
      file_path: string;
      content_hash: string;
      created_at: string;
    }>(`SELECT workspace_id, file_path, content_hash, created_at FROM snapshots WHERE id = ?`, [
      snapshotId,
    ]);
    if (!row || row.workspace_id !== workspaceId) {
      throw new Error("Snapshot not found in this project");
    }
    if (row.file_path !== filePath) {
      throw new Error("Snapshot belongs to a different file");
    }

    const content = await this.getSnapshotContent(workspacePath, snapshotId);
    const fm = new FileManager(workspacePath);

    // 1. Back up current state first → rollback is reversible.
    let backupSnapshotId: string | null = null;
    try {
      const current = await fm.readFile(filePath);
      if (current !== content) {
        backupSnapshotId = await this.saveSnapshot({
          workspaceId,
          workspacePath,
          filePath,
          content: current,
          createdBy: userName,
        });
      }
    } catch {
      // File missing — nothing to back up.
    }

    // 2. Restore (atomic write, create dirs if the file was deleted).
    await fm.writeFile(filePath, content, { createDirs: true });

    // 3. Audit-log the rollback.
    const newHash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
    await this.logChange({
      workspaceId,
      filePath,
      userId,
      userName,
      action: "rollback",
      oldContentHash: undefined,
      newContentHash: newHash,
      metadata: JSON.stringify({
        restoredFromSnapshot: snapshotId,
        snapshotCreatedAt: row.created_at,
        backupSnapshotId,
      }),
    });
    if (userName) recordProjectMember(workspacePath, userName);

    return {
      filePath,
      restoredFrom: row.created_at,
      restoredAt: new Date().toISOString(),
      backupSnapshotId,
    };
  }

  /**
   * SIMPLE rollback: restore a file to its newest snapshot (= undo last change).
   * This is what `rollback_file` calls when given ONLY a path — no ids needed.
   */
  async rollbackToLatest(params: {
    workspaceId: string;
    workspacePath: string;
    filePath: string;
    userId: string;
    userName?: string;
  }): Promise<{
    filePath: string;
    restoredFrom: string;
    restoredAt: string;
    backupSnapshotId: string | null;
  }> {
    const snaps = await this.getSnapshots({
      workspaceId: params.workspaceId,
      filePath: params.filePath,
      limit: 1,
    });
    if (snaps.length === 0) {
      throw new Error(
        `No snapshots exist for "${params.filePath}" yet — nothing to roll back to. ` +
          `Snapshots are created automatically on every write/edit (since v1.14.0).`
      );
    }
    return this.rollbackToSnapshot({
      workspaceId: params.workspaceId,
      workspacePath: params.workspacePath,
      filePath: params.filePath,
      snapshotId: snaps[0].id,
      userId: params.userId,
      userName: params.userName,
    });
  }

  /**
   * Restore a file to how it looked BEFORE a given change-log entry.
   * Finds the newest snapshot created at/before that change.
   */
  async rollbackToChange(params: {
    workspaceId: string;
    workspacePath: string;
    changeId: string;
    userId: string;
    userName?: string;
  }): Promise<{
    filePath: string;
    restoredFrom: string;
    restoredAt: string;
    backupSnapshotId: string | null;
  }> {
    const { workspaceId, changeId } = params;
    const change = getRow<{
      workspace_id: string;
      file_path: string;
      timestamp: string;
    }>(`SELECT workspace_id, file_path, timestamp FROM change_logs WHERE id = ?`, [
      changeId,
    ]);
    if (!change || change.workspace_id !== workspaceId) {
      throw new Error("Change not found in this project");
    }
    const snap = getRow<{ id: string }>(
      `SELECT id FROM snapshots
        WHERE workspace_id = ? AND file_path = ? AND created_at <= ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [workspaceId, change.file_path, change.timestamp]
    );
    if (!snap) {
      throw new Error(
        `No snapshot exists from before this change to "${change.file_path}" (snapshots started with v1.14.0 — older changes cannot be rolled back)`
      );
    }
    return this.rollbackToSnapshot({
      workspaceId: params.workspaceId,
      workspacePath: params.workspacePath,
      filePath: change.file_path,
      snapshotId: snap.id,
      userId: params.userId,
      userName: params.userName,
    });
  }
}
