import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { readPolicyConfig } from "../../../src/core/config/policyConfig.js";
import { setCustomRedactionPatterns } from "../../../src/core/summarize/redaction.js";
import { openDb } from "../../../src/core/storage/db.js";

const KEY = "acme_live_" + "Q7w".repeat(8);

function configWith(patterns: unknown): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sessionmem-custom-redaction-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ retentionDays: 30, redactionPatterns: patterns }));
  return { path, dir };
}

afterEach(() => { setCustomRedactionPatterns([]); });

describe("redactionPatterns in config.json", () => {
  it("is applied when a memory is stored and by redact-scan on older memories", async () => {
    const { path, dir } = configWith([{ name: "ACME_KEY", pattern: "acme_live_[A-Za-z0-9]{24}" }]);
    const db = openDb();
    try {
      // Stored before the pattern existed: an empty config, then the configured one.
      const before = createMemoryCoreService({ db, policyConfigPath: join(dir, "missing.json") });
      await before.storeMemory({ memoryId: "old", projectId: "p", sessionId: "s", sourceAdapter: "codex", kind: "fact", content: `old note ${KEY}`, importance: 5 });
      expect((await before.getMemory({ projectId: "p", memoryId: "old" })).memory.content).toContain(KEY);

      const service = createMemoryCoreService({ db, policyConfigPath: path });
      await service.storeMemory({ memoryId: "new", projectId: "p", sessionId: "s", sourceAdapter: "codex", kind: "fact", content: `use ${KEY}`, importance: 5 });
      expect((await service.getMemory({ projectId: "p", memoryId: "new" })).memory.content).toBe("use [REDACTED_ACME_KEY]");

      const scan = await service.call("redactExisting", { projectId: "p", apply: true });
      expect(scan.ok && scan.updated).toBe(1);
      expect((await service.getMemory({ projectId: "p", memoryId: "old" })).memory.content).toBe("old note [REDACTED_ACME_KEY]");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the rest of the config when the patterns field is malformed", () => {
    const { path, dir } = configWith("not-a-list");
    try {
      const config = readPolicyConfig(path);
      expect(config.retentionDays).toBe(30);
      expect(config.redactionPatterns).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
