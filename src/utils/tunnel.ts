import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private starting = false;

  async start(): Promise<string> {
    if (this.publicUrl) return this.publicUrl;
    if (this.starting) {
      return new Promise((resolve) => {
        this.once("url", resolve);
      });
    }
    this.starting = true;

    return new Promise((resolve, reject) => {
      let binaryPath: string;
      try {
        const cloudflared = require("cloudflared");
        // cloudflared package exports: DEFAULT_CLOUDFLARED_BIN or bin (string)
        binaryPath = cloudflared.DEFAULT_CLOUDFLARED_BIN || cloudflared.bin || "cloudflared";
        console.log(`[OpenCOOP] Cloudflare binary: ${binaryPath}`);
      } catch {
        binaryPath = "cloudflared";
      }

      this.process = spawn(binaryPath, [
        "tunnel",
        "--url", "http://localhost:31313",
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
        console.log("[OpenCOOP] Cloudflare tunnel error:", err.message);
        reject(err);
      });

      this.process.on("exit", (code) => {
        this.starting = false;
        this.publicUrl = null;
        this.process = null;
        console.log(`[OpenCOOP] Cloudflare tunnel exited with code ${code}`);
      });

      setTimeout(() => {
        if (!urlFound) {
          this.starting = false;
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
