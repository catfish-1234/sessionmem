import { createCliContext, type CliContext } from "../context.js";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";

const SIMILARITY_THRESHOLD = 0.85;
const MAX_TAG_LEN = 200;

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

interface DedupePair {
  idA: string;
  idB: string;
  similarity: number;
  contentA: string;
  contentB: string;
}

export async function dedupeCommand(
  options: { dry?: boolean; threshold?: string } = {},
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();
  const threshold = options.threshold ? parseFloat(options.threshold) : SIMILARITY_THRESHOLD;
  const dryRun = options.dry !== false;

  const memories = listMemoriesByProject(context.db, context.projectId);
  const withEmbeddings = memories.filter((m) => m.embedding && m.embedding_dim);

  if (withEmbeddings.length < 2) {
    process.stdout.write("Not enough memories with embeddings to compare.\n");
    return;
  }

  const pairs: DedupePair[] = [];
  for (let i = 0; i < withEmbeddings.length; i++) {
    const a = withEmbeddings[i];
    const vecA: number[] = JSON.parse(a.embedding!);
    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const b = withEmbeddings[j];
      const vecB: number[] = JSON.parse(b.embedding!);
      const sim = cosineSimilarity(vecA, vecB);
      if (sim >= threshold) {
        pairs.push({
          idA: a.id,
          idB: b.id,
          similarity: sim,
          contentA: a.content.slice(0, MAX_TAG_LEN),
          contentB: b.content.slice(0, MAX_TAG_LEN),
        });
      }
    }
  }

  if (pairs.length === 0) {
    process.stdout.write(`No near-duplicate memories found (threshold: ${threshold}).\n`);
    return;
  }

  process.stdout.write(`Found ${pairs.length} near-duplicate pair(s) (threshold: ${threshold}):\n\n`);
  for (const pair of pairs) {
    process.stdout.write(`Similarity: ${(pair.similarity * 100).toFixed(1)}%\n`);
    process.stdout.write(`  A [${pair.idA}]: ${pair.contentA}${pair.contentA.length >= MAX_TAG_LEN ? "…" : ""}\n`);
    process.stdout.write(`  B [${pair.idB}]: ${pair.contentB}${pair.contentB.length >= MAX_TAG_LEN ? "…" : ""}\n`);
    if (!dryRun) {
      // Keep A (higher importance or first by date), delete B.
      const memA = withEmbeddings.find((m) => m.id === pair.idA)!;
      const memB = withEmbeddings.find((m) => m.id === pair.idB)!;
      const keepId = memA.importance >= memB.importance ? pair.idA : pair.idB;
      const dropId = keepId === pair.idA ? pair.idB : pair.idA;
      await context.service.call("forgetMemory", {
        projectId: context.projectId,
        memoryId: dropId,
      });
      process.stdout.write(`  → Deleted ${dropId} (kept ${keepId})\n`);
    }
    process.stdout.write("\n");
  }

  if (dryRun && pairs.length > 0) {
    process.stdout.write(`Run with --apply to delete the lower-importance duplicate in each pair.\n`);
  }
}
