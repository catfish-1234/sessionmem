import { createCliContext, type CliContext } from "../context.js";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";

const SIMILARITY_THRESHOLD = 0.85;
const MAX_PREVIEW_LEN = 200;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface DedupeCandidate {
  id: string;
  content: string;
  importance: number;
  vector: number[];
}

interface DedupePair {
  idA: string;
  idB: string;
  similarity: number;
  contentA: string;
  contentB: string;
}

/**
 * Parse and validate the `--threshold` flag. An unparseable or out-of-range
 * value used to flow through as NaN, and every `sim >= NaN` comparison is
 * false — so `--threshold banana` reported "no duplicates found" rather than
 * telling the user their input was rejected.
 */
function resolveThreshold(raw: string | undefined): number {
  if (raw === undefined) return SIMILARITY_THRESHOLD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    console.error(
      `Invalid --threshold "${raw}": expected a number greater than 0 and at most 1.`,
    );
    process.exit(1);
  }
  return parsed;
}

/** Parse a stored embedding, returning null when it is absent or malformed. */
function parseVector(embedding: string | null): number[] | null {
  if (!embedding) return null;
  try {
    const parsed: unknown = JSON.parse(embedding);
    if (!Array.isArray(parsed) || !parsed.every((n) => Number.isFinite(n))) {
      return null;
    }
    return parsed as number[];
  } catch {
    return null;
  }
}

export async function dedupeCommand(
  options: { dry?: boolean; threshold?: string } = {},
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();
  const threshold = resolveThreshold(options.threshold);
  const dryRun = options.dry !== false;

  // Parse each embedding ONCE. The inner loop used to re-parse the same
  // candidate's JSON for every outer element — O(n²) JSON.parse calls over a
  // list that only has n distinct vectors.
  const candidates: DedupeCandidate[] = [];
  for (const memory of listMemoriesByProject(context.db, context.projectId)) {
    const vector = parseVector(memory.embedding);
    if (!vector || !memory.embedding_dim) continue;
    candidates.push({
      id: memory.id,
      content: memory.content,
      importance: memory.importance,
      vector,
    });
  }

  if (candidates.length < 2) {
    process.stdout.write("Not enough memories with embeddings to compare.\n");
    return;
  }

  // Highest importance first, id as the tie-break. Pairs are emitted in this
  // order and the first element of a pair is the one kept, so the survivor of
  // any duplicate cluster is deterministic.
  //
  // Without this the order came from `ORDER BY updated_at DESC`, which is not a
  // total order — memories written in the same clock tick tie, and the winner
  // varied by platform. The same three memories could collapse to a different
  // survivor on Windows than on Linux, and `--apply` is a hard delete.
  candidates.sort(
    (left, right) =>
      right.importance - left.importance || left.id.localeCompare(right.id),
  );

  const pairs: DedupePair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      const sim = cosineSimilarity(a.vector, b.vector);
      if (sim >= threshold) {
        pairs.push({
          idA: a.id,
          idB: b.id,
          similarity: sim,
          contentA: a.content.slice(0, MAX_PREVIEW_LEN),
          contentB: b.content.slice(0, MAX_PREVIEW_LEN),
        });
      }
    }
  }

  if (pairs.length === 0) {
    process.stdout.write(`No near-duplicate memories found (threshold: ${threshold}).\n`);
    return;
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const deleted = new Set<string>();

  process.stdout.write(`Found ${pairs.length} near-duplicate pair(s) (threshold: ${threshold}):\n\n`);
  for (const pair of pairs) {
    // Skip a pair whose partner is already gone. Similarity is not transitive:
    // in a chain A~B, B~C with A≁C, deleting B for the (A,B) pair left the
    // (B,C) pair still to process, and that pass could delete C — a memory
    // whose only duplicate no longer existed. Nothing kept C from being
    // dropped on the strength of an already-deleted row.
    if (deleted.has(pair.idA) || deleted.has(pair.idB)) continue;

    process.stdout.write(`Similarity: ${(pair.similarity * 100).toFixed(1)}%\n`);
    process.stdout.write(`  A [${pair.idA}]: ${pair.contentA}${pair.contentA.length >= MAX_PREVIEW_LEN ? "…" : ""}\n`);
    process.stdout.write(`  B [${pair.idB}]: ${pair.contentB}${pair.contentB.length >= MAX_PREVIEW_LEN ? "…" : ""}\n`);

    if (!dryRun) {
      const memA = byId.get(pair.idA);
      const memB = byId.get(pair.idB);
      if (!memA || !memB) continue;
      const keepId = memA.importance >= memB.importance ? pair.idA : pair.idB;
      const dropId = keepId === pair.idA ? pair.idB : pair.idA;
      const result = await context.service.call("forgetMemory", {
        projectId: context.projectId,
        memoryId: dropId,
      });
      if (result.ok) {
        deleted.add(dropId);
        process.stdout.write(`  → Deleted ${dropId} (kept ${keepId})\n`);
      } else {
        process.stdout.write(`  → Failed to delete ${dropId}: ${result.error.message}\n`);
      }
    }
    process.stdout.write("\n");
  }

  if (dryRun) {
    process.stdout.write(`Run with --apply to delete the lower-importance duplicate in each pair.\n`);
  }
}
