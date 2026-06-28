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
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  it("exportCommand writes a valid JSON array with the seeded memory count", async () => {
    ctx = await createTestCliContext();
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
    ctx = await createTestCliContext();
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
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = makeTempFile();
    let freshDb: ReturnType<typeof openDb> | undefined;

    try {
      // Export from source context
      await exportCommand(outPath, ctx);

      // Create a second fresh context (separate in-memory DB)
      freshDb = openDb();
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
      freshDb?.close();
    }
  });

  it("preserves full content over 2000 chars through export → import (no truncation)", async () => {
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = makeTempFile();
    let freshDb: ReturnType<typeof openDb> | undefined;

    // Content longer than RETRIEVE_CONTENT_MAX_LENGTH (2000) but within
    // MAX_CONTENT_LENGTH (10000). Regression guard: exportMemories must not
    // reuse the 2000-char MCP-response cap, which would permanently truncate
    // this body on the export → import round-trip.
    const longContent = "decision: " + "x".repeat(5000);

    try {
      const storeRes = await ctx.service.call("storeMemory", {
        memoryId: "long-mem-001",
        projectId: ctx.projectId,
        sessionId: "s-long",
        sourceAdapter: "test",
        kind: "decision",
        content: longContent,
        importance: 8,
      });
      expect(storeRes.ok).toBe(true);
      if (!storeRes.ok) throw new Error("store failed");
      // The single-record storeMemory response echoes the FULL stored body
      // (toExportMemoryDto), not a 2000-char MCP-response slice — regression
      // guard for the store echo-back path.
      expect(storeRes.memory.content).toBe(longContent);
      expect(storeRes.memory.content.length).toBeGreaterThan(2000);

      await exportCommand(outPath, ctx);

      // The raw export file must carry the full content, not a 2000-char slice.
      const arr = JSON.parse(readFileSync(outPath, "utf8")) as Array<{
        id: string;
        content: string;
      }>;
      const exported = arr.find((r) => r.id === "long-mem-001");
      expect(exported?.content).toBe(longContent);

      // And the round-tripped record in a fresh DB keeps the full content.
      freshDb = openDb();
      const freshService = createMemoryCoreService({ db: freshDb });
      const freshCtx = { db: freshDb, service: freshService, projectId: "test-project", dbPath: ":memory:" };
      await importCommand(outPath, {}, freshCtx);

      // Read the stored row directly: getMemory's DTO caps content at 2000 by
      // design, so assert against the DB to confirm the full body persisted.
      const row = freshDb
        .prepare("SELECT content FROM memories WHERE id = ?")
        .get("long-mem-001") as { content: string } | undefined;
      expect(row?.content).toBe(longContent);
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
      freshDb?.close();
    }
  });

  it("importCommand without --merge skips duplicate IDs and prints correct counts", async () => {
    ctx = await createTestCliContext();
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

  it("importCommand with --merge does NOT overwrite existing same-project memories (skipped)", async () => {
    ctx = await createTestCliContext();
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
      expect(logCalls.some((msg) => msg.includes("Imported (merged)"))).toBe(true);

      // Security: existing same-project ids are skipped, not overwritten, so the
      // record retains its original importance (7), not the modified 3.
      const getResult = await ctx.service.call("getMemory", {
        projectId: ctx.projectId,
        memoryId: "test-mem-001",
      });
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.memory.importance).toBe(7);
      }

      if (existsSync(modifiedPath)) unlinkSync(modifiedPath);
    } finally {
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  it("importCommand exits non-zero when JSON file is missing or invalid", async () => {
    ctx = await createTestCliContext();
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
    ctx = await createTestCliContext();
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
    ctx = await createTestCliContext();
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
