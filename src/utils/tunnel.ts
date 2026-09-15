import { spawn, execSync, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import http from "http";

const CLOUDFLARED_VERSION = "2026.9.1";
const HEALTH_CHECK_INTERVAL = 30_000;
const HEALTH_CHECK_TIMEOUT = 10_000;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF = 5_000;

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private starting = false;
  private lastError: string | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartAttempts = 0;

  getStatus(): { url: string | null; starting: boolean; error: string | null } {
    return { url: this.publicUrl, starting: this.starting, error: this.lastError };
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(() => {
      this.checkTunnelHealth();
    }, HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private checkTunnelHealth(): void {
    if (!this.publicUrl || !this.process) return;

    const req = http.get(this.publicUrl + "/health", { timeout: HEALTH_CHECK_TIMEOUT }, (res) => {
      if (res.statusCode === 200) {
        this.restartAttempts = 0;
        return;
      }
      console.log(`[OpenCOOP] Tunnel health check failed: HTTP ${res.statusCode}`);
      this.restartTunnel();
    });

    req.on("error", () => {
      console.log("[OpenCOOP] Tunnel health check failed: connection error");
      this.restartTunnel();
    });

    req.on("timeout", () => {
      req.destroy();
      console.log("[OpenCOOP] Tunnel health check failed: timeout");
      this.restartTunnel();
    });
  }

  private restartTunnel(): void {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      console.log(`[OpenCOOP] Tunnel restart limit reached (${MAX_RESTART_ATTEMPTS}). Giving up.`);
      this.stopHealthCheck();
      return;
    }

    this.restartAttempts++;
    const delay = RESTART_BACKOFF * this.restartAttempts;
    console.log(`[OpenCOOP] Restarting tunnel in ${delay}ms (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`);

    this.stop();
    setTimeout(() => {
      this.start().catch((err) => {
        console.log(`[OpenCOOP] Tunnel restart failed: ${(err as Error).message}`);
      });
    }, delay);
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
        "--no-autoupdate",
        "--protocol", "http2"
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });
      this.process.unref();

      let urlFound = false;

      const checkOutput = (data: Buffer) => {
        const output = data.toString();
        const match = output.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (match && !urlFound) {
          urlFound = true;
          this.publicUrl = match[1];
          this.starting = false;
          this.emit("url", this.publicUrl);
          this.startHealthCheck();
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
        const hadUrl = urlFound;
        if (!urlFound) this.lastError = `tunnel exited with code ${code}`;
        this.publicUrl = null;
        this.process = null;
        this.stopHealthCheck();
        console.log(`[OpenCOOP] Cloudflare tunnel exited with code ${code}`);

        if (hadUrl) {
          console.log("[OpenCOOP] Tunnel died unexpectedly, restarting...");
          this.restartTunnel();
        }
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
    this.stopHealthCheck();
    if (this.process) {
      try {
        process.kill(-this.process.pid!, "SIGTERM");
      } catch {}
      this.process.kill();
      this.process = null;
      this.publicUrl = null;
    }
  }

  getUrl(): string | null {
    return this.publicUrl;
  }
}
