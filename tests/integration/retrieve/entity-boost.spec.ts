import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

const now = new Date("2026-01-01T00:00:00.000Z");
let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(); });
afterEach(() => { db.close(); });

function add(id: string, content: string, date = now.toISOString(), project = "p", expires?: string) {
  insertMemory(db, { id, content, normalized_content: content.toLowerCase(), project_id: project,
    session_id: id, source_adapter: "test", kind: "fact", importance: 5,
    created_at: date, updated_at: date, expires_at: expires });
}

function retrieve(query: string, entityBoost: boolean, temporalRetrieval = false) {
  return retrieveMemories({ db, projectId: "p", query, now, entityBoost, temporalRetrieval });
}

describe("bounded entity boost", () => {
  it.each([
    ["person", "Alice: The deployment succeeded.", "ALICE"],
    ["project", "I work on project atlas.", "ATLAS"],
    ["file", "Read src/config.ts before deployment.", "SRC/CONFIG.TS"],
    ["tool", "SQLite stores deployment records.", "SQLITE"],
    ["decision", "I decided to ship weekly.", "SHIP WEEKLY"],
  ])("boosts a captured %s through a case-insensitive exact name", (_kind, content, name) => {
    // Extra prose makes this candidate less lexically dominant than the control.
    add("matched", content + " Additional background context.".repeat(20));
    add("control", `${name} deployment deployment deployment.`);
    const before = retrieve(`${name} deployment`, false);
    const after = retrieve(`${name} deployment`, true);
    const original = before.find(row => row.id === "matched")!;
    const boosted = after.find(row => row.id === "matched")!;
    expect(boosted.score.total).toBeGreaterThan(original.score.total);
    expect(boosted.score.total - original.score.total).toBeLessThanOrEqual(0.06 + 1e-12);
    expect(boosted.score.raw.recency).toBe(original.score.raw.recency);
    expect(boosted.score.raw.importance).toBe(original.score.raw.importance);
  });

  it.each([
    ["PostgreSQL stores records.", "PoStGrEs"],
    ["Kubernetes runs workloads.", "K8S"],
    ["Node.js runs scripts.", "NODE deployment"],
    ["Postgres stores records.", "POSTGRESQL"],
    ["Tool k8s runs workloads.", "KUBERNETES"],
    ["Tool node runs scripts.", "NODE.JS deployment"],
  ])("boosts explicit aliases for %s", (content, query) => {
    add("matched", content + " Background context.".repeat(20));
    add("unmatched", "Deployment status remains stable.");
    const before = retrieve(query, false);
    const after = retrieve(query, true);
    expect(after.find(row => row.id === "matched")!.score.total)
      .toBeGreaterThan(before.find(row => row.id === "matched")!.score.total);
    expect(after.find(row => row.id === "unmatched")!.score)
      .toEqual(before.find(row => row.id === "unmatched")!.score);
  });

  it("leaves queries without a known entity and partial names unchanged", () => {
    add("matched", "Alice works on project atlas using SQLite.");
    add("other", "Deployment status remains stable.");
    for (const query of ["deployment status", "unrecognized zebra", "Alicia atlasian SQLiteClient"]) {
      expect(retrieve(query, true)).toEqual(retrieve(query, false));
    }
  });

  it("caps repeated names and aliases so a recent unmatched chunk still wins", () => {
    add("old", "PostgreSQL stores records. Kubernetes runs workloads.", "2025-11-01T00:00:00.000Z");
    add("recent", "The deployment status remains stable.");
    for (const query of ["postgres", "postgres POSTGRES k8s K8S postgres"]) {
      const before = retrieve(query, false);
      const after = retrieve(query, true);
      const original = before.find(row => row.id === "old")!;
      const boosted = after.find(row => row.id === "old")!;
      expect(boosted.score.total).toBeCloseTo(original.score.total + 0.06);
      expect(after.find(row => row.id === "recent")!.score)
        .toEqual(before.find(row => row.id === "recent")!.score);
      expect(after[0].id).toBe("recent");
    }
  });

  it("preserves temporal signals when boosting entity matches", () => {
    add("old", "PostgreSQL stores records.", "2025-11-01T00:00:00.000Z");
    add("recent", "The deployment status remains stable.");
    const before = retrieve("current postgres", false, true);
    const after = retrieve("current postgres", true, true);
    const original = before.find(row => row.id === "old")!;
    const boosted = after.find(row => row.id === "old")!;
    expect(boosted.score.total).toBeCloseTo(original.score.total + 0.054);
    expect(boosted.score.raw.recency).toBe(original.score.raw.recency);
    expect(boosted.score.raw.importance).toBe(original.score.raw.importance);
    expect(after[0].id).toBe("recent");
  });

  it("excludes expired, foreign and superseded entity matches", () => {
    add("foreign", "PostgreSQL stores records.", now.toISOString(), "other");
    add("expired", "PostgreSQL stores records.", now.toISOString(), "p", "2025-01-01T00:00:00.000Z");
    add("old", "I use VS Code.", "2025-11-01T00:00:00.000Z");
    add("new", "I switched to Neovim.", "2025-12-01T00:00:00.000Z");
    expect(retrieve("postgres VS Code", true).map(row => row.id)).toEqual(["new"]);
    const history = retrieveMemories({ db, projectId: "p", query: "VS Code", now,
      entityBoost: true, includeHistory: true });
    expect(history.map(row => row.id)).toContain("old");
  });

  it("uses boosted ordering in the compact index and keeps timeline and detail reads intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sessionmem-entity-boost-"));
    const path = join(dir, "config.json");
    try {
      // Exercise capture rather than seeding derived tables for the service flow.
      const service = createMemoryCoreService({ db, policyConfigPath: path, now: () => now });
      const saved = await service.storeMemory({ memoryId: "matched", projectId: "p", sessionId: "s", sourceAdapter: "test",
        kind: "fact", importance: 5, content: "PostgreSQL stores deployment records. " + "Full deployment details. ".repeat(40) });
      await service.storeMemory({ memoryId: "other", projectId: "p", sessionId: "s", sourceAdapter: "test",
        kind: "fact", importance: 5, content: "The deployment status remains stable." });
      writeFileSync(path, JSON.stringify({ entityBoost: false, entityLinkBoost: false }));
      const before = await service.searchMemoryIndex({ projectId: "p", query: "postgres" });
      writeFileSync(path, JSON.stringify({ entityLinkBoost: false }));
      expect(await service.searchMemoryIndex({ projectId: "p", query: "postgres" })).toEqual(before);
      writeFileSync(path, JSON.stringify({ entityBoost: true, entityLinkBoost: false }));
      const index = await service.searchMemoryIndex({ projectId: "p", query: "POSTGRES" });
      const full = await service.retrieveMemories({ projectId: "p", query: "POSTGRES", mode: "on-demand", limit: 10 });
      expect(index.memories.map(row => row.id)).toEqual(full.memories.map(row => row.id));
      expect(index.memories[0].id).toBe(saved.memory.id);
      expect(index.memories[0].score!).toBeGreaterThan(before.memories.find(row => row.id === saved.memory.id)!.score!);
      expect(index.memories[0].summary.length).toBeLessThanOrEqual(160);
      expect(index.memories[0]).not.toHaveProperty("content");
      const timeline = await service.memoryTimeline({ projectId: "p", memoryId: index.memories[0].id });
      expect(timeline.memories.map(row => row.id)).toContain(saved.memory.id);
      expect(timeline.memories.every(row => row.score === null)).toBe(true);
      const details = await service.getMemory({ projectId: "p", memoryId: index.memories[0].id });
      expect(details.memory.content).toContain("Full deployment details.");
      expect(details.memory.content.length).toBeGreaterThan(160);
      expect(db.prepare("SELECT SUM(access_count) AS count FROM memories").get()).toEqual({ count: 0 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
