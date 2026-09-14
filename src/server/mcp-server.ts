import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

export class OpenCOOPServer {
  private config: ServerConfig;
  private fileManager!: FileManager;
  private lockManager!: LockManager;
  private changeTracker!: ChangeTracker;
  private authManager!: AuthManager;
  private sessionManager!: SessionManager;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private httpServer: any = null;

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
      logger.error("Error initializing managers: %s", error instanceof Error ? error.message : String(error));
    }
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: "opencoop",
      version: "1.0.0",
    });

    this.registerFileTools(server);
    this.registerLockTools(server);
    this.registerMonitoringTools(server);
    this.registerTeamTools(server);

    return server;
  }

  private registerFileTools(server: McpServer) {
    server.tool(
      "read_file",
      "Read the contents of a file in the shared project. Use this to view code, configs, or any text file.",
      {
        path: z.string().describe("Relative file path from project root"),
        start_line: z.number().optional().describe("Start line number (1-based)"),
        end_line: z.number().optional().describe("End line number (1-based)"),
      },
      async ({ path, start_line, end_line }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const content = await this.fileManager.readFile(path, {
          startLine: start_line,
          endLine: end_line,
        });
        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          action: "read",
        });
        return {
          content: [{ type: "text" as const, text: content }],
        };
      }
    );

    server.tool(
      "write_file",
      "Create or overwrite a file in the shared project. This will be tracked in the audit log.",
      {
        path: z.string().describe("Relative file path from project root"),
        content: z.string().describe("Full file content to write"),
        create_dirs: z.boolean().optional().describe("Create parent directories if they do not exist"),
      },
      async ({ path, content, create_dirs }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        await this.fileManager.writeFile(path, content, { createDirs: create_dirs });
        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          action: "update",
          newContentHash: await this.fileManager.hash(path),
        });
        return {
          content: [{ type: "text" as const, text: `File written successfully: ${path}` }],
        };
      }
    );

    server.tool(
      "edit_file",
      "Make a targeted edit to a file using search and replace. Preferred over write_file for modifying existing files.",
      {
        path: z.string().describe("Relative file path"),
        search: z.string().describe("Exact text to find (must be unique in file)"),
        replace: z.string().describe("Text to replace with"),
        replace_all: z.boolean().optional().describe("Replace all occurrences (default: false)"),
      },
      async ({ path, search, replace, replace_all }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
        const oldHash = await this.fileManager.hash(path);
        const result = await this.fileManager.editFile(path, search, replace, {
          replaceAll: replace_all,
        });
        const newHash = await this.fileManager.hash(path);

        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          action: "update",
          oldContentHash: oldHash,
          newContentHash: newHash,
          metadata: JSON.stringify({ changes: result.changes }),
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
      },
      async ({ path, reason }) => {
        const userId = "user-" + randomUUID().slice(0, 8);
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

  private registerTeamTools(server: McpServer) {
    server.tool(
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

  async startHttp(port: number): Promise<void> {
    await this.initialize();

    const app = express();
    app.use(express.json());
    app.use(cors({ origin: true }));

    app.get("/health", (req, res) => {
      res.json({ status: "ok", version: "1.0.0" });
    });

    app.post("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports.has(sessionId)) {
          transport = this.transports.get(sessionId)!;
        } else if (!sessionId) {
          const server = this.createMcpServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          await server.connect(transport);

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) this.transports.delete(sid);
          };

          await transport.handleRequest(req, res, req.body);
          // sessionId is generated by the SDK while handling the
          // initialize request, so (re)register under the final id now.
          if (transport.sessionId) {
            this.transports.set(transport.sessionId, transport);
          }
          return;
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID" },
            id: req.body?.id,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error("Error handling MCP request: %s", error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: req.body?.id,
          });
        }
      }
    });

    // SSE endpoint for server-initiated messages
    app.get("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
        });
        return;
      }
      const transport = this.transports.get(sessionId);
      await transport!.handleRequest(req, res, req.body);
    });

    // Delete session
    app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.transports.has(sessionId)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
        });
        return;
      }
      const transport = this.transports.get(sessionId);
      await transport!.handleRequest(req, res, req.body);
    });

    // Web UI routes
    const webApp = await createWebUI(this.config);
    app.use(webApp);

    return new Promise((resolve, reject) => {
      this.httpServer = app.listen(port, '0.0.0.0', () => {
        logger.info(`OpenCOOP server listening on 0.0.0.0:${port}`);
        resolve();
      });
      this.httpServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          logger.error(`Port ${port} is already in use`);
        } else {
          logger.error("HTTP server error: %s", err.message);
        }
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
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
}
