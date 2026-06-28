import { createCliContext, type CliContext } from "../context.js";
import { deterministicEmbed } from "../../core/embed/deterministicEmbed.js";
import { EMBEDDING_VERSION } from "../../core/embed/embeddingVersion.js";

interface StaleMemoryRow {
  id: string;
  content: string;
  embedding_dim: number | null;
}

const DEFAULT_EMBEDDING_DIMENSION = 32;

/**
 * `sessionmem re-embed`
 *
 * Bulk-update embeddings for all memories whose embedding_version does not
 * match the current EMBEDDING_VERSION. Recomputes each embedding with
 * deterministicEmbed and writes the new vector + version back to the row.
 */
export async function reEmbedCommand(ctx?: CliContext): Promise<void> {
  const context = ctx ?? createCliContext();
  const { db, projectId } = context;

  const stale = db
    .prepare(
      `
      SELECT id, content, embedding_dim
      FROM memories
      WHERE project_id = ?
        AND (embedding_version IS NULL OR embedding_version != ?)
    `,
    )
    .all(projectId, EMBEDDING_VERSION) as StaleMemoryRow[];

  const total = stale.length;

  if (total === 0) {
    console.log("All embeddings are up to date.");
    return;
  }

  console.log(`Found ${total} memories with stale embeddings. Re-embedding...`);

  const updateStmt = db.prepare(`
    UPDATE memories
    SET embedding = ?, embedding_dim = ?, embedding_version = ?
    WHERE id = ?
  `);

  let count = 0;

  const runAll = db.transaction(() => {
    for (const row of stale) {
      const dim = row.embedding_dim ?? DEFAULT_EMBEDDING_DIMENSION;
      const result = deterministicEmbed(row.content, dim);

      updateStmt.run(
        JSON.stringify(result.vector),
        result.dimension,
        EMBEDDING_VERSION,
        row.id,
      );

      count += 1;
      if (count % 100 === 0 || count === total) {
        console.log(`  ${count}/${total}`);
      }
    }
  });

  runAll();

  console.log(`Re-embedded ${count} memories to version ${EMBEDDING_VERSION}.`);
}
