import type { PluginModule, PluginInput, ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";
import { randomUUID } from "crypto";
import { loadConfig } from "./utils/config.js";
import { OpenCOOPServer } from "./server/mcp-server.js";
import { proxyForward } from "./server/host-proxy.js";
import { FileManager } from "./filesystem/file-manager.js";
import { LockManager } from "./filesystem/lock-manager.js";
import { ChangeTracker } from "./filesystem/change-tracker.js";
import { AuthManager } from "./auth/auth-manager.js";
import { SessionManager } from "./auth/session-manager.js";
import { initDatabase, startAutoSave, stopAutoSave } from "./utils/database.js";
import { buildGuideText } from "./utils/guide.js";

async function isServerAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function defineTool(desc: string, args: any, exec: any) {
  return { description: desc, args, execute: exec };
}

let globalTunnelUrl: string | null = null;

const plugin: PluginModule = {
  id: "opencoop",
  server: async (_input: PluginInput) => {
    try {
      console.log("[OpenCOOP] Plugin server starting...");

      let config;
      try {
        config = await loadConfig();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("[OpenCOOP] Failed to load config:", msg);
        return {};
      }

      const port = config.port || 31313;
      const workspacePath = config.workspacePath;

      await initDatabase(config.databasePath);
      startAutoSave();

      const fileManager = new FileManager(workspacePath);
      const lockManager = new LockManager();
      const changeTracker = new ChangeTracker();
      const authManager = new AuthManager(config.jwtSecret);
      const sessionManager = new SessionManager();

      try {
        await lockManager.initialize();
        await changeTracker.initialize();
        await authManager.initialize();
        await sessionManager.initialize();
        console.log("[OpenCOOP] All managers initialized");
      } catch (error) {
        console.log("[OpenCOOP] Error initializing managers:", error instanceof Error ? error.message : String(error));
      }

      const alive = await isServerAlive(port);
      let serverInstance: OpenCOOPServer | null = null;

      if (alive) {
        console.log(`[OpenCOOP] Server already running on port ${port} - reusing`);
        // Fetch tunnel URL from running server
        try {
          const tunnelRes = await fetch(`http://127.0.0.1:${port}/tunnel-url`);
          if (tunnelRes.ok) {
            const tunnelData = await tunnelRes.json() as { url?: string };
            if (tunnelData.url) globalTunnelUrl = tunnelData.url;
          }
        } catch {}
      } else {
        serverInstance = new OpenCOOPServer(config);
        try {
          await serverInstance.startHttp(port);
          globalTunnelUrl = serverInstance.getTunnelUrl();
          console.log(`[OpenCOOP] Server ready on port ${port}`);
        } catch (error: any) {
          console.log("[OpenCOOP] Failed to start server:", error instanceof Error ? error.message : String(error));
          return {};
        }
      }

      const userId = () => "user-" + randomUUID().slice(0, 8);

      const ws = workspacePath;
      const PRIORITY = `SHARED PROJECT (${ws}). If the user confirmed working in the shared project, ALWAYS use this tool for these files — NEVER local tools and NEVER Bash (cat/echo/sed/redirects). Bash bypasses tracking and snapshots, so Bash mistakes CANNOT be undone. Paths are relative to the workspace root.`;

      const tools: Record<string, any> = {};

      tools.opencoop_guide = defineTool(
        "START HERE — call FIRST in every new conversation BEFORE any file work. Explains the shared team project, the EXACT confirmation question to ask the user, and all behavior rules.",
        {},
        async (_args: any, _ctx: any) => {
          return buildGuideText({ mode: config.mode, workspacePath: ws, userName: config.userName });
        }
      );

      tools.read_file = defineTool(
        `Read a file from the shared team project. ${PRIORITY}`,
        { path: z.string(), start_line: z.number().optional(), end_line: z.number().optional() },
        async (args: any, _ctx: any) => {
          const uid = userId();
          const content = await fileManager.readFile(args.path, {
            startLine: args.start_line,
            endLine: args.end_line,
          });
          await changeTracker.logChange({ workspaceId: workspacePath, filePath: args.path, userId: uid, userName: (args._opencoop_user as string) || config.userName || uid, action: "read" });
          return content;
        }
      );

      tools.write_file = defineTool(
        `Create or overwrite a file in the shared team project. ${PRIORITY} Automatically snapshots the previous version. If you break a file, fix it yourself with rollback_file.`,
        { path: z.string(), content: z.string(), create_dirs: z.boolean().optional() },
        async (args: any, _ctx: any) => {
          const uid = userId();
          await changeTracker.snapshotBeforeChange(workspacePath, args.path, (args._opencoop_user as string) || config.userName || uid);
          await fileManager.writeFile(args.path, args.content, { createDirs: args.create_dirs });
          await changeTracker.logChange({ workspaceId: workspacePath, filePath: args.path, userId: uid, userName: (args._opencoop_user as string) || config.userName || uid, action: "update", newContentHash: await fileManager.hash(args.path) });
          return `File written successfully: ${args.path} (previous version snapshotted — use rollback_file to undo if needed)`;
        }
      );

      tools.edit_file = defineTool(
        `Make a targeted edit in the shared team project. ${PRIORITY} PREFER over write_file (smaller edits = fewer conflicts). Previous version snapshotted automatically.`,
        { path: z.string(), search: z.string(), replace: z.string(), replace_all: z.boolean().optional() },
        async (args: any, _ctx: any) => {
          const uid = userId();
          const oldHash = await fileManager.hash(args.path);
          await changeTracker.snapshotBeforeChange(workspacePath, args.path, (args._opencoop_user as string) || config.userName || uid);
          const result = await fileManager.editFile(args.path, args.search, args.replace, { replaceAll: args.replace_all });
          const newHash = await fileManager.hash(args.path);
          await changeTracker.logChange({ workspaceId: workspacePath, filePath: args.path, userId: uid, userName: (args._opencoop_user as string) || config.userName || uid, action: "update", oldContentHash: oldHash, newContentHash: newHash, metadata: JSON.stringify({ changes: result.changes }) });
          return `Edit applied: ${result.changes} occurrence(s) replaced in ${args.path} (previous version snapshotted — use rollback_file to undo if needed)`;
        }
      );

      tools.list_snapshots = defineTool(
        "List saved previous versions of a shared-project file. Use before rollback_file to pick a version, or to answer 'what versions exist'.",
        { file_path: z.string().optional(), limit: z.number().optional() },
        async (args: any, _ctx: any) => {
          const snaps = await changeTracker.getSnapshots({ workspaceId: workspacePath, filePath: args.file_path, limit: args.limit || 20 });
          return JSON.stringify(snaps, null, 2);
        }
      );

      tools.rollback_file = defineTool(
        "UNDO YOUR MISTAKE: restore a shared-project file to a previous version. WHEN: you broke a file, result looks wrong, or user says undo/revert/restore. HOW: pass ONLY path to undo the last change. For a specific version: list_snapshots first, then pass path + snapshot_id. SAFE: current state is snapshotted first, so rollback is reversible. After rollback, tell the user and retry correctly.",
        { path: z.string(), snapshot_id: z.string().optional(), change_id: z.string().optional() },
        async (args: any, _ctx: any) => {
          const uid = userId();
          const uname = (args._opencoop_user as string) || config.userName || uid;
          const result = args.change_id
            ? await changeTracker.rollbackToChange({ workspaceId: workspacePath, workspacePath, changeId: args.change_id, userId: uid, userName: uname })
            : args.snapshot_id
              ? await changeTracker.rollbackToSnapshot({ workspaceId: workspacePath, workspacePath, filePath: args.path, snapshotId: args.snapshot_id, userId: uid, userName: uname })
              : await changeTracker.rollbackToLatest({ workspaceId: workspacePath, workspacePath, filePath: args.path, userId: uid, userName: uname });
          return `Rolled back ${result.filePath} to the version from ${result.restoredFrom}. Previous state snapshotted first — reversible. Now retry your task correctly.`;
        }
      );

      tools.list_files = defineTool(
        "List files and directories in the shared project.",
        { path: z.string().optional(), recursive: z.boolean().optional() },
        async (args: any, _ctx: any) => {
          const files = await fileManager.listFiles(args.path || ".", { recursive: args.recursive });
          return JSON.stringify(files, null, 2);
        }
      );

      tools.search_files = defineTool(
        "Search for files matching a glob pattern.",
        { pattern: z.string(), max_results: z.number().optional() },
        async (args: any, _ctx: any) => {
          const results = await fileManager.searchFiles(args.pattern, { maxResults: args.max_results });
          return JSON.stringify(results, null, 2);
        }
      );

      tools.grep_content = defineTool(
        "Search file contents using regex pattern.",
        { pattern: z.string(), path: z.string().optional(), include: z.string().optional() },
        async (args: any, _ctx: any) => {
          const results = await fileManager.grep(args.pattern, { path: args.path, include: args.include });
          return JSON.stringify(results, null, 2);
        }
      );

      tools.directory_tree = defineTool(
        "Get a tree view of the project directory structure.",
        { path: z.string().optional(), max_depth: z.number().optional(), exclude: z.array(z.string()).optional() },
        async (args: any, _ctx: any) => {
          const tree = await fileManager.getDirectoryTree(args.path || ".", { maxDepth: args.max_depth, excludePatterns: args.exclude });
          return JSON.stringify(tree, null, 2);
        }
      );

      tools.lock_file = defineTool(
        "Acquire an exclusive lock on a file before editing. Prevents other users from editing the same file simultaneously.",
        { path: z.string(), reason: z.string().optional() },
        async (args: any, _ctx: any) => {
          const uid = userId();
          const sessionId = randomUUID();
          const result = await lockManager.acquireLock({ workspaceId: workspacePath, filePath: args.path, userId: uid, sessionId, reason: args.reason });
          return JSON.stringify(result);
        }
      );

      tools.unlock_file = defineTool(
        "Release a lock on a file after editing.",
        { path: z.string() },
        async (args: any, _ctx: any) => {
          const uid = userId();
          await lockManager.releaseLock(workspacePath, args.path, uid);
          return `Lock released for: ${args.path}`;
        }
      );

      tools.list_locks = defineTool(
        "List all currently active file locks in the project.",
        {},
        async (_args: any, _ctx: any) => {
          const locks = await lockManager.getActiveLocks(workspacePath);
          return JSON.stringify(locks, null, 2);
        }
      );

      tools.check_lock = defineTool(
        "Check if a specific file is currently locked and by whom.",
        { path: z.string() },
        async (args: any, _ctx: any) => {
          const lock = await lockManager.checkLock(workspacePath, args.path);
          return JSON.stringify(lock);
        }
      );

      tools.view_changes = defineTool(
        "View recent changes made by all team members in the project.",
        { file_path: z.string().optional(), user_id: z.string().optional(), limit: z.number().optional() },
        async (args: any, _ctx: any) => {
          const changes = await changeTracker.getChanges({ workspaceId: workspacePath, filePath: args.file_path, userId: args.user_id, limit: args.limit || 20 });
          return JSON.stringify(changes, null, 2);
        }
      );

      tools.view_stats = defineTool(
        "View statistics about the project: total files, changes per user, recent activity.",
        {},
        async (_args: any, _ctx: any) => {
          const stats = await changeTracker.getStats(workspacePath);
          return JSON.stringify(stats, null, 2);
        }
      );

      tools.who_is_online = defineTool(
        "See which team members are currently connected to this project.",
        {},
        async (_args: any, _ctx: any) => {
          const online = await sessionManager.getOnlineUsers(workspacePath);
          return JSON.stringify(online, null, 2);
        }
      );

      tools.invite_member = defineTool(
        "Generate an invite link for a new team member. Only the project owner can use this.",
        { email: z.string(), permissions: z.array(z.enum(["read", "write", "admin"])), expires_in_days: z.number().optional() },
        async (args: any, _ctx: any) => {
          const uid = userId();
            const tunnelUrl = globalTunnelUrl || serverInstance?.getTunnelUrl() || undefined;
          const link = await authManager.generateInviteLink({ workspaceId: workspacePath, email: args.email, permissions: args.permissions, expiresInDays: args.expires_in_days || 7, createdBy: uid, port, tunnelUrl });
          return JSON.stringify(link);
        }
      );

      tools.list_members = defineTool(
        "List all team members and their permissions.",
        {},
        async (_args: any, _ctx: any) => {
          const members = await authManager.getTeamMembers(workspacePath);
          return JSON.stringify(members, null, 2);
        }
      );

      tools.revoke_access = defineTool(
        "Revoke a team member's access. Only the project owner can use this.",
        { user_id: z.string(), reason: z.string().optional() },
        async (args: any, _ctx: any) => {
          const ownerId = "owner-" + randomUUID().slice(0, 8);
          await authManager.revokeAccess(workspacePath, args.user_id, ownerId);
          return `Access revoked for user: ${args.user_id}`;
        }
      );

      console.log(`[OpenCOOP] Registered ${Object.keys(tools).length} tools`);

      // REMOTE-mode proxy (single interception point for ALL in-process tools):
      // in REMOTE mode every call is forwarded to the host server over its
      // tunnel; in HOST mode proxyForward() returns null and the original
      // local handler runs completely untouched. No restart ever needed.
      for (const [toolName, t] of Object.entries(tools)) {
        const origExecute = (t as any).execute;
        (t as any).execute = async (a: any, ctx: any) => {
          const px = await proxyForward(toolName, a, config.port);
          if (px !== null) return px;
          return origExecute(a, ctx);
        };
      }

      return {
        tool: tools,
        dispose: async () => {
          try {
            if (serverInstance) await serverInstance.stop();
            stopAutoSave();
          } catch {}
        },
      };
    } catch (fatal) {
      const msg = fatal instanceof Error ? fatal.message : String(fatal);
      console.log("[OpenCOOP] Fatal error (suppressed):", msg);
      return {};
    }
  },
};

export default plugin;
export { OpenCOOPServer };
export type { ServerConfig } from "./types/index.js";
