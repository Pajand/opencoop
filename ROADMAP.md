# OpenCOOP — OpenCode Plugin for Team Collaboration

## Project: Shared MCP Server Plugin for Multi-User OpenCode

### Author: Hamid Pajand
### Started: September 2026
### Architecture: OpenCode Plugin + Streamable HTTP MCP Server

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [How It Works](#2-how-it-works)
3. [System Architecture](#3-system-architecture)
4. [Phase 0: Plugin Foundation](#4-phase-0-plugin-foundation)
5. [Phase 1: MCP Server Core](#5-phase-1-mcp-server-core)
6. [Phase 2: File System Manager](#6-phase-2-file-system-manager)
7. [Phase 3: File Locking & Conflict Prevention](#7-phase-3-file-locking--conflict-prevention)
8. [Phase 4: Authentication & Access Control](#8-phase-4-authentication--access-control)
9. [Phase 5: Change Tracking & Audit Log](#9-phase-5-change-tracking--audit-log)
10. [Phase 6: Web Dashboard](#10-phase-6-web-dashboard)
11. [Phase 7: Invite Link System](#11-phase-7-invite-link-system)
12. [Phase 8: Testing & Security Audit](#12-phase-8-testing--security-audit)
13. [Phase 9: Deployment & Distribution](#13-phase-9-deployment--distribution)
14. [Project Structure](#14-project-structure)
15. [Dependencies](#15-dependencies)
16. [Timeline & Milestones](#16-timeline--milestones)
17. [API Reference](#17-api-reference)
18. [Checklist](#18-checklist)

---

## 1. Executive Summary

### 1.1 What is OpenCOOP?

OpenCOOP is an **OpenCode plugin** that enables multiple team members to collaborate on the same codebase through their individual OpenCode instances. Each team member runs their own OpenCode with their own AI, but they all connect to the **same MCP server** — giving every person's AI direct read/write access to a shared project folder.

### 1.2 The Problem It Solves

Currently, when multiple developers use OpenCode (or similar AI coding tools), each person works in isolation on their own copy of the code. There is no way for:

- Multiple OpenCode instances to share the same project files in real-time
- Team members to see who is editing what
- The project owner to track all changes made by team members
- Conflict prevention when two people edit the same file simultaneously

### 1.3 How It Works (Simple Explanation)

```
Team Member A (Remote)          Team Member B (Remote)
     │                               │
     ▼                               ▼
 OpenCode + AI                    OpenCode + AI
     │                               │
     └───────────┬───────────────────┘
                 │
                 ▼
    ┌────────────────────────┐
    │   OpenCOOP MCP Server  │  ◄── Shared Remote Server
    │   (Streamable HTTP)    │      (runs on owner's machine)
    │   Port 31313           │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │   Shared Project Folder │
    │   /path/to/project     │
    └────────────────────────┘
```

**The flow:**
1. **Owner** installs OpenCOOP plugin globally
2. **Owner** adds plugin to `opencode.json` plugin array (ONE TIME)
3. **Owner** restarts OpenCode — plugin auto-registers MCP server on port 31313
4. **Owner** opens web UI, chooses HOST mode, selects project folder
5. **Owner** generates invite link, shares with team members
6. **Team members** install plugin, add to their `opencode.json`, restart OpenCode
7. **Team members** open web UI, choose REMOTE mode, paste host's link
8. **All changes** are tracked, logged, and visible to the owner
9. **File locking** prevents two people from editing the same file at the same time

### 1.4 Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Transport | Streamable HTTP | Multiple concurrent clients over network |
| Integration | OpenCode Plugin | Auto-runs on OpenCode startup, no manual server management |
| Database | SQLite (WAL mode) | Simple deployment, concurrent reads, no external deps |
| Auth | Bearer Token | Simple, works with OpenCode `headers` config |
| File Locking | Hash-based optimistic + exclusive locks | Prevents lost updates |
| Web UI | Built-in Express server | Single process, port 31313 |
| Port | 31313 | Fixed port for consistency |

---

## 2. How It Works

### 2.1 The Plugin Model

OpenCOOP runs as an **OpenCode plugin**, not a standalone server. This means:

- **Auto-runs** when OpenCode starts
- **No separate process** to manage
- **Single command** to install (`npm install -g opencoop`)
- **One config entry** in `opencode.json` plugin array

### 2.2 OpenCode Plugin Registration

After installation, the user adds ONE line to their `opencode.json`:

```json
{
  "plugin": ["@opencoop/opencode-plugin"]
}
```

That's it. The plugin handles everything else automatically.

### 2.3 What Happens on Startup

When OpenCode starts with the plugin installed:

1. Plugin's `config` hook fires
2. Plugin starts HTTP server on port 31313
3. Plugin serves web UI at `http://localhost:31313`
4. Web UI shows HOST/REMOTE mode selection
5. User configures mode via web UI
6. If HOST: selects folder, gets invite link
7. If REMOTE: enters host's link to connect

### 2.4 What the AI Can Do

Once connected, each team member's AI has access to these MCP tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read any file in the project |
| `write_file` | Create or overwrite a file |
| `edit_file` | Make surgical edits (search & replace) |
| `list_files` | List directory contents |
| `search_files` | Search files by glob pattern |
| `grep_content` | Search file contents by regex |
| `directory_tree` | Get folder structure overview |
| `lock_file` | Acquire exclusive lock before editing |
| `unlock_file` | Release lock after editing |
| `view_changes` | View recent changes by all team members |
| `who_is_online` | See who is currently connected |

### 2.5 Conflict Prevention

When two AIs try to edit the same file:

1. **AI-A** calls `lock_file("src/app.ts")` → lock granted
2. **AI-B** calls `lock_file("src/app.ts")` → lock blocked with message: "File locked by Team Member A, editing auth module"
3. **AI-B** waits or works on a different file
4. **AI-A** finishes, calls `unlock_file("src/app.ts")`
5. **AI-B** can now acquire the lock

### 2.6 Change Tracking

Every file operation is logged:

```json
{
  "id": "uuid",
  "workspace_id": "ws_123",
  "file_path": "src/app.ts",
  "user_id": "user_456",
  "user_name": "Alice",
  "action": "edit",
  "timestamp": "2026-09-13T10:30:00Z",
  "old_content_hash": "abc123...",
  "new_content_hash": "def456...",
  "changes_summary": "Modified authenticate() function"
}
```

The owner can view all changes through the web dashboard or via MCP tools.

---

## 3. System Architecture

### 3.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OpenCOOP System                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              OpenCode Plugin Layer                           │   │
│  │  plugin() → config hook → starts HTTP server                │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌──────────────────────────▼──────────────────────────────────┐   │
│  │              Streamable HTTP Transport Layer                 │   │
│  │  POST /mcp  ←→  GET /mcp (SSE)  ←→  Session Management    │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌──────────────────────────▼──────────────────────────────────┐   │
│  │                    MCP Protocol Layer                        │   │
│  │  Tools: read_file, write_file, edit_file, lock_file, ...    │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌──────────────────────────▼──────────────────────────────────┐   │
│  │                  Business Logic Layer                        │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐    │   │
│  │  │ File Manager │ │ Lock Manager │ │ Change Tracker     │    │   │
│  │  └─────────────┘ └──────────────┘ └───────────────────┘    │   │
│  │  ┌─────────────┐ ┌──────────────┐                           │   │
│  │  │ Auth Manager │ │ Invite System │                           │   │
│  │  └─────────────┘ └──────────────┘                           │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│  ┌──────────────────────────▼──────────────────────────────────┐   │
│  │                    Data Layer                                 │   │
│  │  ┌─────────────┐ ┌──────────────┐                           │   │
│  │  │ SQLite (WAL) │ │ Filesystem   │                           │   │
│  │  └─────────────┘ └──────────────┘                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Web Dashboard                             │   │
│  │  Express server on port 31313                                │   │
│  │  - HOST/REMOTE mode selection                                │   │
│  │  - Folder selection (HOST)                                   │   │
│  │  - Invite link generation                                    │   │
│  │  - Change timeline                                           │   │
│  │  - Team management                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Transport: Why Streamable HTTP?

| Transport | Concurrency | Network | Use Case |
|-----------|-------------|---------|----------|
| stdio | 1 client per process | No (local) | Local tools, IDE plugins |
| **Streamable HTTP** | **Multiple clients** | **Yes** | **Shared servers, team collaboration** |

Streamable HTTP is the correct choice because:
- Multiple team members connect simultaneously over the network
- Each gets their own session via `Mcp-Session-Id`
- Server can push notifications via SSE (e.g., "file X was just modified")
- Standard HTTP authentication (Bearer tokens) works naturally

### 3.3 Database Schema (SQLite with WAL)

```sql
-- Users table
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'member',  -- owner, admin, member, viewer
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Workspaces (shared project folders)
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    mode TEXT DEFAULT 'host',  -- host or remote
    host_url TEXT,
    invite_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Team members
CREATE TABLE team_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    permissions TEXT DEFAULT 'read,write',
    invited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Invite links
CREATE TABLE invite_links (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    email TEXT,
    permissions TEXT DEFAULT 'read,write',
    expires_at DATETIME,
    max_uses INTEGER,
    use_count INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- File locks
CREATE TABLE file_locks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    lock_type TEXT DEFAULT 'exclusive',  -- exclusive, shared
    acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    reason TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Change audit log
CREATE TABLE change_logs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,  -- create, read, update, delete, move
    old_content_hash TEXT,
    new_content_hash TEXT,
    old_path TEXT,
    new_path TEXT,
    metadata TEXT,  -- JSON string
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Active sessions (for online user tracking)
CREATE TABLE active_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    mcp_session_id TEXT UNIQUE,
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Enable WAL mode
PRAGMA journal_mode=WAL;
```

---

## 4. Phase 0: Plugin Foundation

### 4.1 Prerequisites

```bash
# Node.js 18+
node --version  # Should be v18.x or higher

# pnpm (fast package manager)
npm install -g pnpm

# TypeScript
npm install -g typescript

# tsx (for running TypeScript directly)
npm install -g tsx
```

### 4.2 Initialize Project

```bash
cd /storage/emulated/0/coopmcp
pnpm init
```

### 4.3 package.json

```json
{
  "name": "@opencoop/opencode-plugin",
  "version": "1.0.0",
  "description": "OpenCode plugin for team collaboration via shared MCP server",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "keywords": ["mcp", "opencode", "plugin", "collaboration", "shared", "team"],
  "author": "Hamid Pajand",
  "license": "MIT",
  "peerDependencies": {
    "@opencode-ai/plugin": ">=0.1.0"
  }
}
```

### 4.4 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 4.5 Install Dependencies

```bash
# Core MCP SDK
pnpm add @modelcontextprotocol/server zod

# HTTP server
pnpm add express cors helmet

# Database
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3

# Auth & Security
pnpm add bcrypt jsonwebtoken nanoid
pnpm add -D @types/bcrypt @types/jsonwebtoken

# Logging
pnpm add pino pino-pretty

# Utilities
pnpm add dotenv chalk commander

# OpenCode Plugin SDK
pnpm add -D @opencode-ai/plugin

# Dev tools
pnpm add -D typescript @types/node @types/express @types/cors
pnpm add -D vitest supertest @types/supertest
pnpm add -D tsx eslint prettier
```

### 4.6 Environment Variables

```bash
# .env
NODE_ENV=development
PORT=31313
DATABASE_URL=./data/opencoop.db
JWT_SECRET=change-this-to-a-random-secret
LOG_LEVEL=info
```

---

## 5. Phase 1: MCP Server Core

### 5.1 Plugin Entry Point

**File: `src/index.ts`**

```typescript
import { plugin } from "@opencode-ai/plugin";
import { createServer } from "./server/mcp-server.js";
import { loadConfig, saveConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { startWebUI } from "./web/server.js";

export default plugin({
  name: "opencoop",
  description: "OpenCode plugin for team collaboration via shared MCP server",

  hooks: {
    config: async (input) => {
      logger.info("OpenCOOP plugin loading...");

      // Load saved configuration
      const config = await loadConfig(input.project);

      // Start the MCP server on port 31313
      const server = createServer(config);
      await server.startHttp(31313);

      // Start the web UI
      await startWebUI(31313, config);

      logger.info("OpenCOOP plugin ready on port 31313");

      // Return config modifications if needed
      return input.config;
    },
  },
});
```

### 5.2 MCP Server Class

**File: `src/server/mcp-server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/streamableHttp";
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

export interface ServerConfig {
  port: number;
  workspacePath: string;
  jwtSecret: string;
  databasePath: string;
  mode: "host" | "remote";
  hostUrl?: string;
  inviteToken?: string;
}

export class OpenCOOPServer {
  private config: ServerConfig;
  private fileManager: FileManager;
  private lockManager: LockManager;
  private changeTracker: ChangeTracker;
  private authManager: AuthManager;
  private sessionManager: SessionManager;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();

  constructor(config: ServerConfig) {
    this.config = config;
    this.fileManager = new FileManager(config.workspacePath);
    this.lockManager = new LockManager(config.databasePath);
    this.changeTracker = new ChangeTracker(config.databasePath);
    this.authManager = new AuthManager(config.jwtSecret);
    this.sessionManager = new SessionManager();
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({
      name: "opencoop",
      version: "1.0.0",
    });

    // Register all MCP tools
    this.registerFileTools(server);
    this.registerLockTools(server);
    this.registerMonitoringTools(server);
    this.registerTeamTools(server);

    return server;
  }

  private registerFileTools(server: McpServer) {
    // READ FILE
    server.registerTool(
      "read_file",
      {
        description: "Read the contents of a file in the shared project. Use this to view code, configs, or any text file.",
        inputSchema: z.object({
          path: z.string().describe("Relative file path from project root"),
          start_line: z.number().optional().describe("Start line number (1-based)"),
          end_line: z.number().optional().describe("End line number (1-based)"),
        }),
      },
      async ({ path, start_line, end_line }, context) => {
        const userId = this.extractUserId(context);
        const content = await this.fileManager.readFile(path, { startLine: start_line, endLine: end_line });
        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          action: "read",
        });
        return {
          content: [{ type: "text", text: content }],
        };
      }
    );

    // WRITE FILE
    server.registerTool(
      "write_file",
      {
        description: "Create or overwrite a file in the shared project. This will be tracked in the audit log.",
        inputSchema: z.object({
          path: z.string().describe("Relative file path from project root"),
          content: z.string().describe("Full file content to write"),
          create_dirs: z.boolean().optional().describe("Create parent directories if they do not exist"),
        }),
      },
      async ({ path, content, create_dirs }, context) => {
        const userId = this.extractUserId(context);
        await this.fileManager.writeFile(path, content, { createDirs: create_dirs });
        await this.changeTracker.logChange({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          action: "update",
          newContentHash: await this.fileManager.hash(path),
        });
        return {
          content: [{ type: "text", text: `File written successfully: ${path}` }],
        };
      }
    );

    // EDIT FILE (search & replace)
    server.registerTool(
      "edit_file",
      {
        description: "Make a targeted edit to a file using search and replace. Preferred over write_file for modifying existing files.",
        inputSchema: z.object({
          path: z.string().describe("Relative file path"),
          search: z.string().describe("Exact text to find (must be unique in file)"),
          replace: z.string().describe("Text to replace with"),
          replace_all: z.boolean().optional().describe("Replace all occurrences (default: false)"),
        }),
      },
      async ({ path, search, replace, replace_all }, context) => {
        const userId = this.extractUserId(context);
        const oldHash = await this.fileManager.hash(path);
        const result = await this.fileManager.editFile(path, search, replace, { replaceAll: replace_all });
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
          content: [{ type: "text", text: `Edit applied: ${result.changes} occurrence(s) replaced in ${path}` }],
        };
      }
    );

    // LIST FILES
    server.registerTool(
      "list_files",
      {
        description: "List files and directories in the shared project.",
        inputSchema: z.object({
          path: z.string().optional().describe("Directory path (default: project root)"),
          recursive: z.boolean().optional().describe("List recursively"),
        }),
      },
      async ({ path, recursive }) => {
        const files = await this.fileManager.listFiles(path || ".", { recursive });
        return {
          content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
        };
      }
    );

    // SEARCH FILES
    server.registerTool(
      "search_files",
      {
        description: "Search for files matching a glob pattern.",
        inputSchema: z.object({
          pattern: z.string().describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.js')"),
          max_results: z.number().optional().describe("Maximum results (default: 50)"),
        }),
      },
      async ({ pattern, max_results }) => {
        const results = await this.fileManager.searchFiles(pattern, { maxResults: max_results });
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }
    );

    // GREP CONTENT
    server.registerTool(
      "grep_content",
      {
        description: "Search file contents using regex pattern.",
        inputSchema: z.object({
          pattern: z.string().describe("Regex pattern to search for"),
          path: z.string().optional().describe("Directory to search in (default: project root)"),
          include: z.string().optional().describe("File pattern to include (e.g., '*.ts')"),
        }),
      },
      async ({ pattern, path, include }) => {
        const results = await this.fileManager.grep(pattern, { path, include });
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }
    );

    // DIRECTORY TREE
    server.registerTool(
      "directory_tree",
      {
        description: "Get a tree view of the project directory structure.",
        inputSchema: z.object({
          path: z.string().optional().describe("Root path (default: project root)"),
          max_depth: z.number().optional().describe("Maximum depth (default: 3)"),
          exclude: z.array(z.string()).optional().describe("Patterns to exclude"),
        }),
      },
      async ({ path, max_depth, exclude }) => {
        const tree = await this.fileManager.getDirectoryTree(path || ".", { maxDepth: max_depth, excludePatterns: exclude });
        return {
          content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
        };
      }
    );
  }

  private registerLockTools(server: McpServer) {
    // LOCK FILE
    server.registerTool(
      "lock_file",
      {
        description: "Acquire an exclusive lock on a file before editing. Prevents other users from editing the same file simultaneously.",
        inputSchema: z.object({
          path: z.string().describe("File path to lock"),
          reason: z.string().optional().describe("Brief description of what you plan to do"),
        }),
      },
      async ({ path, reason }, context) => {
        const userId = this.extractUserId(context);
        const sessionId = this.extractSessionId(context);

        const result = await this.lockManager.acquireLock({
          workspaceId: this.config.workspacePath,
          filePath: path,
          userId,
          sessionId,
          reason,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }
    );

    // UNLOCK FILE
    server.registerTool(
      "unlock_file",
      {
        description: "Release a lock on a file after editing.",
        inputSchema: z.object({
          path: z.string().describe("File path to unlock"),
        }),
      },
      async ({ path }, context) => {
        const userId = this.extractUserId(context);
        await this.lockManager.releaseLock(this.config.workspacePath, path, userId);
        return {
          content: [{ type: "text", text: `Lock released for: ${path}` }],
        };
      }
    );

    // LIST LOCKS
    server.registerTool(
      "list_locks",
      {
        description: "List all currently active file locks in the project.",
        inputSchema: z.object({}),
      },
      async () => {
        const locks = await this.lockManager.getActiveLocks(this.config.workspacePath);
        return {
          content: [{ type: "text", text: JSON.stringify(locks, null, 2) }],
        };
      }
    );

    // CHECK LOCK
    server.registerTool(
      "check_lock",
      {
        description: "Check if a specific file is currently locked and by whom.",
        inputSchema: z.object({
          path: z.string().describe("File path to check"),
        }),
      },
      async ({ path }) => {
        const lock = await this.lockManager.checkLock(this.config.workspacePath, path);
        return {
          content: [{ type: "text", text: JSON.stringify(lock) }],
        };
      }
    );
  }

  private registerMonitoringTools(server: McpServer) {
    // VIEW CHANGES
    server.registerTool(
      "view_changes",
      {
        description: "View recent changes made by all team members in the project.",
        inputSchema: z.object({
          file_path: z.string().optional().describe("Filter by specific file"),
          user_id: z.string().optional().describe("Filter by specific user"),
          limit: z.number().optional().describe("Number of changes to show (default: 20)"),
        }),
      },
      async ({ file_path, user_id, limit }) => {
        const changes = await this.changeTracker.getChanges({
          workspaceId: this.config.workspacePath,
          filePath: file_path,
          userId: user_id,
          limit: limit || 20,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(changes, null, 2) }],
        };
      }
    );

    // VIEW STATS
    server.registerTool(
      "view_stats",
      {
        description: "View statistics about the project: total files, changes per user, recent activity.",
        inputSchema: z.object({}),
      },
      async () => {
        const stats = await this.changeTracker.getStats(this.config.workspacePath);
        return {
          content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
        };
      }
    );

    // WHO IS ONLINE
    server.registerTool(
      "who_is_online",
      {
        description: "See which team members are currently connected to this project.",
        inputSchema: z.object({}),
      },
      async () => {
        const online = await this.sessionManager.getOnlineUsers(this.config.workspacePath);
        return {
          content: [{ type: "text", text: JSON.stringify(online, null, 2) }],
        };
      }
    );
  }

  private registerTeamTools(server: McpServer) {
    // INVITE MEMBER (owner only)
    server.registerTool(
      "invite_member",
      {
        description: "Generate an invite link for a new team member. Only the project owner can use this.",
        inputSchema: z.object({
          email: z.string().describe("Email of the person to invite"),
          permissions: z.array(z.enum(["read", "write", "admin"])).describe("Permissions to grant"),
          expires_in_days: z.number().optional().describe("Link expiry in days (default: 7)"),
        }),
      },
      async ({ email, permissions, expires_in_days }, context) => {
        const userId = this.extractUserId(context);
        const link = await this.authManager.generateInviteLink({
          workspaceId: this.config.workspacePath,
          email,
          permissions,
          expiresInDays: expires_in_days || 7,
          createdBy: userId,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(link) }],
        };
      }
    );

    // LIST MEMBERS
    server.registerTool(
      "list_members",
      {
        description: "List all team members and their permissions.",
        inputSchema: z.object({}),
      },
      async () => {
        const members = await this.authManager.getTeamMembers(this.config.workspacePath);
        return {
          content: [{ type: "text", text: JSON.stringify(members, null, 2) }],
        };
      }
    );

    // REVOKE ACCESS
    server.registerTool(
      "revoke_access",
      {
        description: "Revoke a team member's access. Only the project owner can use this.",
        inputSchema: z.object({
          user_id: z.string().describe("User ID to revoke"),
          reason: z.string().optional().describe("Reason for revocation"),
        }),
      },
      async ({ user_id, reason }, context) => {
        const ownerId = this.extractUserId(context);
        await this.authManager.revokeAccess(this.config.workspacePath, user_id, ownerId, reason);
        return {
          content: [{ type: "text", text: `Access revoked for user: ${user_id}` }],
        };
      }
    );
  }

  private extractUserId(context: any): string {
    return context?.userId || "anonymous";
  }

  private extractSessionId(context: any): string {
    return context?.sessionId || randomUUID();
  }

  async startHttp(port: number) {
    const app = express();
    app.use(express.json());
    app.use(cors({ origin: true }));

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok", version: "1.0.0" });
    });

    // MCP endpoint
    app.post("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports.has(sessionId)) {
          transport = this.transports.get(sessionId)!;
        } else if (!sessionId) {
          // New session
          const server = this.createMcpServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
              logger.info(`New MCP session: ${sessionId}`);
              this.transports.set(sessionId, transport);
            },
          });

          server.server.onclose = () => {
            const sid = transport.sessionId;
            if (sid) this.transports.delete(sid);
          };

          await server.connect(transport);
          await transport.handleRequest(req, res);
          return;
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID" },
            id: req.body?.id,
          });
          return;
        }

        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error("Error handling MCP request:", error);
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
      await transport!.handleRequest(req, res);
    });

    app.listen(port, () => {
      logger.info(`OpenCOOP server listening on port ${port}`);
    });
  }
}
```

---

## 6. Phase 2: File System Manager

### 6.1 File Manager

**File: `src/filesystem/file-manager.ts`**

```typescript
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export interface FileMetadata {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: Date;
  createdAt: Date;
}

export class FileManager {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
  }

  // Security: validate that path is within workspace
  private validatePath(relativePath: string): string {
    const resolved = path.resolve(this.workspacePath, relativePath);

    // Prevent path traversal attacks
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Access denied: path "${relativePath}" is outside the workspace`);
    }

    // Reject null bytes
    if (resolved.includes("\0")) {
      throw new Error("Access denied: path contains null bytes");
    }

    return resolved;
  }

  async readFile(
    relativePath: string,
    options?: { startLine?: number; endLine?: number }
  ): Promise<string> {
    const fullPath = this.validatePath(relativePath);

    let content = await fs.readFile(fullPath, "utf-8");

    if (options?.startLine || options?.endLine) {
      const lines = content.split("\n");
      const start = (options.startLine || 1) - 1;
      const end = options.endLine || lines.length;
      content = lines.slice(start, end).join("\n");
    }

    return content;
  }

  async writeFile(
    relativePath: string,
    content: string,
    options?: { createDirs?: boolean }
  ): Promise<void> {
    const fullPath = this.validatePath(relativePath);

    if (options?.createDirs) {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    const tmpPath = fullPath + ".tmp." + Date.now();
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, fullPath);
  }

  async editFile(
    relativePath: string,
    search: string,
    replace: string,
    options?: { replaceAll?: boolean }
  ): Promise<{ changes: number }> {
    const fullPath = this.validatePath(relativePath);
    let content = await fs.readFile(fullPath, "utf-8");
    let changes = 0;

    if (options?.replaceAll) {
      const regex = new RegExp(this.escapeRegExp(search), "g");
      const matches = content.match(regex);
      changes = matches ? matches.length : 0;
      content = content.replace(regex, replace);
    } else {
      if (content.includes(search)) {
        content = content.replace(search, replace);
        changes = 1;
      }
    }

    if (changes > 0) {
      await this.writeFile(relativePath, content);
    }

    return { changes };
  }

  async listFiles(
    relativePath: string = ".",
    options?: { recursive?: boolean }
  ): Promise<FileMetadata[]> {
    const fullPath = this.validatePath(relativePath);
    const results: FileMetadata[] = [];

    const walk = async (dir: string, depth: number = 0) => {
      if (options?.recursive && depth > 10) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const stat = await fs.stat(entryPath);

        results.push({
          name: entry.name,
          path: path.relative(this.workspacePath, entryPath),
          type: entry.isDirectory() ? "directory" : "file",
          size: stat.size,
          modifiedAt: stat.mtime,
          createdAt: stat.birthtime,
        });

        if (entry.isDirectory() && options?.recursive) {
          await walk(entryPath, depth + 1);
        }
      }
    };

    await walk(fullPath);
    return results;
  }

  async searchFiles(
    pattern: string,
    options?: { maxResults?: number }
  ): Promise<string[]> {
    const maxResults = options?.maxResults || 50;
    const results: string[] = [];

    const walk = async (dir: string) => {
      if (results.length >= maxResults) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const entryPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.workspacePath, entryPath);

        if (this.matchesGlob(entry.name, pattern)) {
          results.push(relativePath);
        }

        if (entry.isDirectory()) {
          await walk(entryPath);
        }
      }
    };

    await walk(this.workspacePath);
    return results;
  }

  async grep(
    pattern: string,
    options?: { path?: string; include?: string }
  ): Promise<{ file: string; line: number; content: string }[]> {
    const searchPath = options?.path
      ? this.validatePath(options.path)
      : this.workspacePath;

    const results: { file: string; line: number; content: string }[] = [];
    const regex = new RegExp(pattern, "g");

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(entryPath);
          continue;
        }

        if (options?.include && !this.matchesGlob(entry.name, options.include)) {
          continue;
        }

        try {
          const content = await fs.readFile(entryPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: path.relative(this.workspacePath, entryPath),
                line: i + 1,
                content: lines[i].trim(),
              });
            }
            regex.lastIndex = 0; // Reset regex
          }
        } catch {
          // Skip binary files or files that can't be read
        }
      }
    };

    await walk(searchPath);
    return results;
  }

  async getDirectoryTree(
    relativePath: string = ".",
    options?: { maxDepth?: number; excludePatterns?: string[] }
  ): Promise<any> {
    const fullPath = this.validatePath(relativePath);
    const maxDepth = options?.maxDepth || 3;

    const buildTree = async (dir: string, depth: number): Promise<any> => {
      if (depth > maxDepth) return { name: path.basename(dir), truncated: true };

      const entries = await fs.readdir(dir, { withFileTypes: true });
      const children: any[] = [];

      for (const entry of entries) {
        if (options?.excludePatterns?.some((p) => this.matchesGlob(entry.name, p))) {
          continue;
        }

        const entryPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          children.push({
            name: entry.name,
            type: "directory",
            children: await buildTree(entryPath, depth + 1),
          });
        } else {
          children.push({ name: entry.name, type: "file" });
        }
      }

      return { name: path.basename(dir), type: "directory", children };
    };

    return buildTree(fullPath, 0);
  }

  async hash(relativePath: string): Promise<string> {
    const fullPath = this.validatePath(relativePath);
    const content = await fs.readFile(fullPath);
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private matchesGlob(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      "i"
    );
    return regex.test(filename);
  }
}
```

---

## 7. Phase 3: File Locking & Conflict Prevention

### 7.1 Lock Manager

**File: `src/filesystem/lock-manager.ts`**

```typescript
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export interface LockInfo {
  id: string;
  filePath: string;
  userId: string;
  userName: string;
  reason: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface AcquireLockParams {
  workspaceId: string;
  filePath: string;
  userId: string;
  sessionId: string;
  reason?: string;
}

export class LockManager {
  private db: Database.Database;
  private LOCK_TTL_MINUTES = 30; // Locks expire after 30 minutes

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_locks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        lock_type TEXT DEFAULT 'exclusive',
        reason TEXT,
        acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        UNIQUE(workspace_id, file_path)
      );

      CREATE INDEX IF NOT EXISTS idx_locks_workspace
        ON file_locks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_locks_user
        ON file_locks(user_id);
    `);
  }

  async acquireLock(params: AcquireLockParams): Promise<{
    granted: boolean;
    lock?: LockInfo;
    blockedBy?: LockInfo;
    message: string;
  }> {
    // Clean up expired locks first
    this.cleanupExpiredLocks(params.workspaceId);

    // Check if file is already locked by someone else
    const existingLock = this.db.prepare(`
      SELECT * FROM file_locks
      WHERE workspace_id = ? AND file_path = ? AND user_id != ?
    `).get(params.workspaceId, params.filePath, params.userId) as any;

    if (existingLock) {
      // Check if the lock is still valid (not expired)
      if (new Date(existingLock.expires_at) > new Date()) {
        return {
          granted: false,
          blockedBy: {
            id: existingLock.id,
            filePath: existingLock.file_path,
            userId: existingLock.user_id,
            userName: existingLock.user_id,
            reason: existingLock.reason || "No reason provided",
            acquiredAt: new Date(existingLock.acquired_at),
            expiresAt: new Date(existingLock.expires_at),
          },
          message: `File is locked by another user. Reason: ${existingLock.reason || "Not specified"}`,
        };
      }
    }

    // Remove any existing lock by this user on this file
    this.db.prepare(`
      DELETE FROM file_locks
      WHERE workspace_id = ? AND file_path = ? AND user_id = ?
    `).run(params.workspaceId, params.filePath, params.userId);

    // Acquire new lock
    const lockId = uuidv4();
    const expiresAt = new Date(Date.now() + this.LOCK_TTL_MINUTES * 60 * 1000);

    this.db.prepare(`
      INSERT INTO file_locks (id, workspace_id, file_path, user_id, session_id, reason, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      lockId,
      params.workspaceId,
      params.filePath,
      params.userId,
      params.sessionId,
      params.reason || null,
      expiresAt.toISOString()
    );

    const lock: LockInfo = {
      id: lockId,
      filePath: params.filePath,
      userId: params.userId,
      userName: params.userId,
      reason: params.reason || "",
      acquiredAt: new Date(),
      expiresAt,
    };

    return {
      granted: true,
      lock,
      message: `Lock acquired for: ${params.filePath}`,
    };
  }

  async releaseLock(workspaceId: string, filePath: string, userId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM file_locks
      WHERE workspace_id = ? AND file_path = ? AND user_id = ?
    `).run(workspaceId, filePath, userId);
  }

  async checkLock(workspaceId: string, filePath: string): Promise<LockInfo | null> {
    const lock = this.db.prepare(`
      SELECT * FROM file_locks
      WHERE workspace_id = ? AND file_path = ?
    `).get(workspaceId, filePath) as any;

    if (!lock) return null;

    // Check if expired
    if (new Date(lock.expires_at) <= new Date()) {
      this.db.prepare("DELETE FROM file_locks WHERE id = ?").run(lock.id);
      return null;
    }

    return {
      id: lock.id,
      filePath: lock.file_path,
      userId: lock.user_id,
      userName: lock.user_id,
      reason: lock.reason || "",
      acquiredAt: new Date(lock.acquired_at),
      expiresAt: new Date(lock.expires_at),
    };
  }

  async getActiveLocks(workspaceId: string): Promise<LockInfo[]> {
    this.cleanupExpiredLocks(workspaceId);

    const locks = this.db.prepare(`
      SELECT * FROM file_locks
      WHERE workspace_id = ?
      ORDER BY acquired_at DESC
    `).all(workspaceId) as any[];

    return locks.map((lock) => ({
      id: lock.id,
      filePath: lock.file_path,
      userId: lock.user_id,
      userName: lock.user_id,
      reason: lock.reason || "",
      acquiredAt: new Date(lock.acquired_at),
      expiresAt: new Date(lock.expires_at),
    }));
  }

  private cleanupExpiredLocks(workspaceId: string): void {
    this.db.prepare(`
      DELETE FROM file_locks
      WHERE workspace_id = ? AND expires_at <= ?
    `).run(workspaceId, new Date().toISOString());
  }

  async forceReleaseAll(workspaceId: string): Promise<number> {
    const result = this.db.prepare(`
      DELETE FROM file_locks WHERE workspace_id = ?
    `).run(workspaceId);
    return result.changes;
  }
}
```

---

## 8. Phase 4: Authentication & Access Control

### 8.1 Auth Manager

**File: `src/auth/auth-manager.ts`**

```typescript
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

export class AuthManager {
  private db: Database.Database;
  private jwtSecret: string;

  constructor(dbPath: string, jwtSecret: string) {
    this.db = new Database(dbPath);
    this.jwtSecret = jwtSecret;
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        password_hash TEXT,
        role TEXT DEFAULT 'member',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invite_links (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        email TEXT,
        permissions TEXT DEFAULT 'read,write',
        expires_at DATETIME,
        max_uses INTEGER,
        use_count INTEGER DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        permissions TEXT DEFAULT 'read,write',
        invited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accepted_at DATETIME
      );
    `);
  }

  async validateToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    workspaceId?: string;
    permissions?: string[];
  }> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return {
        valid: true,
        userId: decoded.userId,
        workspaceId: decoded.workspaceId,
        permissions: decoded.permissions,
      };
    } catch {
      return { valid: false };
    }
  }

  async generateInviteLink(params: {
    workspaceId: string;
    email: string;
    permissions: string[];
    expiresInDays: number;
    createdBy: string;
  }): Promise<{
    link: string;
    token: string;
    expiresAt: Date;
  }> {
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000);

    this.db.prepare(`
      INSERT INTO invite_links (id, workspace_id, token, email, permissions, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      params.workspaceId,
      token,
      params.email,
      params.permissions.join(","),
      expiresAt.toISOString(),
      params.createdBy
    );

    return {
      link: `http://localhost:31313/invite/${token}`,
      token,
      expiresAt,
    };
  }

  async validateInviteLink(token: string): Promise<{
    valid: boolean;
    workspaceId?: string;
    permissions?: string[];
    reason?: string;
  }> {
    const link = this.db.prepare(`
      SELECT * FROM invite_links WHERE token = ?
    `).get(token) as any;

    if (!link) return { valid: false, reason: "Link not found" };
    if (link.revoked_at) return { valid: false, reason: "Link revoked" };
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return { valid: false, reason: "Link expired" };
    }
    if (link.max_uses && link.use_count >= link.max_uses) {
      return { valid: false, reason: "Max uses reached" };
    }

    return {
      valid: true,
      workspaceId: link.workspace_id,
      permissions: link.permissions.split(","),
    };
  }

  async acceptInvite(token: string, userId: string): Promise<void> {
    const link = await this.validateInviteLink(token);
    if (!link.valid || !link.workspaceId) {
      throw new Error(link.reason || "Invalid invite link");
    }

    // Add user to team
    this.db.prepare(`
      INSERT OR IGNORE INTO team_members (id, workspace_id, user_id, permissions, accepted_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      link.workspaceId,
      userId,
      link.permissions?.join(","),
      new Date().toISOString()
    );

    // Increment use count
    this.db.prepare(`
      UPDATE invite_links SET use_count = use_count + 1 WHERE token = ?
    `).run(token);
  }

  async getTeamMembers(workspaceId: string): Promise<any[]> {
    return this.db.prepare(`
      SELECT tm.*, u.email, u.name
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE tm.workspace_id = ?
    `).all(workspaceId);
  }

  async revokeAccess(workspaceId: string, userId: string, ownerId: string): Promise<void> {
    // Verify the requester is the owner
    const workspace = this.db.prepare(`
      SELECT * FROM workspaces WHERE id = ? AND owner_id = ?
    `).get(workspaceId, ownerId);

    if (!workspace) {
      throw new Error("Only the workspace owner can revoke access");
    }

    this.db.prepare(`
      DELETE FROM team_members WHERE workspace_id = ? AND user_id = ?
    `).run(workspaceId, userId);
  }
}
```

---

## 9. Phase 5: Change Tracking & Audit Log

### 9.1 Change Tracker

**File: `src/filesystem/change-tracker.ts`**

```typescript
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";

export interface ChangeLogEntry {
  id: string;
  workspaceId: string;
  filePath: string;
  userId: string;
  userName?: string;
  action: "create" | "read" | "update" | "delete" | "move" | "lock" | "unlock";
  oldContentHash?: string;
  newContentHash?: string;
  oldPath?: string;
  newPath?: string;
  metadata?: string;
  timestamp: Date;
}

export class ChangeTracker {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
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
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_changes_workspace
        ON change_logs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_changes_file
        ON change_logs(workspace_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_changes_user
        ON change_logs(workspace_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_changes_timestamp
        ON change_logs(workspace_id, timestamp DESC);
    `);
  }

  async logChange(entry: Omit<ChangeLogEntry, "id" | "timestamp">): Promise<void> {
    this.db.prepare(`
      INSERT INTO change_logs (id, workspace_id, file_path, user_id, action,
        old_content_hash, new_content_hash, old_path, new_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      entry.workspaceId,
      entry.filePath,
      entry.userId,
      entry.action,
      entry.oldContentHash || null,
      entry.newContentHash || null,
      entry.oldPath || null,
      entry.newPath || null,
      entry.metadata || null
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

    const rows = this.db.prepare(query).all(...args) as any[];

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      filePath: row.file_path,
      userId: row.user_id,
      action: row.action,
      oldContentHash: row.old_content_hash,
      newContentHash: row.new_content_hash,
      oldPath: row.old_path,
      newPath: row.new_path,
      metadata: row.metadata,
      timestamp: new Date(row.timestamp),
    }));
  }

  async getStats(workspaceId: string): Promise<{
    totalChanges: number;
    changesByUser: Record<string, number>;
    changesByAction: Record<string, number>;
    recentActivity: ChangeLogEntry[];
  }> {
    const total = this.db.prepare(
      "SELECT COUNT(*) as count FROM change_logs WHERE workspace_id = ?"
    ).get(workspaceId) as any;

    const byUser = this.db.prepare(`
      SELECT user_id, COUNT(*) as count
      FROM change_logs WHERE workspace_id = ?
      GROUP BY user_id ORDER BY count DESC
    `).all(workspaceId) as any[];

    const byAction = this.db.prepare(`
      SELECT action, COUNT(*) as count
      FROM change_logs WHERE workspace_id = ?
      GROUP BY action
    `).all(workspaceId) as any[];

    const recent = await this.getChanges({ workspaceId, limit: 10 });

    return {
      totalChanges: total.count,
      changesByUser: Object.fromEntries(byUser.map((r) => [r.user_id, r.count])),
      changesByAction: Object.fromEntries(byAction.map((r) => [r.action, r.count])),
      recentActivity: recent,
    };
  }
}
```

---

## 10. Phase 6: Web Dashboard

### 10.1 Tech Stack

- **Framework**: Express.js (served from plugin)
- **Styling**: Tailwind CSS (CDN)
- **Frontend**: Vanilla JavaScript (lightweight, no build step)

### 10.2 Dashboard Pages

| Page | Path | Description |
|------|------|-------------|
| Home | `/` | HOST/REMOTE mode selection |
| Config | `/config` | Configuration page |
| Dashboard | `/dashboard` | Overview stats, recent activity |
| Changes | `/changes` | Full change timeline with filters |
| Team | `/team` | Manage team members, view online users |
| Invite | `/invite/:token` | Accept invite link |

### 10.3 Web Server

**File: `src/web/server.ts`**

```typescript
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ServerConfig } from "../server/mcp-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function startWebUI(port: number, config: ServerConfig) {
  const app = express();

  // Serve static files
  app.use(express.static(path.join(__dirname, "public")));

  // API endpoints
  app.get("/api/config", (req, res) => {
    res.json({
      mode: config.mode,
      workspacePath: config.workspacePath,
      hostUrl: config.hostUrl,
    });
  });

  app.post("/api/config", express.json(), (req, res) => {
    // Update configuration
    const { mode, workspacePath, hostUrl } = req.body;
    // Save config...
    res.json({ success: true });
  });

  app.get("/api/changes", (req, res) => {
    // Return changes from database
    res.json({ changes: [] });
  });

  app.get("/api/stats", (req, res) => {
    // Return statistics
    res.json({ stats: {} });
  });

  app.get("/api/team", (req, res) => {
    // Return team members
    res.json({ members: [] });
  });

  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // Note: This runs on the same port as MCP server
  // We'll integrate with the main Express app
}
```

---

## 11. Phase 7: Invite Link System

### 11.1 Link Format

```
http://localhost:31313/invite/{token}
```

### 11.2 Token Properties

| Property | Description |
|----------|-------------|
| `token` | 32-char nanoid, URL-safe |
| `workspace_id` | Target workspace |
| `email` | Pre-registered email (optional) |
| `permissions` | Comma-separated: `read`, `write`, `admin` |
| `expires_at` | Expiry datetime (optional) |
| `max_uses` | Maximum uses (optional) |
| `use_count` | Current use count |

---

## 12. Phase 8: Testing & Security Audit

### 12.1 Test Categories

| Category | Coverage Target | Tools |
|----------|-----------------|-------|
| Unit Tests | 90%+ | Vitest |
| Integration Tests | All API endpoints | Supertest |
| Security Tests | All attack vectors | Custom |
| Concurrent Access Tests | Lock behavior | Custom |

### 12.2 Security Checklist

- [ ] Path traversal prevention (`../` attacks)
- [ ] Null byte injection prevention
- [ ] Bearer token validation on every request
- [ ] Rate limiting (100 req/15min per IP)
- [ ] CORS properly configured
- [ ] SQL injection prevention (parameterized queries)
- [ ] Atomic file writes (temp + rename)
- [ ] Lock auto-expiration (no deadlocks)
- [ ] Session cleanup (no memory leaks)
- [ ] Input sanitization on all tools

### 12.3 Concurrent Access Tests

```typescript
describe("Concurrent File Editing", () => {
  it("should prevent two users from editing the same file", async () => {
    // User A acquires lock
    await lockManager.acquireLock({ filePath: "test.ts", userId: "userA", ... });

    // User B tries to acquire lock — should fail
    const result = await lockManager.acquireLock({ filePath: "test.ts", userId: "userB", ... });
    expect(result.granted).toBe(false);
    expect(result.blockedBy).toBeDefined();
  });

  it("should allow editing after lock release", async () => {
    await lockManager.acquireLock({ filePath: "test.ts", userId: "userA", ... });
    await lockManager.releaseLock(workspaceId, "test.ts", "userA");

    const result = await lockManager.acquireLock({ filePath: "test.ts", userId: "userB", ... });
    expect(result.granted).toBe(true);
  });

  it("should auto-expire stale locks", async () => {
    // Manually create expired lock
    // ...

    // New lock should succeed
    const result = await lockManager.acquireLock({ filePath: "test.ts", userId: "userB", ... });
    expect(result.granted).toBe(true);
  });
});
```

---

## 13. Phase 9: Deployment & Distribution

### 13.1 Installation (Plugin Mode)

```bash
# Install globally
npm install -g @opencoop/opencode-plugin

# Add to opencode.json plugin array
# {
#   "plugin": ["@opencoop/opencode-plugin"]
# }

# Restart OpenCode
# Plugin auto-starts on port 31313
```

### 13.2 HOST Mode Setup

1. Open `http://localhost:31313` in browser
2. Select "HOST" mode
3. Choose project folder
4. Generate invite link
5. Share link with team members

### 13.3 REMOTE Mode Setup

1. Install plugin globally
2. Add to `opencode.json` plugin array
3. Restart OpenCode
4. Open `http://localhost:31313`
5. Select "REMOTE" mode
6. Paste host's invite link
7. Connect to shared project

### 13.4 Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod
COPY dist ./dist
EXPOSE 31313
CMD ["node", "dist/index.js"]
```

---

## 14. Project Structure

```
opencoop/
├── src/
│   ├── index.ts                    # Plugin entry point
│   ├── server/
│   │   └── mcp-server.ts           # MCP server (Streamable HTTP)
│   ├── auth/
│   │   ├── auth-manager.ts         # Authentication & invites
│   │   └── session-manager.ts      # Active session tracking
│   ├── filesystem/
│   │   ├── file-manager.ts         # Sandboxed file operations
│   │   ├── lock-manager.ts         # File locking system
│   │   └── change-tracker.ts       # Audit log
│   ├── web/
│   │   ├── server.ts               # Express web server
│   │   └── public/                 # Static HTML/CSS/JS
│   │       ├── index.html
│   │       ├── config.html
│   │       ├── dashboard.html
│   │       ├── changes.html
│   │       ├── team.html
│   │       └── assets/
│   │           ├── app.js
│   │           └── style.css
│   ├── types/
│   │   └── index.ts                # TypeScript types
│   └── utils/
│       ├── config.ts               # Config loader
│       └── logger.ts               # Pino logger
├── data/                           # SQLite database
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
└── LICENSE
```

---

## 15. Dependencies

### 15.1 Production

```json
{
  "@modelcontextprotocol/server": "^2.0.0",
  "zod": "^3.22.0",
  "express": "^4.18.0",
  "cors": "^2.8.5",
  "helmet": "^7.1.0",
  "better-sqlite3": "^11.0.0",
  "bcrypt": "^5.1.1",
  "jsonwebtoken": "^9.0.2",
  "nanoid": "^5.0.4",
  "uuid": "^9.0.0",
  "pino": "^8.17.0",
  "pino-pretty": "^10.3.0",
  "dotenv": "^16.3.1",
  "chalk": "^5.3.0"
}
```

### 15.2 Development

```json
{
  "@opencode-ai/plugin": "^0.1.0",
  "typescript": "^5.3.0",
  "@types/node": "^20.10.0",
  "@types/express": "^4.17.21",
  "@types/cors": "^2.8.17",
  "@types/bcrypt": "^5.0.2",
  "@types/jsonwebtoken": "^9.0.5",
  "@types/better-sqlite3": "^7.6.0",
  "vitest": "^1.2.0",
  "supertest": "^6.3.3",
  "tsx": "^4.7.0",
  "eslint": "^8.56.0",
  "prettier": "^3.2.0"
}
```

---

## 16. Timeline & Milestones

| Phase | Title | Duration | Dependency |
|-------|-------|----------|------------|
| 0 | Plugin Foundation | 2 days | — |
| 1 | MCP Server Core | 3 days | Phase 0 |
| 2 | File System Manager | 2 days | Phase 1 |
| 3 | File Locking | 2 days | Phase 2 |
| 4 | Authentication | 2 days | Phase 1 |
| 5 | Change Tracking | 1 day | Phase 2 |
| 6 | Web Dashboard | 3 days | Phase 4, 5 |
| 7 | Invite System | 1 day | Phase 4 |
| 8 | Testing & Security | 3 days | All phases |
| 9 | Deployment | 1 day | Phase 8 |

**Total: ~20 days (~4 weeks)**

| Milestone | Target | Deliverable |
|-----------|--------|-------------|
| M1 | Week 1 | Plugin loads, MCP server runs on port 31313 |
| M2 | Week 1.5 | File read/write/edit via MCP tools |
| M3 | Week 2 | File locking prevents conflicts |
| M4 | Week 2.5 | Auth + invite links work |
| M5 | Week 3 | Web dashboard functional |
| M6 | Week 3.5 | Full testing passed |
| M7 | Week 4 | Published to npm |

---

## 17. API Reference

### 17.1 MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `read_file` | `path`, `start_line?`, `end_line?` | Read file contents |
| `write_file` | `path`, `content`, `create_dirs?` | Create/overwrite file |
| `edit_file` | `path`, `search`, `replace`, `replace_all?` | Search & replace edit |
| `list_files` | `path?`, `recursive?` | List directory contents |
| `search_files` | `pattern`, `max_results?` | Glob file search |
| `grep_content` | `pattern`, `path?`, `include?` | Content search with regex |
| `directory_tree` | `path?`, `max_depth?`, `exclude?` | Get folder tree |
| `lock_file` | `path`, `reason?` | Acquire file lock |
| `unlock_file` | `path` | Release file lock |
| `list_locks` | — | List all active locks |
| `check_lock` | `path` | Check lock status |
| `view_changes` | `file_path?`, `user_id?`, `limit?` | View change history |
| `view_stats` | — | View project statistics |
| `who_is_online` | — | See connected users |
| `invite_member` | `email`, `permissions`, `expires_in_days?` | Generate invite link |
| `list_members` | — | List team members |
| `revoke_access` | `user_id`, `reason?` | Revoke member access |

### 17.2 HTTP API (Web UI)

```
GET  /                                - Web UI home
GET  /config                          - Config page
GET  /dashboard                       - Dashboard page
GET  /changes                         - Changes page
GET  /team                            - Team page
GET  /invite/:token                   - Accept invite

GET  /api/config                      - Get configuration
POST /api/config                      - Update configuration
GET  /api/changes                     - List changes (paginated)
GET  /api/stats                       - Project statistics
GET  /api/team                        - List team members
POST /api/invite                      - Create invite link
DELETE /api/invite/:id                - Revoke invite
```

---

## 18. Checklist

### Before First Release

- [ ] Plugin loads correctly in OpenCode
- [ ] MCP server starts on port 31313
- [ ] Web UI accessible at http://localhost:31313
- [ ] HOST/REMOTE mode selection works
- [ ] Folder selection works (HOST mode)
- [ ] Invite link generation works
- [ ] REMOTE mode can connect via invite link
- [ ] File read/write/edit work correctly
- [ ] Path traversal is blocked
- [ ] File locking prevents concurrent edits
- [ ] Locks auto-expire after timeout
- [ ] All changes are logged
- [ ] Web dashboard shows data correctly
- [ ] Team member can connect from another machine
- [ ] All tests pass
- [ ] Documentation is complete

### Security Audit

- [ ] No path traversal vulnerabilities
- [ ] No SQL injection vectors
- [ ] No XSS in web dashboard
- [ ] Rate limiting is active
- [ ] CORS is properly configured
- [ ] Secrets are not in code
- [ ] Database is encrypted at rest (if production)

---

**Author: Hamid Pajand**
**Last Updated: September 2026**
**Version: 1.0.0**
**Architecture: OpenCode Plugin + Streamable HTTP MCP Server**
