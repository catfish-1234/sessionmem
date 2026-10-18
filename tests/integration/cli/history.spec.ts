import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";

describe("history CLI", () => {
  it("lists scoped chains with values and timestamps and makes history searchable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "history-cli-"));
    const dbPath = join(dir, "memories.db");
    const db = openDb({ dbPath });
    try {
      for (const [id, content] of [["old", "I use VS Code."], ["current", "I switched to Neovim."]]) {
        insertMemory(db, { id, project_id: "p", session_id: id, source_adapter: "test", kind: "fact",
          content, normalized_content: content, importance: 5 });
      }
      const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli/index.js"), ...args], {
        env: { ...process.env, SESSIONMEM_DB_PATH: dbPath, SESSIONMEM_PROJECT_ID: "p" },
      });
      const first = await run(["history", "--json"]);
      expect(first.stdout, first.stderr).not.toBe("");
      const json = JSON.parse(first.stdout);
      expect(json.projectId).toBe("p");
      expect(json.links).toMatchObject([{ supersedes: "old", supersededBy: "current", oldValue: "vs code", newValue: "neovim", fullySuperseded: true }]);
      expect(json.links[0].supersededAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect((await run(["history"])).stdout).toContain("old -> current");
      expect(JSON.parse((await run(["history", "--project", "other", "--json"])).stdout).links).toEqual([]);
      expect((await run(["search", "VS Code Neovim"])).stdout).not.toContain("I use VS Code.");
      expect((await run(["search", "VS Code Neovim", "--include-history"])).stdout).toContain("I use VS Code.");
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
