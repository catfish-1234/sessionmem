import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { exportCommand } from "../../../src/cli/commands/export.js";
import { importCommand } from "../../../src/cli/commands/import.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

function makeTempFile(suffix = ".json"): string {
  return join(tmpdir(), `sessionmem-test-${randomUUID()}${suffix}`);
}

describe("export/import round-trip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exportCommand writes a valid JSON array with the seeded memory count", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = makeTempFile();

    try {
      await exportCommand(outPath, ctx);

      // File must exist and be parseable
      const raw = readFileSync(outPath, "utf8");
      const arr = JSON.parse(raw);
      expect(Array.isArray(arr)).toBe(true);
      // createTestCliContext seeds 3 memories
      expect(arr.length).toBe(3);

      const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
      expect(logCalls.some((msg) => msg.includes("Exported 3 memories to"))).toBe(true);
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  it("exportCommand uses an ISO-dated default path when no path argument is given", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await exportCommand(undefined, ctx);

    // Log should mention the export- path
    const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((msg) => msg.includes("export-"))).toBe(true);
    // Extract the path from the log and clean up
    const exportLog = logCalls.find((msg) => msg.includes("export-"));
    if (exportLog) {
      const match = exportLog.match(/Exported \d+ memories to (.+)/);
      if (match && existsSync(match[1])) unlinkSync(match[1]);
    }
  });

  it("lossless round-trip: export then import into fresh context returns same records", async () => {
    const ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = makeTempFile();

    try {
      // Export from source context
      await exportCommand(outPath, ctx);

      // Create a second fresh context (separate in-memory DB)
      const freshDb = openDb();
      const freshService = createMemoryCoreService({ db: freshDb });
      const freshCtx = { db: freshDb, service: freshService, projectId: "test-project", dbPath: ":memory:" };

      // Import into the fresh context
      await importCommand(outPath, {}, freshCtx);

      // Verify lossless: all 3 seeded memories are present
      const listResult = await freshService.listMemories({ projectId: "test-project" });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.memories.length).toBe(3);
        const ids = listResult.memories.map((m) => m.id);
        expect(ids).toContain("test-mem-001");
        expect(ids).toContain("test-mem-002");
        expect(ids).toContain("test-mem-003");
      }
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  it("importCommand without --merge skips duplicate IDs and prints correct counts", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = makeTempFile();

    try {
      // Export from seeded context
      await exportCommand(outPath, ctx);

      // Re-import into the SAME context (all 3 IDs already exist)
      await importCommand(outPath, {}, ctx);

      const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
      // Imported 0, skipped 3 duplicates
      expect(logCalls.some((msg) => msg.includes("skipped 3 duplicates"))).toBe(true);

      // Existing records should be unchanged
      const listResult = await ctx.service.listMemories({ projectId: ctx.projectId });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.memories.length).toBe(3);
      }
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  it("importCommand with --merge overwrites existing memories via upsert", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = makeTempFile();

    try {
      // Export from seeded context
      await exportCommand(outPath, ctx);

      // Modify one record in the file to have different importance
      const raw = readFileSync(outPath, "utf8");
      const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
      const idx = arr.findIndex((r) => r.id === "test-mem-001");
      arr[idx] = { ...arr[idx], importance: 3 }; // was 7
      // We need a writable path for the modified file
      const modifiedPath = makeTempFile();
      const { writeFileSync } = await import("fs");
      writeFileSync(modifiedPath, JSON.stringify(arr, null, 2), "utf8");

      // Import with --merge
      await importCommand(modifiedPath, { merge: true }, ctx);

      const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
      expect(logCalls.some((msg) => msg.includes("skipped 0 duplicates"))).toBe(true);

      // Verify the record was overwritten with importance 3
      const getResult = await ctx.service.call("getMemory", {
        projectId: ctx.projectId,
        memoryId: "test-mem-001",
      });
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.memory.importance).toBe(3);
      }

      if (existsSync(modifiedPath)) unlinkSync(modifiedPath);
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  it("importCommand exits non-zero when JSON file is missing or invalid", async () => {
    const ctx = await createTestCliContext();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });

    // Non-existent file
    await expect(
      importCommand("/non-existent-path/import.json", {}, ctx),
    ).rejects.toThrow("process.exit called");

    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("importCommand exits non-zero when file contains malformed JSON", async () => {
    const { writeFileSync } = await import("fs");
    const ctx = await createTestCliContext();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });

    const badPath = makeTempFile();
    writeFileSync(badPath, '{ not valid json: [', "utf8");

    try {
      await expect(
        importCommand(badPath, {}, ctx),
      ).rejects.toThrow("process.exit called");

      expect(errSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      if (existsSync(badPath)) unlinkSync(badPath);
    }
  });

  it("importCommand exits non-zero when import JSON is not an array", async () => {
    const { writeFileSync } = await import("fs");
    const ctx = await createTestCliContext();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });

    const badPath = makeTempFile();
    writeFileSync(badPath, JSON.stringify({ not: "an array" }), "utf8");

    try {
      await expect(
        importCommand(badPath, {}, ctx),
      ).rejects.toThrow("process.exit called");

      expect(errSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      if (existsSync(badPath)) unlinkSync(badPath);
    }
  });
});
