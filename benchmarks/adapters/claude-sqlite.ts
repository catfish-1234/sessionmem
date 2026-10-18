// Directly exercise the pinned upstream observation store and SQLite search.
// No observation generation, Chroma, or worker orchestration is measured.
import { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { blockNetwork } from "../lib/offline.mjs";

const { values } = parseArgs({ options: {
  input: { type: "string" }, output: { type: "string" }, source: { type: "string" },
} });
const offline = blockNetwork();
const { SessionStore } = await import(pathToFileURL(`${values.source}/src/services/sqlite/SessionStore.ts`).href);
const { SessionSearch } = await import(pathToFileURL(`${values.source}/src/services/sqlite/SessionSearch.ts`).href);
const corpus = JSON.parse(readFileSync(values.input!, "utf8"));
const rows = [], captures = [];
for (const conversation of corpus) {
  const db = new Database(":memory:");
  try {
    const store = new SessionStore(db);
    const search = new SessionSearch(db);
    const turnIds = new Map<number, string>();
    const start = performance.now();
    for (const session of conversation.sessions) {
      const sessionId = store.createSDKSession(session.id, conversation.id, "");
      store.ensureMemorySessionIdRegistered(sessionId, session.id);
      for (const turn of session.turns) {
        // Upstream requires a title. Put the complete raw turn in that single
        // searchable field; no generated titles or extra searchable metadata.
        const observation = store.storeObservation(session.id, conversation.id, {
          type: "discovery", title: turn.content, subtitle: null, narrative: null,
          facts: [], concepts: [], files_read: [], files_modified: [],
        }, undefined, 0, Date.parse("2026-01-01T00:00:00.000Z"), undefined, { skipTitleDedup: true });
        if (observation.mergedIntoExisting) throw new Error("Unexpected upstream deduplication");
        turnIds.set(observation.id, turn.id);
      }
    }
    captures.push({ id: conversation.id, memories: turnIds.size, capture_ms: performance.now() - start });
    for (const question of conversation.questions) {
      const start = performance.now();
      const result = search.searchObservations(question.question, { project: conversation.id, limit: 5, orderBy: "relevance" });
      rows.push({ id: question.id, retrieved: result.map((r: { id: number }) => turnIds.get(r.id)), latency_ms: performance.now() - start });
    }
  } finally { db.close(); }
}
offline.assertOffline();
writeFileSync(values.output!, JSON.stringify({ questions: rows, conversations: captures, runtime: { bun: Bun.version }, external_network_attempts: 0 }));
