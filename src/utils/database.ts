import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";

let dbInstance: SqlJsDatabase | null = null;
let dbPath: string = "";

export async function initDatabase(databasePath: string): Promise<SqlJsDatabase> {
  if (dbInstance) return dbInstance;

  dbPath = databasePath;
  const dir = path.dirname(databasePath);

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory exists
  }

  const SQL = await initSqlJs();

  try {
    const fileBuffer = await fs.readFile(databasePath);
    dbInstance = new SQL.Database(fileBuffer);
  } catch {
    dbInstance = new SQL.Database();
  }

  dbInstance.run("PRAGMA journal_mode = WAL");
  dbInstance.run("PRAGMA foreign_keys = ON");

  logger.info(`Database initialized at ${databasePath}`);

  return dbInstance;
}

export function getDatabase(): SqlJsDatabase {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return dbInstance;
}

export async function saveDatabase(): Promise<void> {
  if (!dbInstance || !dbPath) return;

  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  await fs.writeFile(dbPath, buffer);
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await saveDatabase();
    dbInstance.close();
    dbInstance = null;
    dbPath = "";
  }
}

// Auto-save every 5 seconds if there are changes
let dirty = false;
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function markDirty(): void {
  dirty = true;
}

export function startAutoSave(): void {
  if (autoSaveInterval) return;

  autoSaveInterval = setInterval(async () => {
    if (dirty) {
      await saveDatabase();
      dirty = false;
    }
  }, 5000);
}

export function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

// Helper to run queries
export function runQuery(sql: string, params: any[] = []): void {
  const db = getDatabase();
  db.run(sql, params);
  markDirty();
}

// Helper to get all rows
export function getAllRows<T = any>(sql: string, params: any[] = []): T[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

// Helper to get single row
export function getRow<T = any>(sql: string, params: any[] = []): T | null {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);

  if (stmt.step()) {
    const result = stmt.getAsObject() as T;
    stmt.free();
    return result;
  }
  stmt.free();
  return null;
}

// Helper to get scalar value
export function getScalar<T = any>(sql: string, params: any[] = []): T | null {
  const row = getRow<{ value: T }>(sql, params);
  return row?.value ?? null;
}
