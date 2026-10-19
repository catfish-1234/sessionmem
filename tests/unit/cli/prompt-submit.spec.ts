import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { promptSubmitCommand } from "../../../src/cli/commands/promptSubmit.js";

describe("prompt recall hook", () => {
  it("injects matching prior context without changing access counters", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db, policyConfigPath: "/nonexistent/config.json" });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await service.storeMemory({ projectId: "p", sessionId: "old", memoryId: "m", sourceAdapter: "test", kind: "decision",
        importance: 8, content: "Use SQLite for the ledger database." });
      const ctx = { db, service, dbPath: ":memory:", projectId: "p", username: "test" };
      await promptSubmitCommand(ctx, { prompt: "Which ledger database did we choose?" });
      const payload = JSON.parse(String(write.mock.calls[0][0]));
      expect(payload.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(payload.hookSpecificOutput.additionalContext).toContain("SQLite");
      expect((await service.getMemory({ projectId: "p", memoryId: "m" })).memory.accessCount).toBe(0);
      write.mockClear();
      await promptSubmitCommand(ctx, { prompt: 123 });
      await promptSubmitCommand(ctx, null);
      expect(write).not.toHaveBeenCalled();
    } finally { write.mockRestore(); db.close(); }
  });
});
