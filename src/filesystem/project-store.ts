import fs from "fs";
import path from "path";

/**
 * Per-project persistent store.
 *
 * Every workspace chosen by the HOST gets a hidden `.opencoop/` folder:
 *
 *   my-project/
 *   └── .opencoop/
 *       ├── config.json    — project id, members, settings (travels with project)
 *       └── snapshots/     — previous file versions, named by content hash
 *           └── <sha256>
 *
 * Why inside the project (and not a central folder)?
 *  - History travels WITH the project (copy/rename/move keeps everything).
 *  - Re-selecting the same folder later restores members, settings, snapshots.
 *  - Restart / disconnect loses nothing — everything is on disk.
 *
 * Safety:
 *  - The folder is hidden (dot-prefix), auto-added to .gitignore,
 *    hidden from listings, and BLOCKED from remote file-tool access.
 *
 * All functions here are SYNCHRONOUS on purpose: ensureProjectStore() is
 * called from the FileManager constructor (which must stay sync).
 */

export const OPENCOOP_DIR = ".opencoop";
export const SNAPSHOTS_SUBDIR = "snapshots";
export const PROJECT_CONFIG_FILE = "config.json";

/** Max snapshots kept per file (older ones are pruned automatically). */
export const MAX_SNAPSHOTS_PER_FILE = 20;
/** Files bigger than this never get a snapshot (keeps disk usage sane). */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2 MB

export function getProjectStoreDir(workspacePath: string): string {
  return path.join(path.resolve(workspacePath), OPENCOOP_DIR);
}

export function getSnapshotsDir(workspacePath: string): string {
  return path.join(getProjectStoreDir(workspacePath), SNAPSHOTS_SUBDIR);
}

export function getProjectConfigPath(workspacePath: string): string {
  return path.join(getProjectStoreDir(workspacePath), PROJECT_CONFIG_FILE);
}

/** Returns true if a workspace-relative (or absolute) path points inside .opencoop */
export function isProjectStorePath(workspacePath: string, p: string): boolean {
  const storeDir = getProjectStoreDir(workspacePath);
  const resolved = path.isAbsolute(p) ? path.normalize(p) : path.resolve(workspacePath, p);
  return resolved === storeDir || resolved.startsWith(storeDir + path.sep);
}

export interface ProjectMemberRecord {
  name: string;
  firstSeen: string;
  lastSeen: string;
  changeCount: number;
}

export interface ProjectConfig {
  projectId: string;
  createdAt: string;
  members: ProjectMemberRecord[];
}

function newProjectId(): string {
  return (
    "proj-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function readProjectConfig(workspacePath: string): ProjectConfig | null {
  try {
    const raw = fs.readFileSync(getProjectConfigPath(workspacePath), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.members)) {
      return null;
    }
    return parsed as ProjectConfig;
  } catch {
    return null;
  }
}

function writeProjectConfig(workspacePath: string, cfg: ProjectConfig): void {
  try {
    fs.writeFileSync(
      getProjectConfigPath(workspacePath),
      JSON.stringify(cfg, null, 2),
      "utf-8"
    );
  } catch {
    // Store is best-effort; never break file operations because of it.
  }
}

/**
 * Create `.opencoop/` structure if missing. Safe to call on every startup:
 * existing data is NEVER overwritten — if the folder already exists (user
 * re-selected a previous project), all history/members/settings are kept.
 */
export function ensureProjectStore(workspacePath: string): void {
  try {
    const resolved = path.resolve(workspacePath);
    // Never create the store outside a real directory.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    fs.mkdirSync(getSnapshotsDir(workspacePath), { recursive: true });

    if (!readProjectConfig(workspacePath)) {
      writeProjectConfig(workspacePath, {
        projectId: newProjectId(),
        createdAt: new Date().toISOString(),
        members: [],
      });
    }

    ensureGitignored(workspacePath);
  } catch {
    // Best-effort only.
  }
}

/** Auto-add `.opencoop` to .gitignore so history is never committed. */
function ensureGitignored(workspacePath: string): void {
  try {
    const gitDir = path.join(path.resolve(workspacePath), ".git");
    let isGit = false;
    try {
      isGit = fs.statSync(gitDir).isDirectory();
    } catch {
      return; // Not a git repo — nothing to do.
    }
    if (!isGit) return;

    const ignorePath = path.join(path.resolve(workspacePath), ".gitignore");
    let content = "";
    try {
      content = fs.readFileSync(ignorePath, "utf-8");
    } catch {
      content = "";
    }
    const lines = content.split("\n").map((l) => l.trim());
    if (!lines.includes(OPENCOOP_DIR) && !lines.includes(OPENCOOP_DIR + "/")) {
      const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      fs.writeFileSync(
        ignorePath,
        content + suffix + `# OpenCOOP project history (snapshots, members)\n${OPENCOOP_DIR}/\n`,
        "utf-8"
      );
    }
  } catch {
    // Best-effort only.
  }
}

/**
 * Record that `userName` made a change in this project.
 * Stored in `.opencoop/config.json` → survives restart, travels with project.
 */
export function recordProjectMember(workspacePath: string, userName: string): void {
  try {
    if (!userName) return;
    const name = String(userName).slice(0, 100);
    let cfg = readProjectConfig(workspacePath);
    if (!cfg) {
      ensureProjectStore(workspacePath);
      cfg = readProjectConfig(workspacePath);
      if (!cfg) return;
    }
    const now = new Date().toISOString();
    const existing = cfg.members.find((m) => m.name === name);
    if (existing) {
      existing.lastSeen = now;
      existing.changeCount += 1;
    } else {
      cfg.members.push({ name, firstSeen: now, lastSeen: now, changeCount: 1 });
    }
    // Keep the list bounded (most-recent 50 members).
    cfg.members.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    cfg.members = cfg.members.slice(0, 50);
    writeProjectConfig(workspacePath, cfg);
  } catch {
    // Best-effort only.
  }
}

export function getProjectMembers(workspacePath: string): ProjectMemberRecord[] {
  return readProjectConfig(workspacePath)?.members || [];
}

export function getProjectId(workspacePath: string): string | null {
  return readProjectConfig(workspacePath)?.projectId || null;
}

/** Disk usage of the snapshot store (for UI / stats). */
export function getSnapshotsDiskUsage(workspacePath: string): {
  fileCount: number;
  totalBytes: number;
} {
  try {
    const dir = getSnapshotsDir(workspacePath);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let totalBytes = 0;
    let fileCount = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        totalBytes += fs.statSync(path.join(dir, e.name)).size;
        fileCount += 1;
      } catch {
        // Skip unreadable entries.
      }
    }
    return { fileCount, totalBytes };
  } catch {
    return { fileCount: 0, totalBytes: 0 };
  }
}
