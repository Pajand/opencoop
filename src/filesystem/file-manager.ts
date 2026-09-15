import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { FileMetadata } from "../types/index.js";

export class FileManager {
  private workspacePath: string;
  private normalizedWorkspace: string;

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
    this.normalizedWorkspace = this.workspacePath.endsWith(path.sep)
      ? this.workspacePath
      : this.workspacePath + path.sep;
  }

  private validatePath(relativePath: string): string {
    // Block absolute paths — only relative paths within workspace are allowed
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Access denied: absolute path "${relativePath}" is not allowed`);
    }

    const resolved = path.resolve(this.workspacePath, relativePath);

    // Ensure resolved path is INSIDE workspace (not just a prefix match)
    // e.g. /root/project2 should NOT match workspace /root/project
    if (!resolved.startsWith(this.normalizedWorkspace) && resolved !== this.workspacePath) {
      throw new Error(`Access denied: path "${relativePath}" is outside the workspace`);
    }

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

        // Security: skip symlinks that point outside workspace
        if (entry.isSymbolicLink()) {
          try {
            const realPath = await fs.realpath(entryPath);
            if (!realPath.startsWith(this.normalizedWorkspace)) {
              continue;
            }
          } catch {
            continue;
          }
        }

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

        // Security: skip symlinks that point outside workspace
        if (entry.isSymbolicLink()) {
          try {
            const realPath = await fs.realpath(entryPath);
            if (!realPath.startsWith(this.normalizedWorkspace)) continue;
          } catch {
            continue;
          }
        }

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

        // Security: skip symlinks that point outside workspace
        if (entry.isSymbolicLink()) {
          try {
            const realPath = await fs.realpath(entryPath);
            if (!realPath.startsWith(this.normalizedWorkspace)) continue;
          } catch {
            continue;
          }
        }

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
            regex.lastIndex = 0;
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

        // Security: skip symlinks that point outside workspace
        if (entry.isSymbolicLink()) {
          try {
            const realPath = await fs.realpath(entryPath);
            if (!realPath.startsWith(this.normalizedWorkspace)) continue;
          } catch {
            continue;
          }
        }

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
