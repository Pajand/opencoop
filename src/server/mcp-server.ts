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

    this.registerFileTools(server);
    this.registerLockTools(server);
    this.registerMonitoringTools(server);
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
    ];
  }

  private async callTool(name: string, args: any): Promise<string> {
    const userId = "user-" + randomUUID().slice(0, 8);
    try {
      switch (name) {
        case "read_file":
          return await this.fileManager.readFile(args.path, { startLine: args.start_line, endLine: args.end_line });
        case "write_file":
          await this.fileManager.writeFile(args.path, args.content, { createDirs: args.create_dirs });
          await this.changeTracker.logChange({ workspaceId: this.config.workspacePath, filePath: args.path, userId, action: "update", newContentHash: await this.fileManager.hash(args.path) });
          return `File written successfully: ${args.path}`;
        case "edit_file": {
          const oldHash = await this.fileManager.hash(args.path);
          const result = await this.fileManager.editFile(args.path, args.search, args.replace, { replaceAll: args.replace_all });
          const newHash = await this.fileManager.hash(args.path);
          await this.changeTracker.logChange({ workspaceId: this.config.workspacePath, filePath: args.path, userId, action: "update", oldContentHash: oldHash, newContentHash: newHash, metadata: JSON.stringify({ changes: result.changes }) });
          return `Edit applied: ${result.changes} occurrence(s) replaced in ${args.path}`;
        }
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
      res.json({ url: this.tunnelManager?.getUrl() || null, ...(this.tunnelManager?.getStatus() || { starting: false, error: null }) });
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

  /** Start the Cloudflare tunnel if not already running. Safe to call multiple times. */
  async ensureTunnel(): Promise<string | null> {
    if (this.tunnelManager?.getUrl()) return this.tunnelManager.getUrl();
    if (!this.tunnelManager) this.tunnelManager = new TunnelManager();
    try {
      const tunnelUrl = await this.tunnelManager.start();
      console.log(`[OpenCOOP] Cloudflare tunnel active: ${tunnelUrl}`);
      return tunnelUrl;
    } catch (err) {
      console.log("[OpenCOOP] Tunnel failed:", (err as Error).message);
      console.log("[OpenCOOP] Invite links will use local IP (may not work with VPN)");
      return null;
    }
  }
}
