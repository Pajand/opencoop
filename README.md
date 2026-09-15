<div align="center">

[![فارسی](https://img.shields.io/badge/🌐-فارسی-blue?style=flat-square)](README.fa.md)

# OpenCOOP

![OpenCOOP](https://img.shields.io/badge/OpenCOOP-v1.10.2-blue)
![License](https://img.shields.io/badge/License-Non--Commercial-blue)
![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple)
![MCP](https://img.shields.io/badge/MCP-SSE-orange)
![Node](https://img.shields.io/badge/Node.js-18+-black)

**OpenCode plugin for real-time team collaboration via shared MCP server**

</div>

---

## What is OpenCOOP?

OpenCOOP is an **OpenCode plugin** that enables multiple developers to collaborate on the same project simultaneously. Each developer runs their own OpenCode with their own AI, but they all connect to the **same MCP server** — giving every person's AI direct read/write access to a shared project folder.

```
Developer A (Remote)           Developer B (Remote)
      │                              │
      ▼                              ▼
  OpenCode + AI                   OpenCode + AI
      │                              │
      └──────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   OpenCOOP MCP Server  │
        │   (Port 31313)         │
        └────────────┬───────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │  Shared Project Folder │
        └────────────────────────┘
```

## Key Features

| Feature | Description |
|---------|-------------|
| 🔗 **Shared MCP Server** | Multiple OpenCode instances share the same project |
| 👥 **Real-time Collaboration** | See who is editing what in real-time |
| 📝 **Change Tracking** | Every file modification is logged with user attribution |
| 🔒 **File Locking** | Prevents conflicts when multiple users edit the same file |
| 🌐 **Web Dashboard** | Beautiful UI for configuration and monitoring |
| 🔑 **Invite System** | Secure token-based team member invitations |
| 🛡️ **Sandbox Security** | Path traversal protection and input validation |
| 📊 **Statistics** | View changes per user, recent activity, and more |

## Installation

### Option 1: Install via npm (Recommended)

```bash
npm install -g @opencoop/opencode-plugin
```

Then add these lines to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@opencoop/opencode-plugin"],
  "mcp": {
    "opencoop": {
      "type": "remote",
      "url": "http://localhost:31313/sse",
      "enabled": true
    }
  }
}
```

> **Note:** If your `opencode.json` already has other settings, just merge the `plugin` and `mcp` lines into your existing file. Don't replace the whole file.

### Option 2: Install from GitHub

```bash
git clone https://github.com/Pajand/opencoop.git
cd opencoop
npm install
npm run build
npm link
```

Then add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencoop"],
  "mcp": {
    "opencoop": {
      "type": "remote",
      "url": "http://localhost:31313/sse",
      "enabled": true
    }
  }
}
```

## Quick Start

1. **Install** the plugin (see above)
2. **Restart** OpenCode
3. **Open** `http://localhost:31313/ui` in your browser
4. **Select** HOST or REMOTE mode
5. **Configure** your project

## Usage Modes

### HOST Mode (Project Owner)

1. Select **HOST** mode in the web UI
2. Choose your **project folder**
3. Click **Generate Invite Link**
4. Click **Copy Link** and **share** it with team members

> The invite link uses an **automatic Cloudflare Tunnel** (`https://xxx.trycloudflare.com`),
> so team members can reach your server even behind NAT, firewall, or VPN.
> No port forwarding, no static IP, no manual setup needed.

## Automatic Cloudflare Tunnel (Zero Setup)

When **HOST** mode is active, OpenCOOP automatically:

1. **Downloads** the `cloudflared` binary on first run (Linux / macOS / Windows, ~30 MB, cached in `~/.cache/cloudflared/`)
2. **Opens** a secure tunnel to `http://localhost:31313`
3. **Uses** the public `https://xxx.trycloudflare.com` URL in all invite links

You don't need to install or configure anything. Requirements:

- **Node.js 18+** and **OpenCode** installed
- **Internet access** (to download the binary once, and to keep the tunnel alive)
- `curl` available on PATH (preinstalled on virtually all Linux/macOS systems and Windows 10+)

Notes:

- If the tunnel can't start (e.g. offline), invite links fall back to your local IP and a warning is logged.
- Switching from REMOTE to HOST in the UI starts the tunnel on-demand — no restart needed.
- Each restart gets a fresh tunnel URL; generate a new invite link after restarting the host.

### REMOTE Mode (Team Member)

1. **Install** the plugin on your machine
2. Add to your `opencode.json` (same as HOST setup — the MCP `url` stays `http://localhost:31313/sse` forever)
3. **Restart** OpenCode (only this once, for the initial install)
4. Open `http://localhost:31313/ui`
5. Select **REMOTE** mode
6. **Paste** the host's invite link
7. Click **Connect** — done. No restart, no config edits.

Your local server now **proxies every tool call to the host over its tunnel**, so your AI reads/writes the **HOST's project folder live**. Switching hosts or a fresh host tunnel URL? Just paste the new link and Connect again — instant.

> Do not point REMOTE at its own tunnel URL or at another REMOTE (loop) — always connect to a HOST.

## MCP Tools

Once connected, your AI has access to these tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents from the shared project |
| `write_file` | Create or overwrite files |
| `edit_file` | Make targeted edits using search & replace |
| `list_files` | List directory contents |
| `search_files` | Search files by glob pattern |
| `grep_content` | Search file contents with regex |
| `directory_tree` | Get folder structure overview |
| `lock_file` | Acquire exclusive lock before editing |
| `unlock_file` | Release lock after editing |
| `view_changes` | View recent changes by team members |
| `view_stats` | View project statistics |
| `who_is_online` | See who is currently connected |
| `invite_member` | Generate invite link for new members |
| `list_members` | List all team members |
| `revoke_access` | Revoke a member's access |

## AI Agent Instructions

**If you are an AI agent reading this, follow these exact steps to install and configure OpenCOOP:**

### Step 1: Install

```bash
# Check if OpenCode is installed
which opencode || echo "OpenCode not found - user needs to install it first"

# Install OpenCOOP globally
npm install -g @opencoop/opencode-plugin
```

### Step 2: Configure

```bash
# Read current opencode config
cat ~/.config/opencode/opencode.json 2>/dev/null || echo "{}"
```

Add the plugin to `opencode.json`:

```json
{
  "plugin": ["@opencoop/opencode-plugin"],
  "mcp": {
    "opencoop": {
      "type": "remote",
      "url": "http://localhost:31313/sse",
      "enabled": true
    }
  }
}
```

### Step 3: Verify Installation

```bash
# Check if plugin is installed correctly
npm list -g @opencoop/opencode-plugin
```

### Step 4: Access Web UI

```
URL: http://localhost:31313/ui
```

- **HOST mode**: Select folder, generate invite link
- **REMOTE mode**: Paste host's invite link

### Important Notes for AI Agents

1. **Do NOT** manually edit MCP server configuration
2. **Do NOT** run the server as a separate process
3. The plugin **auto-starts** when OpenCode starts
4. All configuration is done through the **web UI**
5. The server runs on **port 31313** by default

### Platform-Specific Notes for AI Agents

**When helping a user, ALWAYS run these diagnostics first:**

```bash
# 1. Is OpenCode installed and reachable?
which opencode || echo "NOT IN PATH"
opencode --version 2>&1 | head -1

# 2. Is the plugin installed?
npm ls -g @opencoop/opencode-plugin 2>&1

# 3. Is the plugin recognized by OpenCode?
# (Run this AFTER OpenCode starts — the plugin only loads when OpenCode runs)

# 4. Is the HTTP server up?
curl -s --max-time 3 http://localhost:31313/health || echo "SERVER DOWN"

# 5. Does SSE work (not HTML)?
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' --max-time 3 -H 'Accept: text/event-stream' http://localhost:31313/sse
```

**If `which opencode` returns nothing:**
- The user installed the npm plugin but NOT OpenCode itself.
- OpenCode is a separate program. The plugin npm package is NOT OpenCode.
- Help the user install OpenCode: https://opencode.ai or `curl -fsSL https://opencode.ai/install | bash`

**If OpenCode is installed but `curl localhost:31313/health` fails:**
- The plugin might be an old version without the HTTP server fix.
- Check plugin version: `npm ls -g @opencoop/opencode-plugin` — must be `1.6.8` or newer.
- Clear plugin cache: `rm -rf ~/.cache/opencode/packages/@opencoop` (Linux/Mac) or delete `%USERPROFILE%\.cache\opencode\packages\@opencoop` (Windows).
- Restart OpenCode.

**If `curl /sse` returns HTML instead of event-stream:**
- The running plugin version is older than 1.6.6.
- Update: `npm install -g @opencoop/opencode-plugin@latest`
- Clear cache: `rm -rf ~/.cache/opencode/packages/@opencoop`
- Restart OpenCode.

**Termux (Android):**
- OpenCode binary is usually at `$PREFIX/bin/opencode` or `$HOME/.opencode/bin/opencode`.
- If `which opencode` fails, add the install path to PATH: `export PATH="$HOME/.opencode/bin:$PATH"` and add this line to `~/.bashrc`.
- Port 31313 might be blocked by Android — try `curl http://localhost:31313/health` from Termux itself (not from a browser on another device) to verify the server is running locally.

**Windows:**
- Config path: `%USERPROFILE%\.config\opencode\opencode.json` (not `~/.config`).
- Plugin cache: `%USERPROFILE%\.cache\opencode\packages\@opencoop`.
- OpenCode install path varies — check with `where opencode`.

**Mac:**
- If installed via Homebrew, OpenCode is in `/opt/homebrew/bin/opencode`.
- If installed via curl script, it's in `~/.opencode/bin/opencode` — ensure this is in your PATH.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Instances                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Member A │  │ Member B │  │ Member C │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│       └──────────────┼──────────────┘                    │
│                      │                                  │
│                      ▼                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │              OpenCOOP MCP Server                 │   │
│  │              (Port 31313)                        │   │
│  └─────────────────────────────────────────────────┘   │
│                      │                                  │
│                      ▼                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Shared Project Folder                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Plugin recognized by OpenCode but UI not loading / MCP not starting

This means OpenCode loads the plugin module but the HTTP server fails to start. Common causes:

1. **Plugin version too old**: Must be `1.6.8` or newer. Check with `npm ls -g @opencoop/opencode-plugin`.
2. **Stale plugin cache**: OpenCode caches plugins in `~/.cache/opencode/packages/@opencoop`. After updating, clear it:
   ```bash
   rm -rf ~/.cache/opencode/packages/@opencoop
   ```
   On Windows: delete `%USERPROFILE%\.cache\opencode\packages\@opencoop`.
3. **Port 31313 already in use**: Another process is using the port. Check with `lsof -i :31313` or `ss -ltnp | grep 31313`.
4. **OpenCode not in PATH**: The binary exists but isn't reachable. Verify with `which opencode`.
5. **Termux/Android**: Port might be restricted. Test locally first: `curl http://localhost:31313/health`.

### MCP stays red / won't connect
1. Make sure the OpenCode web UI (or TUI) is open — the plugin server only starts when OpenCode loads the plugin.
2. Verify the server is up: `curl http://localhost:31313/health` should return `{"status":"ok",...}`.
3. Verify SSE works: `curl -N -H 'Accept: text/event-stream' http://localhost:31313/sse` should print `event: endpoint` (not HTML).
4. Make sure your MCP `url` ends with `/sse` (not `/mcp`).

### Invite link shows local IP instead of tunnel URL

The HOST panel shows a live tunnel status badge. Check it first:

1. **Fully restart OpenCode after install/update** — the plugin code loads only at startup. (Seeing new UI buttons but getting old-style links means the old code is still running in memory.)
2. **Wait ~30s on first run** — the `cloudflared` binary (~30 MB) downloads once, then the tunnel needs a few seconds. The badge shows "starting..." meanwhile.
3. **Mode must be HOST and saved** — click Save after selecting HOST; the tunnel starts on-demand.
4. **Check the badge**: green = links use the tunnel; red = shows the exact error (no internet, download blocked, etc.). Check tunnel state manually: `curl http://localhost:31313/tunnel-url`.

### Tools fail or return errors
Open the web UI (`http://localhost:31313/ui`), select HOST or REMOTE mode and configure your project folder. Tools need a configured workspace before they can read/write files.

### Port 31313 already in use
Only the first OpenCode instance starts the server; the others reuse it. If another app uses the port, change `port` in `~/.opencoop/config.json` (and the MCP `url` accordingly).

### Old behavior after update (stale plugin cache)
OpenCode caches plugins in `~/.cache/opencode/packages/`. After updating with `npm i -g @opencoop/opencode-plugin@latest`, refresh the cache and restart OpenCode:
```bash
rm -rf ~/.cache/opencode/packages/@opencoop
```

## License

OpenCOOP Non-Commercial License - Free for non-commercial use, commercial use requires permission.

See [LICENSE](LICENSE) file for details.

## Author

**Hamid Pajand** - [GitHub](https://github.com/Pajand) - [Email](mailto:HamidPajand@gmail.com)
