import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import type { Database } from "better-sqlite3";

/**
 * Security regression suite (ROADMAP success criterion 3 / D-05/D-06): proves
 * every common secret-pattern category is redacted across ALL write paths
 * (manual storeMemory, importMemories, auto-summarize via handleSessionEnd) and
 * by the one-time redactExisting scrub, and that the redactionEnabled flag truly
 * governs the behaviour (negative control).
 *
 * Test-only: if a category leaks, the fix belongs in Plan 01 (redaction.ts) or
 * Plan 03 (write-path wiring) — do NOT weaken these assertions.
 */

interface TestEnv {
  db: Database;
  service: ReturnType<typeof createMemoryCoreService>;
  projectId: string;
  cleanup: () => void;
}

function makeEnv(): TestEnv {
  const dbPath = join(tmpdir(), `sessionmem-secret-leak-${randomUUID()}.db`);
  const projectId = "test-project";
  const db = openDb({ dbPath });
  const service = createMemoryCoreService({ db });
  return {
    db,
    service,
    projectId,
    cleanup: () => {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(dbPath + suffix);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** The 8 D-05 categories: a raw sample secret + the placeholder it must collapse to. */
interface SecretCase {
  name: string;
  raw: string; // the raw secret substring that must NOT persist
  content: string; // a memory body embedding the raw secret
  placeholder: string;
}

const SECRET_CASES: SecretCase[] = [
  {
    name: "email",
    raw: "alice.dev@example.com",
    content: "Contact owner alice.dev@example.com about the migration.",
    placeholder: "[REDACTED_EMAIL]",
  },
  {
    name: "sk- API key",
    raw: "sk-abcdefghijklmnop",
    content: "OpenAI key is sk-abcdefghijklmnop for the agent.",
    placeholder: "[REDACTED_API_KEY]",
  },
  {
    name: "AWS access key",
    raw: "AKIAIOSFODNN7EXAMPLE",
    content: "AWS creds AKIAIOSFODNN7EXAMPLE were committed by mistake.",
    placeholder: "[REDACTED_AWS_KEY]",
  },
  {
    name: "GitHub token",
    raw: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    content: "CI token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked.",
    placeholder: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    name: "Bearer token",
    raw: "Bearer abcdefghijklmnop",
    content: "Authorization: Bearer abcdefghijklmnop sent in header.",
    placeholder: "[REDACTED_BEARER_TOKEN]",
  },
  {
    name: "private key block",
    raw: "MIIBVgIBADANBgkqhkiG",
    content:
      "key follows\n-----BEGIN RSA PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG\n-----END RSA PRIVATE KEY-----\nend",
    placeholder: "[REDACTED_PRIVATE_KEY]",
  },
  {
    name: "password assignment",
    raw: "hunter2secret",
    content: "DB connection uses password=hunter2secret in the string.",
    placeholder: "password=[REDACTED]",
  },
  {
    name: "JWT",
    raw: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    content:
      "session jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N stored.",
    placeholder: "[REDACTED_JWT]",
  },
];

describe("secret-pattern leakage across write paths", () => {
  let env: TestEnv | undefined;

  afterEach(() => {
    env?.cleanup();
    env = undefined;
  });

  describe("manual storeMemory path (redactionEnabled on)", () => {
    for (const c of SECRET_CASES) {
      it(`redacts ${c.name} and never persists the raw secret`, async () => {
        env = makeEnv();
        const id = `store-${randomUUID()}`;
        await env.service.storeMemory({
          memoryId: id,
          projectId: env.projectId,
          sessionId: "s-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: c.content,
          importance: 5,
          redactionEnabled: true,
        });

        const got = await env.service.getMemory({
          projectId: env.projectId,
          memoryId: id,
        });
        expect(got.ok).toBe(true);
        if (got.ok) {
          expect(got.memory.content).not.toContain(c.raw);
          expect(got.memory.content).toContain(c.placeholder);
        }
      });
    }
  });

  describe("importMemories path (redactionEnabled on)", () => {
    // Coverage for at least sk-/email/AWS per acceptance criteria.
    const importCases = SECRET_CASES.filter((c) =>
      ["email", "sk- API key", "AWS access key"].includes(c.name),
    );
    for (const c of importCases) {
      it(`redacts ${c.name} on import and never persists the raw secret`, async () => {
        env = makeEnv();
        const id = `import-${randomUUID()}`;
        const res = await env.service.importMemories({
          projectId: env.projectId,
          redactionEnabled: true,
          memories: [
            {
              id,
              projectId: env.projectId,
              sessionId: "s-1",
              sourceAdapter: "codex",
              kind: "fact",
              content: c.content,
              importance: 5,
            },
          ],
        });
        expect(res.ok).toBe(true);

        const list = await env.service.listMemories({
          projectId: env.projectId,
        });
        expect(list.ok).toBe(true);
        if (list.ok) {
          const row = list.memories.find((m) => m.id === id);
          expect(row).toBeDefined();
          expect(row!.content).not.toContain(c.raw);
          expect(row!.content).toContain(c.placeholder);
        }
      });
    }
  });

  describe("auto-summarize path (handleSessionEnd)", () => {
    it("does not leak a raw secret into the stored summary", async () => {
      env = makeEnv();
      const sessionId = "auto-sess-1";
      const raw = "sk-abcdefghijklmnop";

      // Seed enough events to clear the default minimumEventThreshold (3).
      const events = Array.from({ length: 4 }, (_, i) => ({
        id: `evt-${i}`,
        eventIndex: i,
        eventType: "message",
        payloadJson: JSON.stringify({
          role: "assistant",
          text:
            i === 0
              ? `Decision: rotate the key sk-abcdefghijklmnop immediately.`
              : `step ${i} completed normally`,
        }),
      }));

      const ingest = await env.service.ingestSessionEvents({
        projectId: env.projectId,
        sessionId,
        events,
      });
      expect(ingest.ok).toBe(true);

      const end = await env.service.handleSessionEnd({
        projectId: env.projectId,
        sessionId,
        sourceAdapter: "codex",
        config: {
          autoSummarize: true,
          minimumEventThreshold: 1,
          summaryTokenCap: 300,
          redactionEnabled: true,
          factMode: "summary+facts",
          allowCloudSummarization: false,
        },
      });
      expect(end.ok).toBe(true);

      const list = await env.service.listMemories({ projectId: env.projectId });
      expect(list.ok).toBe(true);
      if (list.ok) {
        for (const m of list.memories) {
          expect(m.content).not.toContain(raw);
        }
        // A summary memory was actually stored (the path ran, not skipped).
        expect(list.memories.some((m) => m.kind === "summary")).toBe(true);
      }
    });
  });

  describe("redactExisting one-time scrub", () => {
    it("removes a pre-seeded raw secret with apply:true", async () => {
      env = makeEnv();
      const raw = "sk-abcdefghijklmnop";
      const content = `legacy memory with key ${raw} stored raw`;
      // Insert directly so the raw secret bypasses storeMemory redaction.
      insertMemory(env.db, {
        id: "legacy-001",
        project_id: env.projectId,
        session_id: "s-1",
        source_adapter: "codex",
        kind: "fact",
        content,
        normalized_content: content.toLowerCase(),
        importance: 5,
      });

      const res = await env.service.redactExisting({
        projectId: env.projectId,
        apply: true,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.updated).toBeGreaterThanOrEqual(1);
      }

      const got = await env.service.getMemory({
        projectId: env.projectId,
        memoryId: "legacy-001",
      });
      expect(got.ok).toBe(true);
      if (got.ok) {
        expect(got.memory.content).not.toContain(raw);
        expect(got.memory.content).toContain("[REDACTED_API_KEY]");
      }
    });
  });

  describe("negative control (redactionEnabled off)", () => {
    it("preserves the raw secret on storeMemory when redaction disabled", async () => {
      env = makeEnv();
      const id = "no-redact-001";
      const raw = "sk-abcdefghijklmnop";
      await env.service.storeMemory({
        memoryId: id,
        projectId: env.projectId,
        sessionId: "s-1",
        sourceAdapter: "codex",
        kind: "fact",
        content: `unredacted key ${raw} here`,
        importance: 5,
        redactionEnabled: false,
      });

      const got = await env.service.getMemory({
        projectId: env.projectId,
        memoryId: id,
      });
      expect(got.ok).toBe(true);
      if (got.ok) {
        expect(got.memory.content).toContain(raw);
      }
    });
  });
});
