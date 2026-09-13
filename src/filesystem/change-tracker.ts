import { v4 as uuidv4 } from "uuid";
import {
  runQuery,
  getAllRows,
  getRow,
  getScalar,
} from "../utils/database.js";
import { ChangeLogEntry } from "../types/index.js";

export class ChangeTracker {
  async initialize(): Promise<void> {
    runQuery(`
      CREATE TABLE IF NOT EXISTS change_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        user_id TEXT NOT NULL,
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
  }

  async logChange(
    entry: Omit<ChangeLogEntry, "id" | "timestamp">
  ): Promise<void> {
    runQuery(
      `INSERT INTO change_logs (id, workspace_id, file_path, user_id, action,
        old_content_hash, new_content_hash, old_path, new_path, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        entry.workspaceId,
        entry.filePath,
        entry.userId,
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
}
