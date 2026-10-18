import { describe, expect, it } from "vitest";

import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("offline lexical ranking", () => {
  it("finds conversational evidence despite extra question words and inflections", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db, now: () => now, policyConfigPath: "/nonexistent/lexical-test.json" });
    try {
      for (let i = 0; i < 60; i++) {
        await service.storeMemory({
          memoryId: `filler-${i}`, projectId: "hiking", sessionId: "earlier",
          sourceAdapter: "test", kind: "fact", importance: 5,
          content: `Mira: Coffee with friends was nice. Note ${i}.`,
        });
      }
      await service.storeMemory({
        memoryId: "evidence", projectId: "hiking", sessionId: "later",
        sourceAdapter: "test", kind: "fact", importance: 5,
        content: "Mira: I hiked along Cedar Ridge yesterday.",
      });
      const request = { projectId: "hiking", query: "Where did Mira hike?", limit: 5, mode: "on-demand" as const };
      const first = await service.retrieveMemories(request);
      const second = await service.retrieveMemories(request);
      expect(first.ok).toBe(true);
      expect(first.memories[0]?.id).toBe("evidence");
      expect(first.memories.map((m) => m.id)).toEqual(second.memories.map((m) => m.id));
      expect(first.memories[0]?.sessionId).toBe("later");
    } finally { db.close(); }
  });

  it("ranks matching summaries above a hash collision without lexical evidence", () => {
    const db = openDb();
    const queryText = "How much did bicycle repair cost?";
    const vector = deterministicEmbed(queryText, 32);
    try {
      for (const [id, kind, content] of [
        ["summary", "summary", "Bicycle repairs cost forty dollars."],
        ["collision", "fact", "Lunch with colleagues was pleasant."],
      ]) {
        insertMemory(db, {
          id, project_id: "repair", session_id: "s", source_adapter: "test", kind,
          content, normalized_content: content.toLowerCase(), importance: 5,
          embedding: JSON.stringify(id === "collision" ? vector.vector : vector.vector.map((v) => -v)),
          embedding_dim: vector.dimension, embedding_version: vector.embeddingVersion,
          updated_at: now.toISOString(),
        });
      }
      const results = retrieveMemories({ db, projectId: "repair", queryText, topK: 2, now });
      expect(results.map((m) => m.id)).toEqual(["summary", "collision"]);
      expect(results[0].semantic).toBeLessThan(results[1].semantic);
      expect(results[0].score.total).toBeGreaterThan(results[1].score.total);
      expect(results[0].score.total).toBeCloseTo(
        results[0].score.weighted.semantic + results[0].score.weighted.recency + results[0].score.weighted.importance,
      );
    } finally { db.close(); }
  });

  it("keeps project and expiry boundaries for partial lexical matches", () => {
    const db = openDb();
    try {
      for (const [id, project, expires] of [
        ["active", "scope", null],
        ["expired", "scope", "2025-12-31T00:00:00.000Z"],
        ["foreign", "other", null],
      ] as const) {
        insertMemory(db, {
          id, project_id: project, session_id: "s", source_adapter: "test", kind: "fact",
          content: "A bicycle repair", normalized_content: "a bicycle repair", importance: 5,
          updated_at: "2020-01-01T00:00:00.000Z", expires_at: expires,
        });
      }
      const results = retrieveMemories({ db, projectId: "scope", queryText: "What did the bicycle repair cost?", now });
      expect(results.map((m) => m.id)).toEqual(["active"]);
    } finally { db.close(); }
  });

  it.each(["AND OR NOT NEAR () : * \"", "!!!", "the and", "café 東京"])(
    "handles literal query text %s without FTS syntax errors",
    (queryText) => {
      const db = openDb();
      try {
        insertMemory(db, {
          id: "literal", project_id: "literal", session_id: "s", source_adapter: "test", kind: "fact",
          content: "AND OR NOT NEAR café 東京", normalized_content: "and or not near café 東京", importance: 5,
          updated_at: now.toISOString(),
        });
        const result = retrieveMemories({ db, projectId: "literal", queryText, now });
        expect(result.map((m) => m.id)).toEqual(["literal"]);
        expect(Number.isFinite(result[0].score.total)).toBe(true);
      } finally { db.close(); }
    },
  );
});
