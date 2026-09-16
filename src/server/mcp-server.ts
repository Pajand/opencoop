import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { randomUUID } from "crypto";
import express from "express";
import cors from "cors";
import { z } from "zod";

import { FileManager } from "../filesystem/file-manager.js";
import { LockManager } from "../filesystem/lock-manager.js";
import { ChangeTracker } from "../filesystem/change-tracker.js";
import { AuthManager } from "../auth/auth-manager.js";
import { SessionManager } from "../auth/session-manager.js";
import { logger } from "../utils/logger.js";
import { ServerConfig } from "../types/index.js";
import { initDatabase, startAutoSave, stopAutoSave } from "../utils/database.js";
import { createWebUI } from "../web/server.js";
import { TunnelManager } from "../utils/tunnel.js";
import { proxyForward, closeProxy } from "./host-proxy.js";
import { buildGuideText } from "../utils/guide.js";

export class OpenCOOPServer {
  private config: ServerConfig;
  private fileManager!: FileManager;
  private lockManager!: LockManager;
  private changeTracker!: ChangeTracker;
  private authManager!: AuthManager;
  private sessionManager!: SessionManager;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private sseTransports: Map<string, SSEServerTransport> = new Map();
  private httpServer: any = null;
  private tunnelManager: TunnelManager | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Initialize database
    await initDatabase(this.config.databasePath);
    startAutoSave();

    // Initialize managers
    this.fileManager = new FileManager(this.config.workspacePath);
    this.lockManager = new LockManager();
    this.changeTracker = new ChangeTracker();
    this.authManager = new AuthManager(this.config.jwtSecret);
    this.sessionManager = new SessionManager();

    // Initialize all tables
    try {
      await this.lockManager.initialize();
      await this.changeTracker.initialize();
      await this.authManager.initialize();
      await this.sessionManager.initialize();
      logger.info("All managers initialized");
    } catch (error) {
      console.log("Error initializing managers:", error instanceof Error ? error.message : String(error));
    }
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: "opencoop",
      version: "1.0.0",
    });

    // REMOTE-mode proxy (single interception point for ALL tools, incl. future ones):
    // in REMOTE mode every call is forwarded to the host server over its tunnel;
    // in HOST mode proxyForward() returns null and the original local handler
    // runs completely untouched.
    const origTool = server.tool.bind(server);
    (server as any).tool = (name: string, ...rest: any[]) => {
      const last = rest[rest.length - 1];
      if (typeof last === "function") {
        rest[rest.length - 1] = async (args: any, extra: any) => {
          const px = await proxyForward(name, args, this.config.port);
          if (px !== null) return { content: [{ type: "text" as const, text: px }] };
          return last(args, extra);
        };
      }
      return (origTool as any)(name, ...rest);
    };

    this.registerFileTools(server);
    this.registerLockTools(server);
    this.registerMonitoringTools(server);
    this.registerSafetyTools(server);
    this.registerTeamTools(server);

    return server;
  }

  private getToolDefinitions(): Array<{ name: string; description: string; inputSchema: any }> {
    return [
      { name: "read_file", description: "Read the contents of a file in the shared project.", inputSchema: { type: "object", properties: { path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["path"] } },
      { name: "write_file", description: "Create or overwrite a file in the shared project.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, create_dirs: { type: "boolean" } }, required: ["path", "content"] } },
      { name: "edit_file", description: "Make a targeted edit to a file using search and replace.", inputSchema: { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" }, replace_all: { type: "boolean" } }, required: ["path", "search", "replace"] } },
      { name: "list_files", description: "List files and directories in the shared project.", inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } } } },
      { name: "search_files", description: "Search for files matching a glob pattern.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, max_results: { type: "number" } }, required: ["pattern"] } },
      { name: "grep_content", description: "Search file contents using regex pattern.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, include: { type: "string" } }, required: ["pattern"] } },
      { name: "directory_tree", description: "Get a tree view of the project directory structure.", inputSchema: { type: "object", properties: { path: { type: "string" }, max_depth: { type: "number" }, exclude: { type: "array", items: { type: "string" } } } } },
      { name: "lock_file", description: "Acquire an exclusive lock on a file before editing.", inputSchema: { type: "object", properties: { path: { type: "string" }, reason: { type: "string" } }, required: ["path"] } },
      { name: "unlock_file", description: "Release a lock on a file after editing.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "list_locks", description: "List all currently active file locks in the project.", inputSchema: { type: "object", properties: {} } },
      { name: "check_lock", description: "Check if a specific file is currently locked and by whom.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "view_changes", description: "View recent changes made by all team members in the project.", inputSchema: { type: "object", properties: { file_path: { type: "string" }, user_id: { type: "string" }, limit: { type: "number" } } } },
      { name: "view_stats", description: "View statistics about the project.", inputSchema: { type: "object", properties: {} } },
      { name: "who_is_online", description: "See which team members are currently connected.", inputSchema: { type: "object", properties: {} } },
      { name: "invite_member", description: "Generate an invite link for a new team member.", inputSchema: { type: "object", properties: { email: { type: "string" }, permissions: { type: "array", items: { type: "string", enum: ["read", "write", "admin"] } }, expires_in_days: { type: "number" } }, required: ["email", "permissions"] } },
      { name: "list_members", description: "List all team members and their permissions.", inputSchema: { type: "object", properties: {} } },
      { name: "revoke_access", description: "Revoke a team member's access.", inputSchema: { type: "object", properties: { user_id: { type: "string" }, reason: { type: "string" } }, required: ["user_id"] } },
      { name: "list_snapshots", description: "List saved previous versions of a shared-project file. Use before rollback_file to pick a version.", inputSchema: { type: "object", properties: { file_path: { type: "string" }, limit: { type: "number" } } } },
      { name: "rollback_file", description: "Undo a mistake: restore a shared-project file to a previous version. Just pass path to undo the last change.", inputSchema: { type: "object", properties: { path: { type: "string" }, snapshot_id: { type: "string" }, change_id: { type: "string" } }, required: ["path"] } },
      { name: "opencoop_guide", description: "START HERE — call FIRST in every new conversation before any file work. Explains the shared project, the confirmation question to ask the user, and all behavior rules.", inputSchema: { type: "object", properties: {} } },
    ];
  }

  private async callTool(name: string, args: any): Promise<string> {
    // REMOTE mode: forward to host; HOST mode: run locally (unchanged).
    const px = await proxyForward(name, args, this.config.port);
    if (px !== null) return px;
    const userId = "user-" + randomUUID().slice(0, 8);
    const userName = this.resolveUserName(args, userId);
    try {
      switch (name) {
        case "read_file":
          return await this.fileManager.readFile(args.path, { startLine: args.start_line, endLine: args.end_line });
        case "write_file":
          await this.changeTracker.snapshotBeforeChange(this.config.workspacePath, args.path, userName);
          await this.fileManager.writeFile(args.path, args.content, { createDirs: args.create_dirs });
          await this.changeTracker.logChange({ workspaceId: this.config.workspacePath, filePath: args.path, userId, userName, action: "update", newContentHash: await this.fileManager.hash(args.path) });
          return `File written successfully: ${args.path} (previous version snapshotted — use rollback_file to undo if needed)`;
        case "edit_file": {
          const oldHash = await this.fileManager.hash(args.path);
          await this.changeTracker.snapshotBeforeChange(this.config.workspacePath, args.path, userName);
          const result = await this.fileManager.editFile(args.path, args.search, args.replace, { replaceAll: args.replace_all });
          const newHash = await this.fileManager.hash(args.path);
          await this.changeTracker.logChange({ workspaceId: this.config.workspacePath, filePath: args.path, userId, userName, action: "update", oldContentHash: oldHash, newContentHash: newHash, metadata: JSON.stringify({ changes: result.changes }) });
          return `Edit applied: ${result.changes} occurrence(s) replaced in ${args.path} (previous version snapshotted — use rollback_file to undo if needed)`;
        }
        case "list_snapshots":
          return JSON.stringify(await this.changeTracker.getSnapshots({ workspaceId: this.config.workspacePath, filePath: args.file_path, limit: args.limit || 20 }), null, 2);
        case "rollback_file": {
          const result = args.change_id
            ? await this.changeTracker.rollbackToChange({ workspaceId: this.config.workspacePath, workspacePath: this.config.workspacePath, changeId: args.change_id, userId, userName })
            : args.snapshot_id
              ? await this.changeTracker.rollbackToSnapshot({ workspaceId: this.config.workspacePath, workspacePath: this.config.workspacePath, filePath: args.path, snapshotId: args.snapshot_id, userId, userName })
              : await this.changeTracker.rollbackToLatest({ workspaceId: this.config.workspacePath, workspacePath: this.config.workspacePath, filePath: args.path, userId, userName });
          return `Rolled back ${result.filePath} to the version from ${result.restoredFrom}. Your previous (broken) state was snapshotted first, so this rollback is itself reversible. Now retry your task correctly.`;
        }
        case "opencoop_guide":
          return buildGuideText({ mode: this.config.mode, workspacePath: this.config.workspacePath, userName: this.config.userName });
        case "list_files":
          return JSON.stringify(await this.fileManager.listFiles(args.path || ".", { recursive: args.recursive }), null, 2);
        case "search_files":
          return JSON.stringify(await this.fileManager.searchFiles(args.pattern, { maxResults: args.max_results }), null, 2);
        case "grep_content":
          return JSON.stringify(await this.fileManager.grep(args.pattern, { path: args.path, include: args.include }), null, 2);
        case "directory_tree":
          return JSON.stringify(await this.fileManager.getDirectoryTree(args.path || ".", { maxDepth: args.max_depth, excludePatterns: args.exclude }), null, 2);
        case "lock_file": {
          const sessionId = randomUUID();
          const lockResult = await this.lockManager.acquireLock({ workspaceId: this.config.workspacePath, filePath: args.path, userId, sessionId, reason: args.reason });
          return JSON.stringify(lockResult);
        }
        case "unlock_file":
          await this.lockManager.releaseLock(this.config.workspacePath, args.path, userId);
          return `Lock released for: ${args.path}`;
        case "list_locks":
          return JSON.stringify(await this.lockManager.getActiveLocks(this.config.workspacePath), null, 2);
        case "check_lock":
          return JSON.stringify(await this.lockManager.checkLock(this.config.workspacePath, args.path));
        case "view_changes":
          return JSON.stringify(await this.changeTracker.getChanges({ workspaceId: this.config.workspacePath, filePath: args.file_path, userId: args.user_id, limit: args.limit || 20 }), null, 2);
        case "view_stats":
          return JSON.stringify(await this.changeTracker.getStats(this.config.workspacePath), null, 2);
        case "who_is_online":
          return JSON.stringify(await this.sessionManager.getOnlineUsers(this.config.workspacePath), null, 2);
        case "invite_member": {
          const link = await this.authManager.generateInviteLink({ workspaceId: this.config.workspacePath, email: args.email, permissions: args.permissions, expiresInDays: args.expires_in_days || 7, createdBy: userId, port: this.config.port, tunnelUrl: this.tunnelManager?.getUrl() || undefined });
          return JSON.stringify(link);
        }
        case "list_members":
          return JSON.stringify(await this.authManager.getTeamMembers(this.config.workspacePath), null, 2);
        case "revoke_access": {
          const ownerId = "owner-" + randomUUID().slice(0, 8);
          await this.authManager.revokeAccess(this.config.workspacePath, args.user_id, ownerId);
          return `Access revoked for user: ${args.user_id}`;
        }
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private registerFileTools(server: McpServer) {
    const ws = this.config.workspacePath;
    const PRIORITY = `SHARED PROJECT (${ws}). If the user confirmed working in the shared project, ALWAYS use this tool for these files — NEVER local Read/Write/Edit tools and NEVER Bash (cat/echo/sed/redirects). Bash bypasses tracking and snapshots, so Bash mistakes CANNOT be undone. Paths are relative to the workspace root.`;

    server.tool(
      "read_file",
      `Read a file from the shared team project. ${PRIORITY}`,
      {
        path: z.string().describe("Relative file path from project root, e.g. 'src/app.ts'"),
        start_line: z.number().optional().describe("Start line number (1-based)"),
        end_line: z.number().optional().describe("End line number (1-based)"),
        _opencoop_user: z.string().optional().describe("Remote user's display name (injected by proxy)"),
      },
      async ({ path, start_line, end_line, _opencoop_user }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const userName = this.resolveUserName({ _opencoop_user }, userId);
        const content = await this.fileManager.readFile(path, {
          startLine: start_line,
          endLine: end_line,
        });
        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          userName,
          action: "read",
        });
        return {
          content: [{ type: "text" as const, text: content }],
        };
      }
    );

    server.tool(
      "write_file",
      `Create or overwrite a file in the shared team project. ${PRIORITY} Every write AUTOMATICALLY snapshots the previous version (tracked in the audit log). If you break a file, fix it yourself with rollback_file — do not wait for the human.`,
      {
        path: z.string().describe("Relative file path from project root, e.g. 'src/app.ts'"),
        content: z.string().describe("Full file content to write"),
        create_dirs: z.boolean().optional().describe("Create parent directories if they do not exist"),
        _opencoop_user: z.string().optional().describe("Remote user's display name (injected by proxy)"),
      },
      async ({ path, content, create_dirs, _opencoop_user }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const userName = this.resolveUserName({ _opencoop_user }, userId);
        let oldContent = "";
        try { oldContent = await this.fileManager.readFile(path); } catch {}
        await this.changeTracker.snapshotBeforeChange(this.config.workspacePath, path, userName);
        await this.fileManager.writeFile(path, content, { createDirs: create_dirs });
        const diff = this.computeDiff(oldContent, content);
        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          userName,
          action: "update",
          oldContentHash: oldContent ? await this.hashString(oldContent) : undefined,
          newContentHash: await this.fileManager.hash(path),
          metadata: diff ? JSON.stringify({ diff }) : undefined,
        });
        return {
          content: [{ type: "text" as const, text: `File written successfully: ${path} (previous version snapshotted — use rollback_file to undo if needed)` }],
        };
      }
    );

    server.tool(
      "edit_file",
      `Make a targeted edit to a file in the shared team project. ${PRIORITY} PREFER this over write_file for modifying existing files (smaller edits = fewer conflicts with teammates). The previous version is snapshotted automatically — if you break the file, rollback_file undoes it.`,
      {
        path: z.string().describe("Relative file path from project root"),
        search: z.string().describe("Exact text to find (must match the file exactly, including whitespace)"),
        replace: z.string().describe("Text to replace with"),
        replace_all: z.boolean().optional().describe("Replace all occurrences (default: false)"),
        _opencoop_user: z.string().optional().describe("Remote user's display name (injected by proxy)"),
      },
      async ({ path, search, replace, replace_all, _opencoop_user }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const userName = this.resolveUserName({ _opencoop_user }, userId);
        const oldContent = await this.fileManager.readFile(path);
        const oldHash = await this.fileManager.hash(path);
        await this.changeTracker.snapshotBeforeChange(this.config.workspacePath, path, userName);
        const result = await this.fileManager.editFile(path, search, replace, {
          replaceAll: replace_all,
        });
        const newContent = await this.fileManager.readFile(path);
        const newHash = await this.fileManager.hash(path);
        const diff = this.computeDiff(oldContent, newContent);

        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          userName,
          action: "update",
          oldContentHash: oldHash,
          newContentHash: newHash,
          metadata: JSON.stringify({ changes: result.changes, diff }),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Edit applied: ${result.changes} occurrence(s) replaced in ${path}`,
            },
          ],
        };
      }
    );

    server.tool(
      "list_files",
      "List files and directories in the shared project.",
      {
        path: z.string().optional().describe("Directory path (default: project root)"),
        recursive: z.boolean().optional().describe("List recursively"),
      },
      async ({ path, recursive }) => {
        const files = await this.fileManager.listFiles(path || ".", { recursive });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }],
        };
      }
    );

    server.tool(
      "search_files",
      "Search for files matching a glob pattern.",
      {
        pattern: z.string().describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.js')"),
        max_results: z.number().optional().describe("Maximum results (default: 50)"),
      },
      async ({ pattern, max_results }) => {
        const results = await this.fileManager.searchFiles(pattern, {
          maxResults: max_results,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      }
    );

    server.tool(
      "grep_content",
      "Search file contents using regex pattern.",
      {
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().describe("Directory to search in (default: project root)"),
        include: z.string().optional().describe("File pattern to include (e.g., '*.ts')"),
      },
      async ({ pattern, path, include }) => {
        const results = await this.fileManager.grep(pattern, { path, include });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      }
    );

    server.tool(
      "directory_tree",
      "Get a tree view of the project directory structure.",
      {
        path: z.string().optional().describe("Root path (default: project root)"),
        max_depth: z.number().optional().describe("Maximum depth (default: 3)"),
        exclude: z.array(z.string()).optional().describe("Patterns to exclude"),
      },
      async ({ path, max_depth, exclude }) => {
        const tree = await this.fileManager.getDirectoryTree(path || ".", {
          maxDepth: max_depth,
          excludePatterns: exclude,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }],
        };
      }
    );
  }

  private registerLockTools(server: McpServer) {
    server.tool(
      "lock_file",
      "Acquire an exclusive lock on a file before editing. Prevents other users from editing the same file simultaneously.",
      {
        path: z.string().describe("File path to lock"),
        reason: z.string().optional().describe("Brief description of what you plan to do"),
        _opencoop_user: z.string().optional().describe("Remote user's display name (injected by proxy)"),
      },
      async ({ path, reason, _opencoop_user }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const userName = this.resolveUserName({ _opencoop_user }, userId);
        const sessionId = randomUUID();

        const result = await this.lockManager.acquireLock({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          sessionId,
          reason,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }
    );

    server.tool(
      "unlock_file",
      "Release a lock on a file after editing.",
      {
        path: z.string().describe("File path to unlock"),
      },
      async ({ path }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        await this.lockManager.releaseLock(
          this.config.workspacePath,
          path,
          userId
        );
        return {
          content: [{ type: "text" as const, text: `Lock released for: ${path}` }],
        };
      }
    );

    server.tool(
      "list_locks",
      "List all currently active file locks in the project.",
      {},
      async () => {
        const locks = await this.lockManager.getActiveLocks(
          this.config.workspacePath
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(locks, null, 2) }],
        };
      }
    );

    server.tool(
      "check_lock",
      "Check if a specific file is currently locked and by whom.",
      {
        path: z.string().describe("File path to check"),
      },
      async ({ path }) => {
        const lock = await this.lockManager.checkLock(
          this.config.workspacePath,
          path
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(lock) }],
        };
      }
    );
  }

  private registerMonitoringTools(server: McpServer) {
    server.tool(
      "view_changes",
      "View recent changes made by all team members in the project.",
      {
        file_path: z.string().optional().describe("Filter by specific file"),
        user_id: z.string().optional().describe("Filter by specific user"),
        limit: z.number().optional().describe("Number of changes to show (default: 20)"),
      },
      async ({ file_path, user_id, limit }) => {
        const changes = await this.changeTracker.getChanges({
          workspaceId: this.config.workspacePath,
          filePath: file_path,
          userId: user_id,
          limit: limit || 20,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(changes, null, 2) }],
        };
      }
    );

    server.tool(
      "view_stats",
      "View statistics about the project: total files, changes per user, recent activity.",
      {},
      async () => {
        const stats = await this.changeTracker.getStats(
          this.config.workspacePath
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
        };
      }
    );

    server.tool(
      "who_is_online",
      "See which team members are currently connected to this project.",
      {},
      async () => {
        const online = await this.sessionManager.getOnlineUsers(
          this.config.workspacePath
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(online, null, 2) }],
        };
      }
    );
  }

  private registerSafetyTools(server: McpServer) {
    server.tool(
      "opencoop_guide",
      "START HERE — call this tool FIRST at the beginning of every new conversation, BEFORE any file work. It tells you about the shared team project (where it is, host or remote mode), the EXACT confirmation question you MUST ask the user, and all behavior rules (tool priority, teamwork, self-healing with rollback). If you feel lost at any point, call it again.",
      {},
      async () => {
        return {
          content: [
            {
              type: "text" as const,
              text: buildGuideText({
                mode: this.config.mode,
                workspacePath: this.config.workspacePath,
                userName: this.config.userName,
              }),
            },
          ],
        };
      }
    );

    server.tool(
      "list_snapshots",
      "List saved previous versions of a file in the shared project. WHEN: (1) before rollback_file when you want to pick a specific older version, (2) to answer 'what versions exist / what changed'. Each entry shows snapshot_id, timestamp, author, and size. Snapshots are created automatically on every write/edit.",
      {
        file_path: z.string().optional().describe("File to list versions for (relative path). Omit to see recent snapshots across the project."),
        limit: z.number().optional().describe("Max entries (default: 20)"),
      },
      async ({ file_path, limit }) => {
        const snaps = await this.changeTracker.getSnapshots({
          workspaceId: this.config.workspacePath,
          filePath: file_path,
          limit: limit || 20,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(snaps, null, 2) }],
        };
      }
    );

    server.tool(
      "rollback_file",
      "UNDO YOUR MISTAKE: restore a shared-project file to a previous version. WHEN TO USE: (1) you broke a file with write_file/edit_file, (2) the result looks wrong after your change, (3) tests fail because of your edit, (4) the user says undo / revert / restore / rollback / 'bring it back'. HOW: pass ONLY 'path' to undo the last change — nothing else needed. To restore a SPECIFIC older version, first call list_snapshots, then pass path + snapshot_id. SAFE: rollback snapshots the current state first, so even a wrong rollback can be rolled back. After rollback, TELL the user what you restored and retry the task correctly. NEVER reconstruct a broken file from memory when a snapshot exists.",
      {
        path: z.string().describe("Relative file path to restore (e.g. 'src/app.ts')"),
        snapshot_id: z.string().optional().describe("Specific version to restore (from list_snapshots). Omit to undo the last change."),
        change_id: z.string().optional().describe("Restore to how the file looked BEFORE this change-log entry (from view_changes). Omit to undo the last change."),
        _opencoop_user: z.string().optional().describe("Remote user's display name (injected by proxy)"),
      },
      async ({ path, snapshot_id, change_id, _opencoop_user }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const userName = this.resolveUserName({ _opencoop_user }, userId);
        const ws = this.config.workspacePath;
        const result = change_id
          ? await this.changeTracker.rollbackToChange({ workspaceId: ws, workspacePath: ws, changeId: change_id, userId, userName })
          : snapshot_id
            ? await this.changeTracker.rollbackToSnapshot({ workspaceId: ws, workspacePath: ws, filePath: path, snapshotId: snapshot_id, userId, userName })
            : await this.changeTracker.rollbackToLatest({ workspaceId: ws, workspacePath: ws, filePath: path, userId, userName });
        return {
          content: [
            {
              type: "text" as const,
              text: `Rolled back ${result.filePath} to the version from ${result.restoredFrom}. Your previous state was snapshotted first, so this rollback is itself reversible. Now retry your task correctly and tell the user what happened.`,
            },
          ],
        };
      }
    );
  }

  private registerTeamTools(server: McpServer) {    server.tool(
      "invite_member",
      "Generate an invite link for a new team member. Only the project owner can use this.",
      {
        email: z.string().describe("Email of the person to invite"),
        permissions: z
          .array(z.enum(["read", "write", "admin"]))
          .describe("Permissions to grant"),
        expires_in_days: z
          .number()
          .optional()
          .describe("Link expiry in days (default: 7)"),
      },
      async ({ email, permissions, expires_in_days }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const link = await this.authManager.generateInviteLink({
          workspaceId: this.config.workspacePath,
          email,
          permissions,
          expiresInDays: expires_in_days || 7,
          createdBy: userId,
          port: this.config.port,
          tunnelUrl: this.tunnelManager?.getUrl() || undefined,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(link) }],
        };
      }
    );

    server.tool(
      "list_members",
      "List all team members and their permissions.",
      {},
      async () => {
        const members = await this.authManager.getTeamMembers(
          this.config.workspacePath
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(members, null, 2) }],
        };
      }
    );

    server.tool(
      "revoke_access",
      "Revoke a team member's access. Only the project owner can use this.",
      {
        user_id: z.string().describe("User ID to revoke"),
        reason: z.string().optional().describe("Reason for revocation"),
      },
      async ({ user_id }) => {
        const ownerId = "owner-" + randomUUID().slice(0, 8);
        await this.authManager.revokeAccess(
          this.config.workspacePath,
          user_id,
          ownerId
        );
        return {
          content: [
            { type: "text" as const, text: `Access revoked for user: ${user_id}` },
          ],
        };
      }
    );
  }

  /**
   * Resolve the effective user name for a tool call.
   * Priority: 1) _opencoop_user injected by REMOTE proxy (actual remote user),
   * 2) this.config.userName (host's own name), 3) fallback userId.
   */
  private resolveUserName(args: any, fallbackId: string): string {
    const remoteUser = args?._opencoop_user;
    if (typeof remoteUser === "string" && remoteUser.trim()) {
      return remoteUser.trim();
    }
    return this.config.userName || fallbackId;
  }

  private computeDiff(oldText: string, newText: string): Array<{ type: 'added' | 'removed' | 'unchanged'; line: string }> | null {
    if (oldText === newText) return null;
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diff: Array<{ type: 'added' | 'removed' | 'unchanged'; line: string }> = [];

    // Simple line-by-line diff using LCS
    const lcs = this.lcs(oldLines, newLines);
    let oi = 0, ni = 0, li = 0;

    while (oi < oldLines.length || ni < newLines.length) {
      if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li] && ni < newLines.length && newLines[ni] === lcs[li]) {
        diff.push({ type: 'unchanged', line: oldLines[oi] });
        oi++; ni++; li++;
      } else if (ni >= newLines.length || (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li]))) {
        diff.push({ type: 'removed', line: oldLines[oi] });
        oi++;
      } else {
        diff.push({ type: 'added', line: newLines[ni] });
        ni++;
      }
    }

    return diff.length > 0 ? diff : null;
  }

  private lcs(a: string[], b: string[]): string[] {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const result: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j--; }
      else if (dp[i - 1][j] > dp[i][j - 1]) i--;
      else j--;
    }
    return result;
  }

  private async hashString(content: string): Promise<string> {
    const { createHash } = await import("crypto");
    return createHash("sha256").update(content).digest("hex");
  }

  async startHttp(port: number): Promise<void> {
    await this.initialize();

    const app = express();
    app.use(express.json());
    app.use(cors({
      origin: true,
      exposedHeaders: ["mcp-session-id"],
      allowedHeaders: ["Content-Type", "mcp-session-id", "Accept", "Mcp-Protocol-Version", "Last-Event-ID"],
    }));

    app.get("/health", (req, res) => {
      res.json({ status: "ok", version: "1.0.0" });
    });

    app.get("/tunnel-url", (req, res) => {
      // Extra fields are backward compatible: old clients only read `url`.
      const s = this.tunnelManager?.getStatus() || { url: null, starting: false, error: null };
      res.json(s);
    });

    // SSE endpoint - OpenCode connects here when url ends with /sse
    // This avoids the StreamableHTTP Accept header issue
    app.get("/sse", async (req, res) => {
      try {
        const server = this.createMcpServer();
        const transport = new SSEServerTransport("/messages", res);
        this.sseTransports.set(transport.sessionId, transport);

        transport.onclose = () => {
          this.sseTransports.delete(transport.sessionId);
        };

        // Note: server.connect() already calls transport.start() internally.
        await server.connect(transport);
        console.log(`[OpenCOOP] SSE session established: ${transport.sessionId}`);
      } catch (err) {
        console.log("Error establishing SSE:", err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          res.status(500).json({ error: "SSE connection failed" });
        }
      }
    });

    // SSE messages endpoint - POST messages from SSE clients
    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string | undefined;

      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId query parameter" });
        return;
      }

      const transport = this.sseTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      try {
        // IMPORTANT: express.json() already consumed the request stream,
        // so pass the parsed body — otherwise the SDK throws
        // "stream is not readable" and every tools call fails with HTTP 400.
        await transport.handlePostMessage(req, res, req.body);
      } catch (err) {
        console.log("Error handling SSE message:", err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    });

    app.post("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        const acceptHeader = req.headers.accept || "";

        if (sessionId && this.transports.has(sessionId)) {
          const transport = this.transports.get(sessionId)!;
          await transport.handleRequest(req, res, req.body);
          return;
        }

        if (sessionId) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID" },
            id: req.body?.id,
          });
          return;
        }

        // OpenCode sends POST with Accept: text/event-stream or */* (missing application/json)
        // StreamableHTTPServerTransport rejects this with 406. Handle it ourselves.
        if (!acceptHeader.includes("application/json")) {
          const server = this.createMcpServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: false,
          });
          await server.connect(transport);

          // Override the transport's accept check by setting proper headers on the response
          // Actually, we need to handle this manually since the transport will reject it.
          // Parse the JSON-RPC request, process it, and return as SSE.
          const body = req.body;
          if (body && body.method === "initialize") {
            // For initialize, return the server info as SSE
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.status(200);

            const initData = {
              protocolVersion: "2025-03-26",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "opencoop",
                version: "1.0.0",
              },
            };

            const response = {
              jsonrpc: "2.0",
              id: body.id,
              result: initData,
            };

            res.write(`data: ${JSON.stringify(response)}\n\n`);
            res.write("event: endpoint\ndata: /messages\n\n");
            res.end();
            return;
          }

          if (body && body.method === "tools/list") {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.status(200);

            const tools = this.getToolDefinitions();
            const response = {
              jsonrpc: "2.0",
              id: body.id,
              result: { tools },
            };

            res.write(`data: ${JSON.stringify(response)}\n\n`);
            res.end();
            return;
          }

          if (body && body.method === "tools/call") {
            const toolName = body.params?.name;
            const toolArgs = body.params?.arguments || {};
            const result = await this.callTool(toolName, toolArgs);

            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.status(200);

            const response = {
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
              },
            };

            res.write(`data: ${JSON.stringify(response)}\n\n`);
            res.end();
            return;
          }

          // For any other method, return method not found
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.status(200);
          const errResponse = {
            jsonrpc: "2.0",
            id: body?.id,
            error: { code: -32601, message: "Method not found" },
          };
          res.write(`data: ${JSON.stringify(errResponse)}\n\n`);
          res.end();
          return;
        }

        // Standard StreamableHTTP path (Accept includes application/json)
        const server = this.createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.log("Error handling MCP request:", error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: req.body?.id,
          });
        }
      }
    });

    // SSE endpoint for OpenCode's remote MCP client
    // OpenCode sends GET /mcp with Accept: text/event-stream (SSE style)
    app.get("/mcp", async (req, res) => {
      const acceptHeader = req.headers.accept || "";
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // If existing session, delegate to StreamableHTTP transport
      if (sessionId && this.transports.has(sessionId)) {
        const transport = this.transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // If client accepts SSE (text/event-stream), use SSE transport
      // This handles OpenCode's remote MCP client which sends GET with Accept: text/event-stream
      if (acceptHeader.includes("text/event-stream")) {
        try {
          const server = this.createMcpServer();
          const transport = new SSEServerTransport("/messages", res);
          this.sseTransports.set(transport.sessionId, transport);

          transport.onclose = () => {
            this.sseTransports.delete(transport.sessionId);
          };

          // Note: server.connect() already calls transport.start() internally.
          await server.connect(transport);
          console.log(`[OpenCOOP] SSE session established: ${transport.sessionId}`);
        } catch (err) {
          console.log("Error establishing SSE:", err instanceof Error ? err.message : String(err));
          if (!res.headersSent) {
            res.status(500).json({ error: "SSE connection failed" });
          }
        }
        return;
      }

      // Default: try StreamableHTTP (stateless mode)
      if (!sessionId) {
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          const freshServer = this.createMcpServer();
          await freshServer.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } catch (err) {
          console.log("Error handling MCP GET (stateless):", err instanceof Error ? err.message : String(err));
          if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
          }
        }
        return;
      }

      res.status(400).json({ error: "Bad Request: No valid session ID" });
    });

    // Delete session
    app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && this.transports.has(sessionId)) {
        const transport = this.transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Stateless mode or invalid session — delegate to SDK for proper response
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const freshServer = this.createMcpServer();
        await freshServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.log("Error handling MCP DELETE:", err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
          });
        }
      }
    });

    // Backward compat: invite links were previously at /invite/:token (root).
    // The Web UI now lives at /ui, so redirect old links.
    app.get("/invite/:token", (req, res) => res.redirect(`/ui/invite/${req.params.token}`));

    // Web UI - mounted at /ui to avoid SPA fallback intercepting MCP endpoints
    // ensureTunnel lets the UI start the tunnel on-demand (e.g. user switches to HOST mode at runtime)
    const webApp = await createWebUI(
      this.config,
      () => this.tunnelManager?.getUrl() || null,
      () => this.ensureTunnel()
    );
    app.use("/ui", webApp);
    app.get("/", (_req, res) => res.redirect("/ui/"));

    return new Promise((resolve, reject) => {
      this.httpServer = app.listen(port, '0.0.0.0', async () => {
        logger.info(`OpenCOOP server listening on 0.0.0.0:${port}`);

        // Start Cloudflare Tunnel AFTER server is listening
        if (this.config.mode === "host") {
          await this.ensureTunnel();
        }

        resolve();
      });
      this.httpServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`Port ${port} is already in use`);
        } else {
          console.log("HTTP server error:", err.message);
        }
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    // Drop any host proxy connection
    try {
      await closeProxy();
    } catch {}
    // Stop Cloudflare tunnel
    if (this.tunnelManager) {
      this.tunnelManager.stop();
      this.tunnelManager = null;
    }

    stopAutoSave();

    for (const [sid, transport] of this.transports) {
      try {
        await transport.close();
      } catch {
        // Ignore
      }
    }
    this.transports.clear();

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    const { saveDatabase, closeDatabase } = await import("../utils/database.js");
    try {
      await saveDatabase();
      await closeDatabase();
    } catch {
      // Ignore close errors
    }
  }

  getTunnelUrl(): string | null {
    return this.tunnelManager?.getUrl() || null;
  }

  /** Start the SSH tunnel if not already running. Safe to call multiple times. */
  async ensureTunnel(): Promise<string | null> {
    if (this.tunnelManager?.getUrl()) return this.tunnelManager.getUrl();
    if (!this.tunnelManager) this.tunnelManager = new TunnelManager();
    try {
      const tunnelUrl = await this.tunnelManager.start(this.config.port);
      console.log(`[OpenCOOP] Tunnel active: ${tunnelUrl}`);
      return tunnelUrl;
    } catch (err) {
      console.log("[OpenCOOP] Tunnel failed:", (err as Error).message);
      console.log("[OpenCOOP] Invite links will use local IP (may not work with VPN)");
      return null;
    }
  }
}
