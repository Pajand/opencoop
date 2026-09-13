<div align="center">

[![فارسی](https://img.shields.io/badge/🌐-فارسی-blue?style=flat-square)](README.fa.md)

# OpenCOOP

![OpenCOOP](https://img.shields.io/badge/OpenCOOP-v1.2.0-blue)
![License](https://img.shields.io/badge/License-Non--Commercial-blue)
![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-orange)
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
      "url": "http://localhost:31313/mcp",
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
      "url": "http://localhost:31313/mcp",
      "enabled": true
    }
  }
}
```

## Quick Start

1. **Install** the plugin (see above)
2. **Restart** OpenCode
3. **Open** `http://localhost:31313` in your browser
4. **Select** HOST or REMOTE mode
5. **Configure** your project

## Usage Modes

### HOST Mode (Project Owner)

1. Select **HOST** mode in the web UI
2. Choose your **project folder**
3. Click **Generate Invite Link**
4. **Share** the link with team members

### REMOTE Mode (Team Member)

1. **Install** the plugin on your machine
2. Add to your `opencode.json`
3. **Restart** OpenCode
4. Open `http://localhost:31313`
5. Select **REMOTE** mode
6. **Paste** the host's invite link
7. Click **Connect**

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
      "url": "http://localhost:31313/mcp",
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
URL: http://localhost:31313
```

- **HOST mode**: Select folder, generate invite link
- **REMOTE mode**: Paste host's invite link

### Important Notes for AI Agents

1. **Do NOT** manually edit MCP server configuration
2. **Do NOT** run the server as a separate process
3. The plugin **auto-starts** when OpenCode starts
4. All configuration is done through the **web UI**
5. The server runs on **port 31313** by default

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

## License

OpenCOOP Non-Commercial License - Free for non-commercial use, commercial use requires permission.

See [LICENSE](LICENSE) file for details.

## Author

**Hamid Pajand** - [GitHub](https://github.com/Pajand) - [Email](mailto:HamidPajand@gmail.com)
