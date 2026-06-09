import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { openDb } from "../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../src/core/api/memoryCoreService.js";
import type { CliContext } from "../../src/cli/context.js";

export interface TestCliContext extends CliContext {
  cleanup?: () => void;
}

/**
 * Builds a CliContext over a temp-file DB seeded with sample memories.
 * Returns the same { db, service, projectId, dbPath } shape.
 */
export async function createTestCliContext(): Promise<TestCliContext> {
  const dbPath = join(tmpdir(), `sessionmem-test-${randomUUID()}.db`);
  const projectId = "test-project";

  const db = openDb({ dbPath });
  const service = createMemoryCoreService({ db });

  // Seed a few sample memories
  await service.storeMemory({
    memoryId: "test-mem-001",
    projectId,
    sessionId: "session-1",
    sourceAdapter: "codex",
    kind: "fact",
    content: "User prefers TypeScript strict mode with NodeNext resolution.",
    importance: 7,
  });

  await service.storeMemory({
    memoryId: "test-mem-002",
    projectId,
    sessionId: "session-1",
    sourceAdapter: "codex",
    kind: "decision",
    content: "Use vitest for all unit and integration tests.",
    importance: 8,
  });

  await service.storeMemory({
    memoryId: "test-mem-003",
    projectId,
    sessionId: "session-2",
    sourceAdapter: "claude-code",
    kind: "warning",
    content: "Never commit secrets or API keys to source control.",
    importance: 9,
  });

  return { db, service, projectId, dbPath };
}
