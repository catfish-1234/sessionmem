import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";

describe("entities CLI", () => {
  it("lists project-scoped entities, relations and provenance through the real binary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "entities-cli-"));
    const dbPath = join(directory, "memories.db");
    const db = openDb({ dbPath });
    try {
      for (const project_id of ["selected", "other"]) insertMemory(db, {
        id: project_id, project_id, session_id: "s", source_adapter: "test", kind: "fact",
        content: "Alice uses SQLite.", normalized_content: "alice uses sqlite.", importance: 5,
      });
      const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli/index.js"), "entities", ...args], {
        env: { ...process.env, SESSIONMEM_DB_PATH: dbPath, SESSIONMEM_PROJECT_ID: "other" },
      });
      const result = await run(["--project", "selected", "--json"]);
      const json = JSON.parse(result.stdout);
      expect(json.projectId).toBe("selected");
      expect(json.relations[0]).toMatchObject({ relation: "uses", sourceName: "alice", targetName: "sqlite", memoryIds: ["selected"] });
      const text = (await run([])).stdout;
      expect(text).toContain("Entities for other:");
      expect(text).toContain("alice --uses--> [tool] sqlite (memories: other)");
      expect((await run(["--project", "empty"])).stdout).toContain("No entities captured.");
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
