import type { Plugin as OpenCodeV2 } from "@opencode/plugin";
import { bootstrapOpenCOOP, buildOpenCOOPTools } from "./plugin-core.js";

/**
 * OpenCode V2 entry point (Promise plugin API, `@opencode/plugin`).
 *
 * V2 loads a package's default export and expects `{ id, setup(ctx) }`
 * (Plugin.define is an identity function, so the plain object exported by
 * index.ts IS the V2 definition). `setup` receives the V2 context whose
 * `tool.transform` editor registers tools for the AI.
 *
 * Tool input schemas: the V2 host converts tool schemas to JSON Schema for
 * the model API. It supports Effect Schema and RAW JSON Schema — foreign zod
 * instances are rejected ("Schema vendor zod does not support JSON Schema
 * conversion"). We therefore derive plain JSON Schema from our existing zod
 * shapes (single source of truth, zero extra dependencies, and V1 keeps
 * using zod exactly as before).
 *
 * The implementation is shared with V1 via plugin-core, so both generations
 * get identical behavior: tracking, snapshots, rollback, locks, team tools
 * and the REMOTE-mode proxy.
 *
 * NOTE: `@opencode/plugin` is imported TYPE-ONLY on purpose. The V2 host
 * provides the runtime module (imports of `@opencode/plugin` are resolved to
 * the host's own instance), so the package ships without a runtime
 * dependency on it.
 */

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/** Unwrap ZodOptional/ZodDefault chains. */
function unwrapZod(def: any): { schema: any; optional: boolean } {
  let schema = def;
  let optional = false;
  while (
    schema?._def?.typeName === "ZodOptional" ||
    schema?._def?.typeName === "ZodDefault"
  ) {
    if (schema._def.typeName === "ZodOptional") optional = true;
    schema = schema._def.innerType;
  }
  return { schema, optional };
}

/** Convert a zod shape (our fixed subset) to plain JSON Schema. */
function zodShapeToJsonSchema(args: Record<string, any>): JsonSchemaObject {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(args || {})) {
    const { schema, optional } = unwrapZod(def);
    const typeName = schema?._def?.typeName;

    switch (typeName) {
      case "ZodString":
        properties[key] = { type: "string" };
        break;
      case "ZodNumber":
        properties[key] = { type: "number" };
        break;
      case "ZodBoolean":
        properties[key] = { type: "boolean" };
        break;
      case "ZodEnum":
        properties[key] = { type: "string", enum: schema._def.values };
        break;
      case "ZodArray": {
        const innerName = schema._def?.type?._def?.typeName;
        if (innerName === "ZodString") {
          properties[key] = { type: "array", items: { type: "string" } };
        } else if (innerName === "ZodEnum") {
          properties[key] = {
            type: "array",
            items: { type: "string", enum: schema._def.type._def.values },
          };
        } else {
          properties[key] = { type: "array", items: {} };
        }
        break;
      }
      default:
        properties[key] = {};
    }

    if (!optional) required.push(key);
  }

  const result: JsonSchemaObject = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

export async function v2Setup(
  ctx: OpenCodeV2.Context
): Promise<() => Promise<void>> {
  try {
    console.log("[OpenCOOP] V2 plugin setup starting...");

    const b = await bootstrapOpenCOOP();
    if (!b) {
      console.log("[OpenCOOP] V2 setup aborted (bootstrap failed)");
      return async () => {};
    }

    const { tools, dispose } = buildOpenCOOPTools(b);

    await ctx.tool.transform((editor) => {
      for (const [name, t] of Object.entries(tools)) {
        editor.add({
          name,
          options: { codemode: false },
          description: t.description,
          input: zodShapeToJsonSchema(t.args),
          execute: async (input: unknown) => {
            try {
              const result = await t.execute(input ?? {}, {});
              return {
                content: typeof result === "string" ? result : JSON.stringify(result),
              };
            } catch (err) {
              return {
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
              };
            }
          },
        });
      }
    });

    console.log(`[OpenCOOP] V2: registered ${Object.keys(tools).length} tools`);

    return async () => {
      try {
        await dispose();
      } catch {}
    };
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    console.log("[OpenCOOP] V2 fatal error (suppressed):", msg);
    return async () => {};
  }
}
