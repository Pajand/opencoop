# گزارش مشکل و راه‌حل OpenCOOP Plugin

## خلاصه مشکل

پلاگین OpenCOOP (نسخه 1.1.1 منتشرشده روی npm) با opencode نسخه 1.17+ سازگار نیست.
علت: فرمت export پلاگین تغییر کرده و فرمت قدیمی ساکت نادیده گرفته می‌شود (هیچ خطا نمایش داده نمی‌شود).

---

## ریشه مشکل (Root Cause)

### ۱. فرمت پلاگین در opencode 1.17+

فایل لودر: `packages/core/src/config/plugin/external.ts`

```ts
const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<EffectPlugin["effect"]>(
        (input): input is EffectPlugin["effect"] => typeof input === "function",
      ),
    }),
    Schema.Struct({
      id: Schema.String,
      setup: Schema.declare<PromisePlugin["setup"]>(
        (input): input is PromisePlugin["setup"] => typeof input === "function",
      ),
    }),
  ]),
})
```

یعنی default export باید حتماً شامل `id` و `setup` یا `effect` باشد.

### ۲. فرمت فعلی پلاگین (مشکل‌دار)

فایل: `src/index.ts` (نسخه 1.1.1)

```ts
export type { PluginModule } from "@opencode-ai/plugin";

const plugin: PluginModule = {
  id: "opencoop",
  server,  // ❌ فرمت قدیمی - opencode 1.17+ نمی‌شناسد
};
export default plugin;
```

opencode فرمت `{id, server}` را نمی‌شناسد → `Schema.decodeUnknownEffect` خطا میدهد → `Effect.ignoreCause` خطا را جذب می‌کند → پلاگین ساکت نادیده گرفته می‌شود.

### ۳. چرا متوجه نمی‌شویم؟

1. پکیج npm وارد کش می‌شود (`~/.cache/opencode/packages/@opencoop/opencode-plugin`)
2. پلاگین «شناخته» می‌شود (config آن را قبول می‌کند)
3. ولی هوک `server` هیچوقت اجرا نمی‌شود
4. سرور HTTP روی پورت 31313 بالا نمی‌آید
5. هیچ خطایی لاگ نمی‌شود (Effect.ignoreCause)

---

## راه‌حل

### تغییر مورد نیاز در `src/index.ts`

**قبل (فرمت قدیمی - مشکل‌دار):**
```ts
import type { PluginModule, PluginInput, Hooks } from "@opencode-ai/plugin";
// ...
const server = async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
  // ...
  const config = await loadConfig(input.project);
  // ...
  return {
    dispose: async () => { /* cleanup */ },
  };
};
const plugin: PluginModule = {
  id: "opencoop",
  server,
};
export default plugin;
```

**بعد (فرمت جدید - اصلاح شده):**
```ts
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { OpenCOOPServer } from "./server/mcp-server.js";

let serverInstance: OpenCOOPServer | null = null;
let serverReady = false;

function waitForServer(timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (serverReady) resolve(true);
      else if (Date.now() - start > timeoutMs) resolve(false);
      else setTimeout(check, 100);
    };
    check();
  });
}

async function startServer() {
  console.log("[OpenCOOP] Plugin loading...");
  logger.info("OpenCOOP plugin loading...");
  try {
    const config = await loadConfig();
    const port = config.port || 31313;
    serverInstance = new OpenCOOPServer(config);
    await serverInstance.startHttp(port);
    serverReady = true;
    console.log(`[OpenCOOP] Server ready on port ${port}`);
    logger.info("OpenCOOP server started on port %d", port);
  } catch (error) {
    serverReady = false;
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[OpenCOOP] Failed to start:", msg);
    logger.error("Failed to start OpenCOOP: %s", msg);
  }
}

const plugin = {
  id: "opencoop",
  setup: async (): Promise<void> => {
    await startServer();
  },
};

export default plugin;
export { OpenCOOPServer, waitForServer };
export type { ServerConfig } from "./types/index.js";
```

### تغییرات کلیدی:
1. `server` → `setup` (فرمت مورد قبول opencode 1.17+)
2. حذف `dispose` (API جدید dispose hook ندارد)
3. حذف وابستگی به `@opencode-ai/plugin` types (نیازی به import نیست)
4. حذف پارامتر `input.project` از `loadConfig` (این پارامتر اصلاً استفاده نمی‌شد)

---

## مراحل اعمال تغییر

### ۱. اصلاح کد
```bash
# کلون ریپازیتوری
git clone https://github.com/Pajand/opencoop.git
cd opencoop

# ویرایش src/index.ts
# (محتوای بالا را جایگزین کنید)
```

### ۲. بیلد
```bash
npm install
npm run build
```

### ۳. تست locally
```bash
npm link
# سپس در پوشه config opencode:
cd ~/.config/opencode
npm link @opencoop/opencode-plugin
```

### ۴. انتشار
```bash
# افزایش نسخه در package.json (مثلاً 1.2.0)
npm publish
```

### ۵. نصب کاربران
```bash
opencode plugin @opencoop/opencode-plugin --force
# یا مستقیم:
npm install -g @opencoop/opencode-plugin
# سپس ریاستارت opencode
```

---

## فایل‌های تغییر یافته

| فایل | توضیح |
|------|-------|
| `src/index.ts` | تغییر فرمت export پلاگین |
| `dist/index.js` | با `npm run build` بازسازی می‌شود |

---

## نکات مهم

1. **opencode.log**: بعد از فیکس، لاگ زیر باید ظاهر شود:
   ```
   [OpenCOOP] Plugin loading...
   [OpenCOOP] Server ready on port 31313
   ```

2. **تست پورت**: بعد از ریاستارت opencode:
   ```bash
   curl http://localhost:31313/health
   # پاسخ: {"status":"ok","version":"1.0.0"}
   ```

3. **نسخه opencode**: این فیکس برای opencode >= 1.17.x مورد نیاز است. نسخه‌های قدیمی‌تر از فرمت `server` پشتیبانی می‌کنند.

4. **API جدید**: برای اطلاعات بیشتر به مستندات رسمی مراجعه کنید:
   - https://opencode.ai/docs/plugins/
   - `@opencode-ai/plugin/v2/promise` (Plugin interface)

5. **گارانتی cleanup**: در API جدید، hook `dispose` وجود ندارد. سرور HTTP هنگام بسته شدن پراسس متوقف می‌شود. اگر cleanup ضروری است، باید از `context.plugin.add` استفاده کرد (API پیچیده‌تر).

---

## وضعیت فعلی نصب (این سیستم)

- [x] پکیج npm نصب شده (`@opencoop/opencode-plugin@1.1.1`)
- [x] کش opencode آپدیت شده با بیلد فیکس‌شده
- [x] کانفیگ `~/.config/opencode/opencode.jsonc` تنظیم شده
- [ ] نیاز به ریاستارت opencode دارد (برای اعمال تغییرات)

### دستور ریاستارت:
```bash
# opencode اصلی (پورت 3003) را ریاستارت کنید
# سپس http://localhost:31313 را در مرورگر باز کنید
```
