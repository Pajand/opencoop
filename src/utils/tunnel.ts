import { spawn, execSync, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const CLOUDFLARED_VERSION = "2025.2.1";

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private starting = false;
  private lastError: string | null = null;

  getStatus(): { url: string | null; starting: boolean; error: string | null } {
    return { url: this.publicUrl, starting: this.starting, error: this.lastError };
  }

  private async ensureBinary(): Promise<string> {
    // 1. Try require("cloudflared")
    try {
      const cloudflared = require("cloudflared");
      const bin = cloudflared.DEFAULT_CLOUDFLARED_BIN || cloudflared.bin;
      if (bin && existsSync(bin)) {
        console.log(`[OpenCOOP] Cloudflare binary (npm): ${bin}`);
        return bin;
      }
    } catch {}

    // 2. Try global PATH
    try {
      const which = execSync("which cloudflared 2>/dev/null").toString().trim();
      if (which && existsSync(which)) {
        console.log(`[OpenCOOP] Cloudflare binary (global): ${which}`);
        return which;
      }
    } catch {}

    // 3. Try ~/.cache/cloudflared/cloudflared
    const cacheDir = join(process.env.HOME || "/root", ".cache", "cloudflared");
    const cachedBin = join(cacheDir, "cloudflared");
    if (existsSync(cachedBin)) {
      console.log(`[OpenCOOP] Cloudflare binary (cached): ${cachedBin}`);
      return cachedBin;
    }

    // 4. Download automatically
    console.log("[OpenCOOP] Downloading cloudflared binary...");
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    const platformMap: Record<string, string> = { linux: "linux", darwin: "darwin", win32: "windows" };
    const platform = platformMap[process.platform] || "linux";
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const ext = process.platform === "win32" ? ".exe" : "";
    const fileName = `cloudflared-${platform}-${arch}${ext}`;
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${fileName}`;
    const targetBin = join(cacheDir, `cloudflared${ext}`);

    try {
      if (process.platform === "win32") {
        execSync(`curl -fsSL -o "${targetBin}" "${url}"`, { timeout: 60000 });
      } else {
        execSync(`curl -fsSL -o "${targetBin}" "${url}" && chmod +x "${targetBin}"`, { timeout: 60000 });
      }
      console.log(`[OpenCOOP] Cloudflare binary downloaded: ${targetBin}`);
      return targetBin;
    } catch (err) {
      throw new Error(`Failed to download cloudflared: ${(err as Error).message}`);
    }
  }

  async start(): Promise<string> {
    if (this.publicUrl) return this.publicUrl;
    if (this.starting) {
      return new Promise((resolve) => {
        this.once("url", resolve);
      });
    }
    this.starting = true;
    this.lastError = null;

    // Kill orphaned cloudflared processes from previous runs that still hold
    // dead tunnels for our port (they cause confusing 530s on old URLs).
    // Scoped to our exact target so users' own tunnels are never touched.
    // Our child process isn't spawned yet, so no self-match is possible.
    if (process.platform !== "win32") {
      try {
        const out = execSync('pgrep -af "cloudflared.*(localhost|127\\.0\\.0\\.1):31313" || true').toString().trim();
        for (const line of out.split("\n")) {
          const pid = parseInt(line.split(/\s+/)[0], 10);
          if (pid > 1 && String(pid) !== String(process.pid)) {
            try {
              process.kill(pid, "SIGTERM");
              console.log(`[OpenCOOP] Stopped stale tunnel process (pid ${pid})`);
            } catch {}
          }
        }
      } catch {}
    }

    const binaryPath = await this.ensureBinary();

    return new Promise((resolve, reject) => {
      // NOTE: 127.0.0.1 (not localhost) on purpose — localhost needs DNS and
      // may resolve to ::1 (our server is IPv4-only), and VPNs often hijack
      // localhost resolution. 127.0.0.1 always works.
      this.process = spawn(binaryPath, [
        "tunnel",
        "--url", "http://127.0.0.1:31313",
        "--no-autoupdate"
      ], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let urlFound = false;

      const checkOutput = (data: Buffer) => {
        const output = data.toString();
        const match = output.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (match && !urlFound) {
          urlFound = true;
          this.publicUrl = match[1];
          this.starting = false;
          this.emit("url", this.publicUrl);
          resolve(this.publicUrl);
        }
      };

      this.process.stdout?.on("data", checkOutput);
      this.process.stderr?.on("data", checkOutput);

      this.process.on("error", (err) => {
        this.starting = false;
        this.lastError = err.message;
        console.log("[OpenCOOP] Cloudflare tunnel error:", err.message);
        reject(err);
      });

      this.process.on("exit", (code) => {
        this.starting = false;
        if (!urlFound) this.lastError = `tunnel exited with code ${code}`;
        this.publicUrl = null;
        this.process = null;
        console.log(`[OpenCOOP] Cloudflare tunnel exited with code ${code}`);
      });

      setTimeout(() => {
        if (!urlFound) {
          this.starting = false;
          this.lastError = "Tunnel startup timeout (no URL after 30s)";
          reject(new Error("Tunnel startup timeout"));
        }
      }, 30000);
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.publicUrl = null;
    }
  }

  getUrl(): string | null {
    return this.publicUrl;
  }
}
