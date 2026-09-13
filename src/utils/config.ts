import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ServerConfig } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, "..", "..", "data");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export async function loadConfig(project?: any): Promise<ServerConfig> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    // Return default config
    return getDefaultConfig();
  }
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

function getDefaultConfig(): ServerConfig {
  return {
    port: 31313,
    workspacePath: "",
    jwtSecret: generateRandomSecret(),
    databasePath: path.join(CONFIG_DIR, "opencoop.db"),
    mode: "host",
  };
}

function generateRandomSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
