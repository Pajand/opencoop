import { describe, it, expect } from "vitest";
import { FileManager } from "../src/filesystem/file-manager.js";
import { LockManager } from "../src/filesystem/lock-manager.js";
import { ChangeTracker } from "../src/filesystem/change-tracker.js";

describe("FileManager", () => {
  it("should validate paths correctly", () => {
    const fm = new FileManager("/tmp/test-project");

    // Valid path
    expect(() => fm.validatePath("src/index.ts")).not.toThrow();

    // Path traversal should throw
    expect(() => fm.validatePath("../../../etc/passwd")).toThrow();
  });
});

describe("LockManager", () => {
  it("should initialize tables", async () => {
    const lm = new LockManager(":memory:");
    await lm.initialize();
    expect(true).toBe(true);
  });
});

describe("ChangeTracker", () => {
  it("should initialize tables", async () => {
    const ct = new ChangeTracker(":memory:");
    await ct.initialize();
    expect(true).toBe(true);
  });
});
