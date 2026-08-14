import { describe, expect, it, vi, afterEach } from "vitest";
import { dedupeCommand } from "../../../src/cli/commands/dedupe.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";
import { insertMemory, listMemoriesByProject } from "../../../src/core/storage/memoryRepo.js";
import { EMBEDDING_VERSION } from "../../../src/core/embed/embeddingVersion.js";

function captureStdout(): { getText: () => string; restore: () => void } {
  let buffer = "";
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      buffer += String(chunk);
      return true;
    });
  return { getText: () => buffer, restore: () => spy.mockRestore() };
}

const RADIANS = Math.PI / 180;
const unitVector = (degrees: number): number[] => [
  Math.cos(degrees * RADIANS),
  Math.sin(degrees * RADIANS),
];

/**
 * Seed a similarity CHAIN, not a cluster: A–B and B–C sit 25° apart
 * (cos 25° ≈ 0.906, above the 0.85 threshold) while A–C sit 50° apart
 * (cos 50° ≈ 0.643, below it). So the pair list is [(A,B), (B,C)] and A and C
 * are NOT duplicates of each other.
 *
 * Importance descends A > B > C, so (A,B) drops B. The (B,C) pair is then left
 * holding a deleted row — and without the guard it dropped C too, destroying a
 * memory whose only near-duplicate was already gone.
 */
async function seedChain(ctx: Awaited<ReturnType<typeof createTestCliContext>>) {
  const seeds: Array<{ id: string; degrees: number; importance: number }> = [
    { id: "chain-a", degrees: 0, importance: 9 },
    { id: "chain-b", degrees: 25, importance: 8 },
    { id: "chain-c", degrees: 50, importance: 7 },
  ];

  for (const { id, degrees, importance } of seeds) {
    const vector = unitVector(degrees);
    insertMemory(ctx.db, {
      id,
      project_id: ctx.projectId,
      session_id: "s",
      source_adapter: "cli",
      kind: "fact",
      content: `chain memory ${id}`,
      normalized_content: `chain memory ${id}`,
      importance,
      embedding: JSON.stringify(vector),
      embedding_dim: vector.length,
      embedding_version: EMBEDDING_VERSION,
    });
  }
}

describe("dedupeCommand", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an unparseable --threshold instead of silently finding nothing", async () => {
    const ctx = await createTestCliContext();
    // parseFloat("banana") is NaN and every `sim >= NaN` is false, so the old
    // behavior was an unqualified "No near-duplicate memories found".
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("exit");
      }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        dedupeCommand({ dry: true, threshold: "banana" }, ctx),
      ).rejects.toThrow("exit");
      expect(err.mock.calls.flat().join(" ")).toContain("Invalid --threshold");
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      ctx.cleanup?.();
    }
  });

  it("rejects an out-of-range --threshold", async () => {
    const ctx = await createTestCliContext();
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(dedupeCommand({ dry: true, threshold: "5" }, ctx)).rejects.toThrow(
        "exit",
      );
    } finally {
      ctx.cleanup?.();
    }
  });

  it("never deletes a memory whose duplicate was already removed", async () => {
    const ctx = await createTestCliContext();
    await seedChain(ctx);
    const out = captureStdout();
    try {
      await dedupeCommand({ dry: false }, ctx);
    } finally {
      out.restore();
    }

    const remaining = listMemoriesByProject(ctx.db, ctx.projectId)
      .map((m) => m.id)
      .filter((id) => id.startsWith("chain-"));
    ctx.cleanup?.();

    // Only B is a duplicate of a surviving row, so only B goes. C's sole
    // near-duplicate was B; once B is deleted, C has nothing to collapse into.
    // The old code processed the stale (B,C) pair anyway and deleted C.
    expect(remaining.sort()).toEqual(["chain-a", "chain-c"]);
  });

  it("does not delete anything on a dry run", async () => {
    const ctx = await createTestCliContext();
    await seedChain(ctx);
    const out = captureStdout();
    try {
      await dedupeCommand({ dry: true }, ctx);
    } finally {
      out.restore();
    }

    const remaining = listMemoriesByProject(ctx.db, ctx.projectId)
      .map((m) => m.id)
      .filter((id) => id.startsWith("chain-"));
    ctx.cleanup?.();
    expect(remaining.sort()).toEqual(["chain-a", "chain-b", "chain-c"]);
    expect(out.getText()).toContain("--apply");
  });

  it("skips memories with malformed embeddings rather than throwing", async () => {
    const ctx = await createTestCliContext();
    insertMemory(ctx.db, {
      id: "broken-embedding",
      project_id: ctx.projectId,
      session_id: "s",
      source_adapter: "cli",
      kind: "fact",
      content: "malformed",
      normalized_content: "malformed",
      importance: 5,
      embedding: "{not json",
      embedding_dim: 4,
      embedding_version: EMBEDDING_VERSION,
    });

    const out = captureStdout();
    try {
      await expect(dedupeCommand({ dry: true }, ctx)).resolves.not.toThrow();
    } finally {
      out.restore();
      ctx.cleanup?.();
    }
  });
});
