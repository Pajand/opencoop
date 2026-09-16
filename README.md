<div align="center">

[![فارسی](https://img.shields.io/badge/🌐-فارسی-blue?style=flat-square)](README.fa.md)

# OpenCOOP

![Version](https://img.shields.io/badge/version-1.14.0-blue)
![License](https://img.shields.io/badge/license-Non--Commercial-green)
![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple)
![MCP](https://img.shields.io/badge/MCP-SSE-orange)
![Node](https://img.shields.io/badge/Node.js-18+-black)
![Users](https://img.shields.io/badge/Up%20to%2050%20users-red)

**Real-time team collaboration for OpenCode — up to 50 developers on the same project.**

[Getting Started](#installation) • [Documentation](#features) • [Contributing](#contributing)

</div>

---

## What is OpenCOOP?

**Turn any device into a shared coding server. Your whole team codes together on ONE project — from anywhere in the world.**

OpenCOOP is an **OpenCode plugin** that lets multiple developers (each with their own AI assistant) work simultaneously on the **same project folder** hosted on **one machine**.

### How It Works (Simple!)

```
  YOUR LAPTOP (HOST)                    TEAMMATE'S LAPTOP (REMOTE)
  ┌──────────────────┐                  ┌──────────────────┐
  │  Your Project    │                  │  Teammate's      │
  │  /home/you/app   │◄──── INTERNET ───│  OpenCode + AI   │
  │                  │   (via tunnel)   │                  │
  │  OpenCOOP Server │                  │  OpenCOOP Plugin │
  │  Port 31313      │                  │  (proxies to you)│
  └──────────────────┘                  └──────────────────┘
        ▲                                        │
        │                                        ▼
        │                               Teammate's AI reads/writes
        │                               YOUR files in real-time!
        │
  Every change is LOGGED:
  ✅ Who changed what file
  ✅ Full diff (red/green view)
  ✅ Timestamp
```

### Real-World Example

1. **You** have a project on your laptop at `/home/you/my-app`
2. You open OpenCOOP web UI → select **HOST** → pick your folder → click **Generate Invite Link**
3. You send the link to your teammate (e.g., `https://abc123.tinyfi.sh/ui/invite/xyz`)
4. **Teammate** installs the plugin, pastes your link, clicks **Connect**
5. Now teammate's AI can **read, write, and edit YOUR project files** as if they were local!
6. You both see every change in the **Changes** page with **who made it** and a **visual diff**

**No Git push/pull. No screen sharing. No "send me the file". Just code together live.**

### Key Concepts

| Concept | Explanation |
|---------|-------------|
| **HOST** | The one device that holds the real project files. Shares them over the internet via a secure tunnel. |
| **REMOTE** | Any other device that connects to the host. Their AI works on the host's files as if local. |
| **Invite Link** | A secure URL the host generates. Contains the tunnel address + access token. Share it with teammates. |
| **Change Tracking** | Every file read/write/edit is logged with the user's name, timestamp, and full diff. |
| **File Locking** | Prevent two people from editing the same file at the same time (avoids conflicts). |

### Coming Soon 🚀

- **Admin Dashboard**: Manage team members, permissions, and access
- **Conflict Resolution**: Smart merge when two users edit the same lines

**Up to 50 developers** can collaborate simultaneously with full audit trails.

## Features

| Feature | Description |
|---------|-------------|
| 🔗 **Shared MCP Server** | Multiple OpenCode instances share the same project |
| 👥 **Up to 50 Users** | Real-time collaboration with dozens of team members |
| 📝 **Change Tracking** | Every file modification is logged with user attribution |
| 📸 **Auto Snapshots** | Every write/edit saves the previous version (last 20 per file, 2MB cap, binaries skipped) |
| ↩️ **One-Click Rollback** | Restore any file from Changes page, or let the AI undo its own mistakes via `rollback_file` |
| 🤖 **AI Self-Healing** | `opencoop_guide` teaches any model the rules; `rollback_file` lets it fix its own errors without human help |
| 💾 **Project-Local History** | All history lives in `<project>/.opencoop/` — survives restart, travels with the project, auto-gitignored |
| 🔒 **File Locking** | Prevents conflicts when multiple users edit the same file |
| 🌐 **Web Dashboard** | Beautiful UI for configuration and monitoring |
| 🔑 **Invite System** | Secure token-based team member invitations |
| 🛡️ **Sandbox Security** | Path traversal protection, symlink blocking, absolute path blocking, `.opencoop` store blocked from remote access, and input validation |
| 🌍 **Remote Access** | SSH tunnel (tinyfi.sh) — works behind NAT, firewall, or VPN |
| 📊 **Statistics** | View changes per user, recent activity, and more |
| 🔄 **Auto-Recovery** | Tunnel auto-reconnects, server auto-restarts on failure |

## Installation

### Install via npm (Recommended)

```bash
npm install -g @opencoop/opencode-plugin
```

Then add to your `~/.config/opencode/opencode.json`:

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

### Install from GitHub

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

1. **Install** the plugin (`npm install -g @opencoop/opencode-plugin`)
2. **Restart** OpenCode
3. **Open** `http://localhost:31313/ui` in your browser
4. **Select** HOST mode (project owner) or REMOTE mode (team member)

## Usage

### HOST Mode (Project Owner)

1. Select **HOST** mode in the web UI
2. Choose your **project folder**
3. Click **Generate Invite Link**
4. **Share** the link with your team (up to 50 members)

The invite link uses an **automatic SSH tunnel** via tinyfi.sh (`https://xxx.tinyfi.sh`), so team members can connect even behind NAT, firewall, or VPN.

### REMOTE Mode (Team Member)

1. **Install** the plugin on your machine
2. **Add** the MCP config to your `opencode.json`
3. **Restart** OpenCode
4. Open `http://localhost:31313/ui`
5. Select **REMOTE** mode
6. **Paste** the host's invite link
7. Click **Connect** — done.

Your local server now **proxies every tool call to the host** over its tunnel, so your AI reads/writes the **HOST's project folder live**.

### Automatic SSH Tunnel (Zero Setup)

When HOST mode is active, OpenCOOP automatically:

1. Opens an SSH reverse tunnel to `tinyfi.sh`
2. Forwards traffic to `http://localhost:31313`
3. Uses the public `https://xxx.tinyfi.sh` URL in all invite links

**Requirements:** Node.js 18+, OpenCode, and an SSH client (preinstalled on virtually all systems).

## MCP Tools

Once connected, your AI has access to 15 tools:

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
| `opencoop_guide` | START HERE — AI calls this first; teaches the rules + confirmation question |
| `list_snapshots` | List saved previous versions of a file |
| `rollback_file` | Undo a mistake: restore a file (just path = undo last change) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Team Members (Up to 50)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Member A │  │ Member B │  │ Member C │  │ Member N │        │
│  │ OpenCode │  │ OpenCode │  │ OpenCode │  │ OpenCode │        │
│  │ + MCP    │  │ + MCP    │  │ + MCP    │  │ + MCP    │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │              │              │              │              │
│       └──────────────┴──────────────┴──────────────┘              │
│                              │                                    │
│                    SSH Tunnel (tinyfi.sh)                         │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    OpenCOOP MCP Server                      │  │
│  │  • SSE Transport (Server-Sent Events)                       │  │
│  │  • File Locking (prevent edit conflicts)                     │  │
│  │  • Change Tracking (user attribution)                        │  │
│  │  • Sandbox Security (path validation)                        │  │
│  │  • Web Dashboard (configuration UI)                          │  │
│  └──────────────────────────┬─────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  Shared Project Folder                       │  │
│  │  • Symlink protection                                       │  │
│  │  • Absolute path blocking                                   │  │
│  │  • Path traversal prevention                                 │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## AI Agent Instructions

**If you are an AI agent reading this, follow these exact steps to install and configure OpenCOOP:**

### Step 1: Install

```bash
which opencode || echo "OpenCode not found - user needs to install it first"
npm install -g @opencoop/opencode-plugin
```

### Step 2: Configure

Add the plugin to `~/.config/opencode/opencode.json`:

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

### Step 3: Verify

```bash
npm list -g @opencoop/opencode-plugin
```

### Step 4: Access Web UI

```
http://localhost:31313/ui
```

### Diagnostics

```bash
# 1. Is OpenCode installed?
which opencode || echo "NOT IN PATH"

# 2. Is the plugin installed?
npm ls -g @opencoop/opencode-plugin 2>&1

# 3. Is the HTTP server up?
curl -s --max-time 3 http://localhost:31313/health || echo "SERVER DOWN"

# 4. Does SSE work (not HTML)?
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' --max-time 3 -H 'Accept: text/event-stream' http://localhost:31313/sse
```

### Platform Notes

**Termux (Android):**
- OpenCode binary is usually at `$PREFIX/bin/opencode` or `$HOME/.opencode/bin/opencode`.
- If `which opencode` fails, add to PATH: `export PATH="$HOME/.opencode/bin:$PATH"`

**Windows:**
- Config path: `%USERPROFILE%\.config\opencode\opencode.json`
- Plugin cache: `%USERPROFILE%\.cache\opencode\packages\@opencoop`

**Mac:**
- Homebrew: `/opt/homebrew/bin/opencode`
- curl script: `~/.opencode/bin/opencode`

## Troubleshooting

### Plugin recognized by OpenCode but UI not loading / MCP not starting

1. **Plugin version too old**: Must be `1.14.0` or newer. Check with `npm ls -g @opencoop/opencode-plugin`.
2. **Stale plugin cache**: Clear and restart:
   ```bash
   rm -rf ~/.cache/opencode/packages/@opencoop
   ```
3. **Port 31313 already in use**: Check with `lsof -i :31313` or `ss -ltnp | grep 31313`.

### MCP stays red / won't connect

1. Make sure the OpenCode web UI (or TUI) is open — the plugin server only starts when OpenCode loads the plugin.
2. Verify the server: `curl http://localhost:31313/health`
3. Verify SSE: `curl -N -H 'Accept: text/event-stream' http://localhost:31313/sse`
4. Make sure your MCP `url` ends with `/sse` (not `/mcp`).

### Invite link shows local IP instead of tunnel URL

1. **Fully restart OpenCode after install/update** — the plugin code loads only at startup.
2. **Wait a few seconds on first run** — the SSH tunnel connects to tinyfi.sh.
3. **Mode must be HOST and saved** — click Save after selecting HOST.
4. **Check the badge**: green = links use the tunnel; red = shows the exact error.

### Tools fail or return errors

Open the web UI (`http://localhost:31313/ui`), select HOST or REMOTE mode and configure your project folder. Tools need a configured workspace before they can read/write files.

## Contributing

Contributions are welcome! Please read the contributing guidelines first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

OpenCOOP Non-Commercial License — Free for non-commercial use, commercial use requires permission.

See [LICENSE](LICENSE) file for details.

## Author

**Hamid Pajand** — [GitHub](https://github.com/Pajand) — [Email](mailto:HamidPajand@gmail.com)

---

<div align="center">

**Made with ❤️ for the OpenCode community**

</div>
