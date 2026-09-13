<div dir="rtl">

# OpenCOOP | اوپن‌کوپ

</div>

<div align="center">

![OpenCOOP](https://img.shields.io/badge/OpenCOOP-v1.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-orange)
![Node](https://img.shields.io/badge/Node.js-18+-black)

**OpenCode plugin for real-time team collaboration via shared MCP server**

**پلاگین اوپن‌کد برای همکاری تیمی بلادرنگ از طریق سرور MCP مشترک**

</div>

---

## 🇬🇧 English

### What is OpenCOOP?

OpenCOOP is an **OpenCode plugin** that enables multiple developers to collaborate on the same project simultaneously. Each developer runs their own OpenCode with their own AI, but they all connect to the **same MCP server** — giving every person's AI direct read/write access to a shared project folder.

### Key Features

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

### Installation

#### Option 1: Install via npm (Recommended)

```bash
npm install -g @opencoop/opencode-plugin
```

Then add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@opencoop/opencode-plugin"]
}
```

#### Option 2: Install from GitHub

```bash
git clone https://github.com/HamidPajand/opencoop.git
cd opencoop
npm install
npm run build
npm link
```

Then add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencoop"]
}
```

### Quick Start

1. **Install** the plugin (see above)
2. **Restart** OpenCode
3. **Open** `http://localhost:31313` in your browser
4. **Select** HOST or REMOTE mode
5. **Configure** your project

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

### MCP Tools

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

### Configuration

The server runs on port **31313** by default. You can configure it through the web UI.

### Architecture

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

### License

MIT License - see [LICENSE](LICENSE) file.

---

## 🇮🇷 فارسی

### اوپن‌کوپ چیست؟

اوپن‌کوپ یک **پلاگین اوپن‌کد** است که به چندین توسعه‌دهنده اجازه می‌دهد به طور همزمان روی یک پروژه مشترک کار کنند. هر توسعه‌دهنده اوپن‌کد خود را با هوش مصنوعی خود اجرا می‌کند، اما همه به **سرور MCP مشترک** متصل می‌شوند — به طوری که هوش مصنوعی هر شخص دسترسی مستقیم خواندن/نوشتن به پوشه پروژه مشترک دارد.

### ویژگی‌های کلیدی

| ویژگی | توضیحات |
|-------|---------|
| 🔗 **سرور MCP مشترک** | چندین نمونه اوپن‌کد یک پروژه را به اشتراک می‌گذارند |
| 👥 **همکاری بلادرنگ** | ببینید چه کسی چه چیزی را ویرایش می‌کند |
| 📝 **ردیابی تغییرات** | هر تغییر فایل با نسبت کاربر ثبت می‌شود |
| 🔒 **قفل فایل** | از تداخل جلوگیری می‌کند |
| 🌐 **داشبورد وب** | رابط کاربری زیبا برای پیکربندی و نظارت |
| 🔑 **سیستم دعوت** | دعوت امن اعضا با توکن |
| 🛡️ **امنیت سندباکس** | محافظت در برابر عبور مسیر و اعتبارسنجی ورودی |
| 📊 **آمار** | مشاهده تغییرات به ازای هر کاربر و فعالیت اخیر |

### نصب

#### روش ۱: نصب از npm (توصیه شده)

```bash
npm install -g @opencoop/opencode-plugin
```

سپس در فایل `~/.config/opencode/opencode.json` اضافه کنید:

```json
{
  "plugin": ["@opencoop/opencode-plugin"]
}
```

#### روش ۲: نصب از GitHub

```bash
git clone https://github.com/HamidPajand/opencoop.git
cd opencoop
npm install
npm run build
npm link
```

سپس در `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencoop"]
}
```

### شروع سریع

1. **پلاگین را نصب کنید** (بالا)
2. **اوپن‌کد را مجدداً راه‌اندازی کنید**
3. **مرورگر را باز کنید**: `http://localhost:31313`
4. **حالت HOST یا REMOTE را انتخاب کنید**
5. **پروژه را پیکربندی کنید**

### حالت HOST (مالک پروژه)

1. حالت **HOST** را در رابط وب انتخاب کنید
2. **پوشه پروژه** را انتخاب کنید
3. روی **ایجاد لینک دعوت** کلیک کنید
4. **لینک را با اعضای تیم به اشتراک بگذارید**

### حالت REMOTE (عضو تیم)

1. **پلاگین را روی ماشین خود نصب کنید**
2. به `opencode.json` اضافه کنید
3. **اوپن‌کد را مجدداً راه‌اندازی کنید**
4. `http://localhost:31313` را باز کنید
5. حالت **REMOTE** را انتخاب کنید
6. **لینک میزبان را Paste کنید**
7. روی **اتصال** کلیک کنید

### ابزارهای MCP

پس از اتصال، هوش مصنوعی شما به این ابزارها دسترسی دارد:

| ابزار | توضیحات |
|-------|---------|
| `read_file` | خواندن محتوای فایل از پروژه مشترک |
| `write_file` | ایجاد یا بازنویسی فایل‌ها |
| `edit_file` | ویرایش هدفمند با جستجو و جایگزینی |
| `list_files` | فهرست کردن محتوای پوشه |
| `search_files` | جستجوی فایل‌ها با الگوی glob |
| `grep_content` | جستجوی محتوای فایل با regex |
| `directory_tree` | دریافت نمای ساختار پوشه |
| `lock_file` | دریافت قفل انحصاری قبل از ویرایش |
| `unlock_file` | آزاد کردن قفل پس از ویرایش |
| `view_changes` | مشاهده تغییرات اخیر اعضای تیم |
| `view_stats` | مشاهده آمار پروژه |
| `who_is_online` | مشاهده کاربران آنلاین |
| `invite_member` | ایجاد لینک دعوت برای اعضای جدید |
| `list_members` | فهرست تمام اعضای تیم |
| `revoke_access` | لغو دسترسی یک عضو |

### مجوز

مجوز MIT - فایل [LICENSE](LICENSE) را ببینید.

---

## 🤖 AI Agent Instructions | راهنمای عامل هوش مصنوعی

**If you are an AI agent reading this, follow these exact steps to install and configure OpenCOOP:**

**اگر شما یک عامل هوش مصنوعی هستید که این متن را می‌خوانید، مراحل زیر را دقیقاً دنبال کنید:**

### Step 1: Install | مرحله ۱: نصب

```bash
# Check if OpenCode is installed
# بررسی نصب بودن اوپن‌کد
which opencode || echo "OpenCode not found - user needs to install it first"

# Install OpenCOOP globally
# نصب اوپن‌کوپ به صورت سراسری
npm install -g @opencoop/opencode-plugin
```

### Step 2: Configure | مرحله ۲: پیکربندی

```bash
# Read current opencode config
# خواندن پیکربندی فعلی اوپن‌کد
cat ~/.config/opencode/opencode.json 2>/dev/null || echo "{}"
```

Add the plugin to `opencode.json`:

```json
{
  "plugin": ["@opencoop/opencode-plugin"]
}
```

### Step 3: Verify Installation | مرحله ۳: تأیید نصب

```bash
# Check if plugin is installed correctly
# بررسی نصب صحیح پلاگین
npm list -g @opencoop/opencode-plugin

# The server should start automatically on port 31313 when OpenCode starts
# سرور باید به طور خودکار روی پورت 31313 شروع شود
```

### Step 4: Access Web UI | مرحله ۴: دسترسی به رابط وب

```
URL: http://localhost:31313
```

- HOST mode: Select folder, generate invite link
- REMOTE mode: Paste host's invite link

### Important Notes for AI Agents | نکات مهم برای عوامل هوش مصنوعی

1. **Do NOT** manually edit MCP server configuration in `opencode.json`
2. **Do NOT** run the server as a separate process
3. The plugin **auto-starts** when OpenCode starts
4. All configuration is done through the **web UI** at `http://localhost:31313`
5. The server runs on **port 31313** by default

**۱. فایل پیکربندی `opencode.json` را به صورت دستی ویرایش نکنید**
**۲. سرور را به عنوان فرآیند جداگانه اجرا نکنید**
**۳. پلاگین **خودکار** شروع می‌شود**
**۴. تمام پیکربندی از طریق **رابط وب** انجام می‌شود**
**۵. سرور روی **پورت 31313** اجرا می‌شود**

### For Remote Collaboration | برای همکاری از راه دور

```
Host generates invite link → shares with team
Team members install plugin → paste link in web UI
All members connect to same MCP server
Changes are tracked and visible to everyone
```

---

<div dir="rtl">

**نویسنده: حمید پجند**
**آخرین به‌روزرسانی: سپتامبر ۲۰۲۶**
**نسخه: ۱.۰.۰**

</div>

<div align="center">

**Author: Hamid Pajand**
**Last Updated: September 2026**
**Version: 1.0.0**

[![GitHub](https://img.shields.io/badge/GitHub-Profile-181717?style=for-the-badge&logo=github)](https://github.com/HamidPajand)
[![Email](https://img.shields.io/badge/Email-HamidPajand@gmail.com-D14836?style=for-the-badge&logo=gmail)](mailto:HamidPajand@gmail.com)

</div>
