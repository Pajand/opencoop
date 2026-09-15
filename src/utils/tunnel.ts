import { spawn, execSync, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import http from "http";

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

  async start(port: number = 31313): Promise<string> {
    if (this.publicUrl) return this.publicUrl;
    if (this.starting) {
      return new Promise((resolve) => {
        this.once("url", resolve);
      });
    }
    this.starting = true;
    this.lastError = null;

    this.killOrphanedTunnels();

    return new Promise((resolve, reject) => {
      // Use tinyfi.sh SSH tunnel — no binary download needed, works through VPN,
      // provides HTTPS URL, no signup required.
      // -o ServerAliveInterval=60 keeps the connection alive
      // -R 80:localhost:PORT forwards remote port 80 to local port
      this.process = spawn("ssh", [
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ServerAliveInterval=60",
        "-o", "ServerAliveCountMax=3",
        "-o", "ConnectTimeout=10",
        "-R", `80:localhost:${port}`,
        "tinyfi.sh"
      ], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let urlFound = false;

      const checkOutput = (data: Buffer) => {
        const output = data.toString();
        // tinyfi.sh outputs: HTTPS: https://xxx.tinyfi.sh
        const match = output.match(/(https?:\/\/[a-z0-9-]+\.tinyfi\.sh)/i);
        if (match && !urlFound) {
          urlFound = true;
          this.publicUrl = match[1];
          this.starting = false;
          this.emit("url", this.publicUrl);
          this.startHealthCheck();
          console.log(`[OpenCOOP] Tunnel active: ${this.publicUrl}`);
          resolve(this.publicUrl);
        }
      };

      this.process.stdout?.on("data", checkOutput);
      this.process.stderr?.on("data", checkOutput);

      this.process.on("error", (err) => {
        this.starting = false;
        this.lastError = err.message;
        console.log("[OpenCOOP] SSH tunnel error:", err.message);
        reject(err);
      });

      this.process.on("exit", (code) => {
        this.starting = false;
        const hadUrl = urlFound;
        if (!urlFound) this.lastError = `tunnel exited with code ${code}`;
        this.publicUrl = null;
        this.process = null;
        this.stopHealthCheck();
        console.log(`[OpenCOOP] SSH tunnel exited with code ${code}`);

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

  private killOrphanedTunnels(): void {
    if (process.platform === "win32") return;
    try {
      const out = execSync('pgrep -af "ssh.*tinyfi\\.sh" || true').toString().trim();
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

  stop(): void {
    this.stopHealthCheck();
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
