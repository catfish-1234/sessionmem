import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";
import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed.js";

const PROJECT_ID = "project-redact-existing";

function seedRaw(
  db: ReturnType<typeof openDb>,
  id: string,
  content: string,
): void {
  insertMemory(db, {
    id,
    project_id: PROJECT_ID,
    session_id: "session-1",
    source_adapter: "codex",
    kind: "fact",
    content,
    normalized_content: content.toLowerCase(),
    importance: 5,
  });
}

describe("redactExisting core operation", () => {
  it("dry-run reports matches without modifying rows", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "secret-1", "key sk-abcdefghijkl");

    const result = await service.call("redactExisting", {
      projectId: PROJECT_ID,
      apply: false,
    });

    expect(result).toMatchObject({
      ok: true,
      scanned: 1,
      matched: 1,
      updated: 0,
    });

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "secret-1",
    });
    expect(fetched.memory.content).toContain("sk-abcdefghijkl");

    db.close();
  });

  it("apply redacts matching rows in place", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "secret-1", "key sk-abcdefghijkl");

    const result = await service.call("redactExisting", {
      projectId: PROJECT_ID,
      apply: true,
    });

    expect(result).toMatchObject({ ok: true, matched: 1, updated: 1 });

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "secret-1",
    });
    expect(fetched.memory.content).toContain("[REDACTED_API_KEY]");
    expect(fetched.memory.content).not.toContain("sk-abcdefghijkl");

    db.close();
  });

  it("apply re-embeds: the stored vector tracks the redacted text, not the secret", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "secret-1", "key sk-abcdefghijkl");

    const before = db
      .prepare("SELECT embedding FROM memories WHERE id = ?")
      .get("secret-1") as { embedding: string | null };

    await service.call("redactExisting", { projectId: PROJECT_ID, apply: true });

    const after = db
      .prepare("SELECT embedding, content FROM memories WHERE id = ?")
      .get("secret-1") as { embedding: string | null; content: string };

    // The embedding must change (it was a hash of the pre-redaction body) and
    // must now equal a fresh embedding of the redacted content — i.e. it tracks
    // the scrubbed text rather than the original secret.
    expect(after.content).not.toContain("sk-abcdefghijkl");
    expect(after.embedding).not.toBe(before.embedding);
    const expected = deterministicEmbed(after.content, 32);
    expect(after.embedding).toBe(JSON.stringify(expected.vector));

    db.close();
  });

  it("is idempotent: a second apply matches nothing", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "secret-1", "key sk-abcdefghijkl");

    await service.call("redactExisting", { projectId: PROJECT_ID, apply: true });
    const second = await service.call("redactExisting", {
      projectId: PROJECT_ID,
      apply: true,
    });

    expect(second).toMatchObject({ ok: true, matched: 0, updated: 0 });

    db.close();
  });

  it("returns non-empty length-bounded previews when matched > 0", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "secret-1", "key sk-abcdefghijkl");

    const result = await service.call("redactExisting", {
      projectId: PROJECT_ID,
      apply: false,
    });

    if (!result.ok) throw new Error("expected ok");
    expect(result.previews.length).toBeGreaterThan(0);
    for (const preview of result.previews) {
      // Previews are length-bounded and must not echo the full raw secret.
      expect(preview.length).toBeLessThanOrEqual(120);
      expect(preview).not.toContain("sk-abcdefghijkl");
    }

    db.close();
  });

  it("returns matched:0 for a project with no secret-bearing memories", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "plain-1", "just some plain notes");

    const result = await service.call("redactExisting", {
      projectId: PROJECT_ID,
      apply: true,
    });

    expect(result).toMatchObject({
      ok: true,
      scanned: 1,
      matched: 0,
      updated: 0,
    });

    db.close();
  });

  it("apply defaults to false (dry-run) when omitted", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedRaw(db, "secret-1", "key sk-abcdefghijkl");

    const result = await service.call("redactExisting", {
      projectId: PROJECT_ID,
    });

    expect(result).toMatchObject({ ok: true, matched: 1, updated: 0 });

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "secret-1",
    });
    expect(fetched.memory.content).toContain("sk-abcdefghijkl");

    db.close();
  });
});
