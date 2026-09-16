#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "crypto";
import { z } from "zod";

import { FileManager } from "./filesystem/file-manager.js";
import { LockManager } from "./filesystem/lock-manager.js";
import { ChangeTracker } from "./filesystem/change-tracker.js";
import { AuthManager } from "./auth/auth-manager.js";
import { SessionManager } from "./auth/session-manager.js";
import { logger } from "./utils/logger.js";
import { loadConfig } from "./utils/config.js";
import { initDatabase, startAutoSave } from "./utils/database.js";
import { createWebUI } from "./web/server.js";
import express from "express";
import cors from "cors";
import net from "net";

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function main() {
  const config = await loadConfig();

  await initDatabase(config.databasePath);
  startAutoSave();

  const fileManager = new FileManager(config.workspacePath);
  const lockManager = new LockManager();
  const changeTracker = new ChangeTracker();
  const authManager = new AuthManager(config.jwtSecret);
  const sessionManager = new SessionManager();

  try {
    await lockManager.initialize();
    await changeTracker.initialize();
    await authManager.initialize();
    await sessionManager.initialize();
    logger.info("All managers initialized");
  } catch (error) {
    console.log("Error initializing managers:", error instanceof Error ? error.message : String(error));
  }

  const mcpServer = new McpServer({
    name: "opencoop",
    version: "1.0.0",
  });

  // File tools
  mcpServer.tool(
    "read_file",
    "Read the contents of a file in the shared project.",
    {
      path: z.string().describe("Relative file path from project root"),
      start_line: z.number().optional().describe("Start line number (1-based)"),
      end_line: z.number().optional().describe("End line number (1-based)"),
    },
    async ({ path, start_line, end_line }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      const content = await fileManager.readFile(path, {
        startLine: start_line,
        endLine: end_line,
      });
      await changeTracker.logChange({
        workspaceId: config.workspacePath,
        filePath: path,
        userId,
        action: "read",
      });
      return {
        content: [{ type: "text" as const, text: content }],
      };
    }
  );

  mcpServer.tool(
    "write_file",
    "Create or overwrite a file in the shared project.",
    {
      path: z.string().describe("Relative file path from project root"),
      content: z.string().describe("Full file content to write"),
      create_dirs: z.boolean().optional().describe("Create parent directories if they do not exist"),
    },
    async ({ path, content, create_dirs }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      await changeTracker.snapshotBeforeChange(config.workspacePath, path, config.userName || userId);
      await fileManager.writeFile(path, content, { createDirs: create_dirs });
      await changeTracker.logChange({
        workspaceId: config.workspacePath,
        filePath: path,
        userId,
        action: "update",
        newContentHash: await fileManager.hash(path),
      });
      return {
        content: [{ type: "text" as const, text: `File written successfully: ${path} (previous version snapshotted)` }],
      };
    }
  );

  mcpServer.tool(
    "edit_file",
    "Make a targeted edit to a file using search and replace.",
    {
      path: z.string().describe("Relative file path"),
      search: z.string().describe("Exact text to find"),
      replace: z.string().describe("Text to replace with"),
      replace_all: z.boolean().optional().describe("Replace all occurrences"),
    },
    async ({ path, search, replace, replace_all }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      const oldHash = await fileManager.hash(path);
      await changeTracker.snapshotBeforeChange(config.workspacePath, path, config.userName || userId);
      const result = await fileManager.editFile(path, search, replace, {
        replaceAll: replace_all,
      });
      const newHash = await fileManager.hash(path);
      await changeTracker.logChange({
        workspaceId: config.workspacePath,
        filePath: path,
        userId,
        action: "update",
        oldContentHash: oldHash,
        newContentHash: newHash,
        metadata: JSON.stringify({ changes: result.changes }),
      });
      return {
        content: [{ type: "text" as const, text: `Edit applied: ${result.changes} occurrence(s) replaced in ${path}` }],
      };
    }
  );

  mcpServer.tool(
    "list_files",
    "List files and directories in the shared project.",
    {
      path: z.string().optional().describe("Directory path (default: project root)"),
      recursive: z.boolean().optional().describe("List recursively"),
    },
    async ({ path, recursive }) => {
      const files = await fileManager.listFiles(path || ".", { recursive });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "search_files",
    "Search for files matching a glob pattern.",
    {
      pattern: z.string().describe("Glob pattern"),
      max_results: z.number().optional().describe("Maximum results (default: 50)"),
    },
    async ({ pattern, max_results }) => {
      const results = await fileManager.searchFiles(pattern, { maxResults: max_results });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "grep_content",
    "Search file contents using regex pattern.",
    {
      pattern: z.string().describe("Regex pattern to search for"),
      path: z.string().optional().describe("Directory to search in"),
      include: z.string().optional().describe("File pattern to include"),
    },
    async ({ pattern, path, include }) => {
      const results = await fileManager.grep(pattern, { path, include });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "directory_tree",
    "Get a tree view of the project directory structure.",
    {
      path: z.string().optional().describe("Root path"),
      max_depth: z.number().optional().describe("Maximum depth (default: 3)"),
      exclude: z.array(z.string()).optional().describe("Patterns to exclude"),
    },
    async ({ path, max_depth, exclude }) => {
      const tree = await fileManager.getDirectoryTree(path || ".", {
        maxDepth: max_depth,
        excludePatterns: exclude,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }],
      };
    }
  );

  // Lock tools
  mcpServer.tool(
    "lock_file",
    "Acquire an exclusive lock on a file before editing.",
    {
      path: z.string().describe("File path to lock"),
      reason: z.string().optional().describe("Brief description of what you plan to do"),
    },
    async ({ path, reason }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      const sessionId = randomUUID();
      const result = await lockManager.acquireLock({
        workspaceId: config.workspacePath,
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

  mcpServer.tool(
    "unlock_file",
    "Release a lock on a file after editing.",
    {
      path: z.string().describe("File path to unlock"),
    },
    async ({ path }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      await lockManager.releaseLock(config.workspacePath, path, userId);
      return {
        content: [{ type: "text" as const, text: `Lock released for: ${path}` }],
      };
    }
  );

  mcpServer.tool(
    "list_locks",
    "List all currently active file locks in the project.",
    {},
    async () => {
      const locks = await lockManager.getActiveLocks(config.workspacePath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(locks, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "check_lock",
    "Check if a specific file is currently locked.",
    {
      path: z.string().describe("File path to check"),
    },
    async ({ path }) => {
      const lock = await lockManager.checkLock(config.workspacePath, path);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(lock) }],
      };
    }
  );

  // Monitoring tools
  mcpServer.tool(
    "view_changes",
    "View recent changes made by all team members.",
    {
      file_path: z.string().optional().describe("Filter by specific file"),
      user_id: z.string().optional().describe("Filter by specific user"),
      limit: z.number().optional().describe("Number of changes to show (default: 20)"),
    },
    async ({ file_path, user_id, limit }) => {
      const changes = await changeTracker.getChanges({
        workspaceId: config.workspacePath,
        filePath: file_path,
        userId: user_id,
        limit: limit || 20,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(changes, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "view_stats",
    "View statistics about the project.",
    {},
    async () => {
      const stats = await changeTracker.getStats(config.workspacePath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "who_is_online",
    "See which team members are currently connected.",
    {},
    async () => {
      const online = await sessionManager.getOnlineUsers(config.workspacePath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(online, null, 2) }],
      };
    }
  );

  // Rollback + snapshots + guide
  mcpServer.tool(
    "list_snapshots",
    "List saved previous versions of a shared-project file. Use before rollback_file to pick a version.",
    {
      file_path: z.string().optional().describe("File to list versions for (relative path)"),
      limit: z.number().optional().describe("Max entries (default: 20)"),
    },
    async ({ file_path, limit }) => {
      const snaps = await changeTracker.getSnapshots({
        workspaceId: config.workspacePath,
        filePath: file_path,
        limit: limit || 20,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(snaps, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "rollback_file",
    "UNDO YOUR MISTAKE: restore a shared-project file to a previous version. Pass ONLY path to undo the last change. For a specific version: list_snapshots first, then pass path + snapshot_id. SAFE: current state is snapshotted first, so rollback is reversible.",
    {
      path: z.string().describe("Relative file path to restore"),
      snapshot_id: z.string().optional().describe("Specific version (from list_snapshots). Omit to undo last change."),
      change_id: z.string().optional().describe("Restore to before this change-log entry. Omit to undo last change."),
    },
    async ({ path, snapshot_id, change_id }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      const userName = config.userName || userId;
      const ws = config.workspacePath;
      const result = change_id
        ? await changeTracker.rollbackToChange({ workspaceId: ws, workspacePath: ws, changeId: change_id, userId, userName })
        : snapshot_id
          ? await changeTracker.rollbackToSnapshot({ workspaceId: ws, workspacePath: ws, filePath: path, snapshotId: snapshot_id, userId, userName })
          : await changeTracker.rollbackToLatest({ workspaceId: ws, workspacePath: ws, filePath: path, userId, userName });
      return {
        content: [{ type: "text" as const, text: `Rolled back ${result.filePath} to the version from ${result.restoredFrom}. Reversible — previous state was snapshotted first.` }],
      };
    }
  );

  mcpServer.tool(
    "opencoop_guide",
    "START HERE — call FIRST in every new conversation BEFORE any file work. Explains the shared project and behavior rules.",
    {},
    async () => {
      const { buildGuideText } = await import("./utils/guide.js");
      return {
        content: [{ type: "text" as const, text: buildGuideText({ mode: config.mode, workspacePath: config.workspacePath, userName: config.userName }) }],
      };
    }
  );

  // Team tools
  mcpServer.tool(
    "invite_member",
    "Generate an invite link for a new team member.",
    {
      email: z.string().describe("Email of the person to invite"),
      permissions: z.array(z.enum(["read", "write", "admin"])).describe("Permissions to grant"),
      expires_in_days: z.number().optional().describe("Link expiry in days (default: 7)"),
    },
    async ({ email, permissions, expires_in_days }) => {
      const userId = "user-" + randomUUID().slice(0, 8);
      const link = await authManager.generateInviteLink({
        workspaceId: config.workspacePath,
        email,
        permissions,
        expiresInDays: expires_in_days || 7,
        createdBy: userId,
        port: config.port,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(link) }],
      };
    }
  );

  mcpServer.tool(
    "list_members",
    "List all team members and their permissions.",
    {},
    async () => {
      const members = await authManager.getTeamMembers(config.workspacePath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(members, null, 2) }],
      };
    }
  );

  mcpServer.tool(
    "revoke_access",
    "Revoke a team member's access.",
    {
      user_id: z.string().describe("User ID to revoke"),
      reason: z.string().optional().describe("Reason for revocation"),
    },
    async ({ user_id }) => {
      const ownerId = "owner-" + randomUUID().slice(0, 8);
      await authManager.revokeAccess(config.workspacePath, user_id, ownerId);
      return {
        content: [{ type: "text" as const, text: `Access revoked for user: ${user_id}` }],
      };
    }
  );

  // Start MCP server via stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[OpenCOOP] MCP server started via stdio");

  // Start HTTP server for web UI
  const port = config.port || 31313;
  const portInUse = await isPortInUse(port);
  if (!portInUse) {
    const app = express();
    app.use(express.json());
    app.use(cors({ origin: true }));

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", version: "1.0.0", transport: "stdio" });
    });

    // MCP HTTP endpoints are served by the plugin server (OpenCOOPServer).
    // In stdio mode there is no HTTP MCP transport, so return JSON (never HTML)
    // to make that explicit instead of falling through to the SPA fallback.
    const stdioOnly = (_req: any, res: any) =>
      res.status(503).json({
        error: "MCP HTTP transport not available in stdio mode. The plugin server owns this port when running inside OpenCode.",
      });
    app.get("/sse", stdioOnly);
    app.all("/mcp", stdioOnly);
    app.all("/messages", stdioOnly);

    // Backward compat: invite links were previously at /invite/:token (root).
    // The Web UI now lives at /ui, so redirect old links.
    app.get("/invite/:token", (req, res) => res.redirect(`/ui/invite/${req.params.token}`));

    // Web UI - mounted at /ui (same as plugin server) so the SPA fallback
    // can never shadow MCP/SSE/API routes.
    const webApp = await createWebUI(config);
    app.use("/ui", webApp);
    app.get("/", (_req, res) => res.redirect("/ui/"));

    app.listen(port, '0.0.0.0', () => {
      console.error(`[OpenCOOP] Web UI available at http://localhost:${port}/ui/`);
      logger.info(`Web UI listening on 0.0.0.0:${port}`);
    });
  } else {
    console.error(`[OpenCOOP] Port ${port} already in use - web UI may already be running`);
  }
}

main().catch((error) => {
  console.error("[OpenCOOP] Fatal error:", error);
  process.exit(1);
});
