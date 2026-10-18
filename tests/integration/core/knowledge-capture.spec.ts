import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { listProjectKnowledge } from "../../../src/core/storage/knowledgeRepo.js";

describe("capture knowledge through the public service", () => {
  it("indexes direct and batch captures without adding public response fields", async () => {
    const db = openDb();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    try {
      const service = createMemoryCoreService({ db });
      const stored = await service.storeMemory({ memoryId: "a", projectId: "p", sessionId: "s", sourceAdapter: "test", kind: "fact", content: "Alice uses SQLite.", importance: 5 });
      expect(Object.keys(stored).sort()).toEqual(["memory", "ok", "warningCodes"]);
      const batch = await service.batchStoreMemory({ projectId: "p", memories: [{ memoryId: "b", sessionId: "s", sourceAdapter: "test", kind: "preference", content: "Bob prefers Python.", importance: 5 }] });
      expect(batch.ok).toBe(true);
      const graph = listProjectKnowledge(db, "p");
      expect(graph.relations.map(edge => edge.relation).sort()).toEqual(["prefers", "uses"]);
      const recalled = await service.retrieveMemories({ projectId: "p", query: "Alice SQLite", mode: "on-demand", limit: 5 });
      expect(Object.keys(recalled.memories[0].score.raw).sort()).toEqual(["importance", "recency", "semantic"]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); db.close(); }
  });

  it("extracts from full events before summary line/token caps and replaces on replay", async () => {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db, retentionDaysOverride: 0 });
      const events = Array.from({ length: 11 }, (_, index) => ({ id: `e${index}`, eventIndex: index, eventType: "message:user",
        payloadJson: JSON.stringify({ text: index === 5 ? "Alice works on project Atlas. Alice decided to use SQLite." : `Routine event ${index}` }),
      }));
      await service.ingestSessionEvents({ projectId: "p", sessionId: "s", events });
      const request = { projectId: "p", sessionId: "s", sourceAdapter: "test", config: { minimumEventThreshold: 1, summaryTokenCap: 12, factMode: "summary-only" as const, allowCloudSummarization: false } };
      const first = await service.handleSessionEnd(request);
      expect(first.status).toBe("stored");
      const summary = db.prepare("SELECT content FROM memories WHERE id = ?").get(first.memoryId) as { content: string };
      expect(summary.content).not.toContain("atlas");
      const graph = listProjectKnowledge(db, "p");
      expect(graph.entities).toContainEqual({ kind: "project", name: "atlas", memoryIds: [first.memoryId] });
      expect(graph.relations.some(edge => edge.relation === "decided")).toBe(true);
      await service.handleSessionEnd(request);
      expect(listProjectKnowledge(db, "p")).toEqual(graph);
    } finally { db.close(); }
  });
});
