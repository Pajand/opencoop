<div align="center">

[![English](https://img.shields.io/badge/🌐-English-green?style=flat-square)](README.md)

# اوپن‌کوپ

![OpenCOOP](https://img.shields.io/badge/OpenCOOP-v1.6.8-blue)
![License](https://img.shields.io/badge/License-Non--Commercial-blue)
![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple)
![MCP](https://img.shields.io/badge/MCP-SSE-orange)
![Node](https://img.shields.io/badge/Node.js-18+-black)

**پلاگین اوپن‌کد برای همکاری تیمی بلادرنگ از طریق سرور MCP مشترک**

</div>

---

## اوپن‌کوپ چیست؟

اوپن‌کوپ یک **پلاگین اوپن‌کد** است که به چندین توسعه‌دهنده اجازه می‌دهد به طور همزمان روی یک پروژه مشترک کار کنند. هر توسعه‌دهنده اوپن‌کد خود را با هوش مصنوعی خود اجرا می‌کند، اما همه به **سرور MCP مشترک** متصل می‌شوند — به طوری که هوش مصنوعی هر شخص دسترسی مستقیم خواندن/نوشتن به پوشه پروژه مشترک دارد.

```
توسعه‌دهنده A (از راه دور)        توسعه‌دهنده B (از راه دور)
      │                              │
      ▼                              ▼
  اوپن‌کد + هوش مصنوعی            اوپن‌کد + هوش مصنوعی
      │                              │
      └──────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   سرور اوپن‌کوپ MCP    │
        │   (پورت 31313)         │
        └────────────┬───────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   پوشه پروژه مشترک     │
        └────────────────────────┘
```

## ویژگی‌های کلیدی

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

## نصب

### روش ۱: نصب از npm (توصیه شده)

```bash
npm install -g @opencoop/opencode-plugin
```

سپس در فایل `~/.config/opencode/opencode.json` اضافه کنید:

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

### روش ۲: نصب از GitHub

```bash
git clone https://github.com/Pajand/opencoop.git
cd opencoop
npm install
npm run build
npm link
```

سپس در `~/.config/opencode/opencode.json`:

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

## شروع سریع

1. **پلاگین را نصب کنید** (بالا)
2. **اوپن‌کد را مجدداً راه‌اندازی کنید**
3. **مرورگر را باز کنید**: `http://localhost:31313/ui`
4. **حالت HOST یا REMOTE را انتخاب کنید**
5. **پروژه را پیکربندی کنید**

## حالت‌های استفاده

### حالت HOST (مالک پروژه)

1. حالت **HOST** را در رابط وب انتخاب کنید
2. **پوشه پروژه** را انتخاب کنید
3. روی **ایجاد لینک دعوت** کلیک کنید
4. **لینک را با اعضای تیم به اشتراک بگذارید**

### حالت REMOTE (عضو تیم)

1. **پلاگین را روی ماشین خود نصب کنید**
2. به `opencode.json` اضافه کنید
3. **اوپن‌کد را مجدداً راه‌اندازی کنید**
4. `http://localhost:31313/ui` را باز کنید
5. حالت **REMOTE** را انتخاب کنید
6. **لینک میزبان را Paste کنید**
7. روی **اتصال** کلیک کنید

## ابزارهای MCP

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

## راهنمای عامل هوش مصنوعی

**اگر شما یک عامل هوش مصنوعی هستید که این متن را می‌خوانید، مراحل زیر را دقیقاً دنبال کنید:**

### مرحله ۱: نصب

```bash
# بررسی نصب بودن اوپن‌کد
which opencode || echo "OpenCode نصب نیست - کاربر باید ابتدا آن را نصب کند"

# نصب اوپن‌کوپ به صورت سراسری
npm install -g @opencoop/opencode-plugin
```

### مرحله ۲: پیکربندی

```bash
# خواندن پیکربندی فعلی اوپن‌کد
cat ~/.config/opencode/opencode.json 2>/dev/null || echo "{}"
```

پلاگین را به `opencode.json` اضافه کنید:

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

### مرحله ۳: تأیید نصب

```bash
# بررسی نصب صحیح پلاگین
npm list -g @opencoop/opencode-plugin
```

### مرحله ۴: دسترسی به رابط وب

```
آدرس: http://localhost:31313/ui
```

- **حالت HOST**: پوشه را انتخاب کنید، لینک دعوت ایجاد کنید
- **حالت REMOTE**: لینک میزبان را Paste کنید

### نکات مهم برای عوامل هوش مصنوعی

1. **ویرایش نکنید** پیکربندی سرور MCP را به صورت دستی
2. **اجرا نکنید** سرور را به عنوان فرآیند جداگانه
3. پلاگین **خودکار شروع می‌شود** هنگام شروع اوپن‌کد
4. تمام پیکربندی از طریق **رابط وب** انجام می‌شود
5. سرور روی **پورت 31313** اجرا می‌شود

### نکات پلتفرمی برای عوامل هوش مصنوعی

**هنگام کمک به کاربر، ابتدا این عیب‌یابی‌ها را اجرا کنید:**

```bash
# ۱. آیا اوپن‌کد نصب و در دسترس است؟
which opencode || echo "NOT IN PATH"
opencode --version 2>&1 | head -1

# ۲. آیا پلاگین نصب است؟
npm ls -g @opencoop/opencode-plugin 2>&1

# ۳. آیا سرور HTTP بالاست؟
curl -s --max-time 3 http://localhost:31313/health || echo "SERVER DOWN"

# ۴. آیا SSE کار می‌کند (نه HTML)؟
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' --max-time 3 -H 'Accept: text/event-stream' http://localhost:31313/sse
```

**اگه `which opencode` چیزی برنگردوند:**
- کاربر فقط پلاگین npm رو نصب کرده، نه خود اوپن‌کد رو. پکیج npm پلاگین، خود اوپن‌کد نیست.
- به کاربر بگو اوپن‌کد رو نصب کنه: `curl -fsSL https://opencode.ai/install | bash`

**اگه اوپن‌کد نصبه ولی `curl localhost:31313/health` جواب نمیده:**
- ممکنه نسخه پلاگین قدیمی باشه (بدون فیکس سرور HTTP).
- نسخه رو چک کن: `npm ls -g @opencoop/opencode-plugin` — باید `1.6.8` یا بالاتر باشه.
- کش پلاگین رو پاک کن: `rm -rf ~/.cache/opencode/packages/@opencoop`
- اوپن‌کد رو ری‌استارت کن.

**اگه `curl /sse` به جای event-stream، HTML برمی‌گردوند:**
- نسخه پلاگین در حال اجرا قدیمی‌تر از 1.6.6 است.
- آپدیت: `npm install -g @opencoop/opencode-plugin@latest`
- کش رو پاک کن: `rm -rf ~/.cache/opencode/packages/@opencoop`
- اوپن‌کد رو ری‌استارت کن.

**ترمکس (اندروید):**
- باینری اوپن‌کد معمولاً توی `$PREFIX/bin/opencode` یا `$HOME/.opencode/bin/opencode` هست.
- اگه `which opencode` خالی برگردوند، مسیر نصب رو به PATH اضافه کن: `export PATH="$HOME/.opencode/bin:$PATH"` و این خط رو به `~/.bashrc` اضافه کن.
- پورت 31313 ممکنه توسط اندروید بلاک بشه — اول `curl http://localhost:31313/health` رو داخل خود تermuks بزن (نه از مرورگر دستگاه دیگه) تا مطمئن بشی سرور لوکال بالاست.

**ویندوز:**
- مسیر کانفیگ: `%USERPROFILE%\.config\opencode\opencode.json` (نه `~/.config`).
- کش پلاگین: `%USERPROFILE%\.cache\opencode\packages\@opencoop`.
- مسیر نصب اوپن‌کد متفاوته — با `where opencode` چک کن.

**مک:**
- اگه با Homebrew نصب شده، اوپن‌کد توی `/opt/homebrew/bin/opencode` هست.
- اگه با اسکریپت curl نصب شده، توی `~/.opencode/bin/opencode` هست — مطمئن شو توی PATH هست.

## عیب‌یابی

### پلاگین شناخته شده ولی UI بالا نمیاد / MCP شروع نمیشه

یعنی اوپن‌کد ماژول پلاگین رو لود کرده ولی سرور HTTP بالا نیومده. دلایل رایج:

1. **نسخه پلاگین خیلی قدیمیه**: باید `1.6.8` یا بالاتر باشه. با `npm ls -g @opencoop/opencode-plugin` چک کن.
2. **کش قدیمی پلاگین**: اوپن‌کد پلاگین‌ها رو توی `~/.cache/opencode/packages/@opencoop` کش می‌کنه. بعد از آپدیت پاکش کن:
   ```bash
   rm -rf ~/.cache/opencode/packages/@opencoop
   ```
   ویندوز: `%USERPROFILE%\.cache\opencode\packages\@opencoop` رو پاک کن.
3. **پورت 31313 اشغاله**: برنامه دیگه‌ای پورت رو گرفته. با `lsof -i :31313` چک کن.
4. **اوپن‌کد توی PATH نیست**: باینری هست ولی قابل دسترسی نیست. با `which opencode` چک کن.
5. **ترمکس/اندروید**: پورت ممکنه بلاک باشه. اول لوکال تست کن: `curl http://localhost:31313/health`

### ام‌سی‌پی قرمز می‌ماند / وصل نمی‌شود
1. مطمئن شوید رابط وب (یا ترمینال) اوپن‌کد باز است — سرور پلاگین فقط وقتی بالا می‌آید که اوپن‌کد پلاگین را لود کند.
2. بررسی سرور: `curl http://localhost:31313/health` باید `{"status":"ok",...}` برگرداند.
3. بررسی SSE: `curl -N -H 'Accept: text/event-stream' http://localhost:31313/sse` باید `event: endpoint` چاپ کند (نه HTML).
4. مطمئن شوید آدرس `url` در تنظیمات ام‌سی‌پی با `/sse` تمام می‌شود (نه `/mcp`).

### ابزارها خطا می‌دهند
رابط وب (`http://localhost:31313/ui`) را باز کنید، حالت HOST یا REMOTE را انتخاب و پوشه پروژه را تنظیم کنید. ابزارها قبل از پیکربندی فضای کاری نمی‌توانند فایل بخوانند/بنویسند.

### پورت 31313 اشغال است
فقط اولین نمونه اوپن‌کد سرور را بالا می‌آورد؛ بقیه از همان استفاده می‌کنند. اگر برنامه دیگری پورت را گرفته، `port` را در `~/.opencoop/config.json` عوض کنید (و آدرس ام‌سی‌پی را هم مطابق آن).

### رفتار قدیمی بعد از آپدیت (کش قدیمی پلاگین)
اوپن‌کد پلاگین‌ها را در `~/.cache/opencode/packages/` کش می‌کند. بعد از آپدیت با `npm i -g @opencoop/opencode-plugin@latest`، کش را پاک و اوپن‌کد را ری‌استارت کنید:
```bash
rm -rf ~/.cache/opencode/packages/@opencoop
```

## مجوز

لایسنس غیرتجاری اوپن‌کوپ - استفاده رایگان غیرتجاری، استفاده تجاری نیاز به اجازه دارد.

جزئیات در فایل [LICENSE](LICENSE)

## نویسنده

**حمید پژند** - [GitHub](https://github.com/Pajand) - [ایمیل](mailto:HamidPajand@gmail.com)
