import { describe, it, expect, afterEach } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

const projectId = "proj-update";
let db: Database | undefined;

afterEach(() => { db?.close(); db = undefined; });

async function setup(content = "The API listens on port 8080", extra: Record<string, unknown> = {}) {
  db = openDb();
  const service = createMemoryCoreService({ db });
  const stored = await service.storeMemory({
    memoryId: "mem-1", projectId, sessionId: "sess-1", sourceAdapter: "codex",
    kind: "fact", content, importance: 5, ...extra,
  });
  return { service, db, stored: stored.memory };
}

describe("updateMemory", () => {
  it("changes only the content and keeps the memory's identity", async () => {
    const { service, stored } = await setup();
    const vector = () => (db!.prepare("SELECT embedding FROM memories WHERE id = ?").get("mem-1") as { embedding: string }).embedding;
    const oldVector = vector();
    const result = await service.updateMemory({ projectId, memoryId: "mem-1", content: "The API listens on port 9090" });

    expect(result.memory.id).toBe("mem-1");
    expect(result.memory.content).toBe("The API listens on port 9090");
    expect(result.memory.sessionId).toBe(stored.sessionId);
    expect(result.memory.kind).toBe("fact");
    expect(result.memory.importance).toBe(5);
    expect(result.memory.createdAt).toBe(stored.createdAt);
    expect(result.memory.normalizedContent).toContain("9090");
    expect(result.memory.normalizedContent).not.toContain("8080");
    expect(vector()).not.toBe(oldVector);
  });

  it("finds the memory by its new wording, not its old one", async () => {
    const { service } = await setup("Deploys go through the blue pipeline");
    await service.updateMemory({ projectId, memoryId: "mem-1", content: "Deploys go through the orange pipeline" });

    const found = await service.retrieveMemories({ projectId, query: "orange pipeline", mode: "on-demand" });
    expect(found.memories.map(m => m.id)).toContain("mem-1");
    const fts = db!.prepare("SELECT content FROM memories WHERE id = ?").get("mem-1") as { content: string };
    expect(fts.content).not.toContain("blue");
  });

  it("redacts new content exactly as a stored memory is redacted", async () => {
    const { service } = await setup();
    const key = `sk-ant-api03-${"B".repeat(90)}`;
    const result = await service.updateMemory({ projectId, memoryId: "mem-1", content: `staging key is ${key}` });
    expect(result.memory.content).toBe("staging key is [REDACTED_ANTHROPIC_KEY]");
  });

  it("records a re-rating as manual feedback", async () => {
    const { service, db } = await setup();
    await service.updateMemory({ projectId, memoryId: "mem-1", importance: 9 });
    const rows = db.prepare("SELECT feedback_type, previous_importance, new_importance FROM memory_feedback WHERE memory_id = ?")
      .all("mem-1");
    expect(rows).toEqual([{ feedback_type: "manual", previous_importance: 5, new_importance: 9 }]);
  });

  it("replaces tags, and null clears tags and expiry", async () => {
    const { service } = await setup("Use the temporary proxy", { tags: ["net"], expiresAt: "2099-01-01T00:00:00Z" });
    const retagged = await service.updateMemory({ projectId, memoryId: "mem-1", tags: ["proxy", "infra"], kind: "warning" });
    expect(retagged.memory.tags).toEqual(["proxy", "infra"]);
    expect(retagged.memory.kind).toBe("warning");
    expect(retagged.memory.expiresAt).toBe("2099-01-01T00:00:00Z");

    const cleared = await service.updateMemory({ projectId, memoryId: "mem-1", tags: null, expiresAt: null });
    expect(cleared.memory.tags ?? null).toBeNull();
    expect(cleared.memory.expiresAt ?? null).toBeNull();
    expect(cleared.memory.content).toBe("Use the temporary proxy");
  });

  it("refuses an update that changes nothing, and an unknown or out-of-scope memory", async () => {
    const { service } = await setup("Scoped fact", { scope: "api" });
    const empty = await service.call("updateMemory", { projectId, memoryId: "mem-1" });
    expect(empty.ok === false && empty.error.code).toBe("VALIDATION");
    await expect(service.updateMemory({ projectId, memoryId: "missing", importance: 3 })).rejects.toThrow(/not found/i);
    await expect(service.updateMemory({ projectId, memoryId: "mem-1", scope: "web", importance: 3 }))
      .rejects.toThrow(/not found/i);
    const viaCall = await service.call("updateMemory", { projectId: "other-project", memoryId: "mem-1", importance: 3 });
    expect(viaCall.ok).toBe(false);
  });
});
