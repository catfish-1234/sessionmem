// Directly exercise the pinned upstream observation store and SQLite search.
// No observation generation, Chroma, or worker orchestration is measured.
import { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { blockNetwork } from "../lib/offline.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { values } = parseArgs({ options: {
  input: { type: "string" }, output: { type: "string" }, source: { type: "string" },
  "chroma-python": { type: "string" }, "model-dir": { type: "string" },
} });
const offline = blockNetwork();
const { SessionStore } = await import(pathToFileURL(`${values.source}/src/services/sqlite/SessionStore.ts`).href);
const { SessionSearch } = await import(pathToFileURL(`${values.source}/src/services/sqlite/SessionSearch.ts`).href);
const corpus = JSON.parse(readFileSync(values.input!, "utf8"));
const rows = [], captures = [];
const strategies: Record<string, number> = {};
let client: Client | undefined, ChromaSync, SearchOrchestrator;
const cache = join(process.env.CLAUDE_MEM_DATA_DIR!, "model-cache");
if (values["chroma-python"]) {
  client = new Client({ name: "locomo-local-eval", version: "1" });
  await client.connect(new StdioClientTransport({ command: values["chroma-python"], args: [
    new URL("./chroma-local.py", import.meta.url).pathname, "--model-dir", values["model-dir"]!,
    "--cache-dir", cache, "--client-type", "persistent", "--data-dir", join(cache, "database"),
  ] }));
  ({ ChromaSync } = await import(pathToFileURL(`${values.source}/src/services/sync/ChromaSync.ts`).href));
  ({ SearchOrchestrator } = await import(pathToFileURL(`${values.source}/src/services/worker/search/SearchOrchestrator.ts`).href));
  const { ChromaMcpManager } = await import(pathToFileURL(`${values.source}/src/services/sync/ChromaMcpManager.ts`).href);
  // Supply the already-installed MCP transport. Upstream synchronization,
  // filtering, hydration, ranking and fallback code run unchanged. This avoids
  // invoking uvx/package resolution inside a timed query.
  ChromaMcpManager.getInstance().callTool = async (name: string, args: Record<string, unknown>) => {
    const response = await client!.callTool({ name, arguments: args });
    if (response.isError) throw new Error(JSON.stringify(response.content));
    const content = response.content as Array<{ type: string; text?: string }>;
    const text = content.find(c => c.type === "text")?.text;
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  };
}
try {
for (const conversation of corpus) {
  const db = new Database(":memory:");
  try {
    const store = new SessionStore(db);
    const search = new SessionSearch(db);
    const chroma = ChromaSync ? new ChromaSync(conversation.id) : null;
    const orchestrator = SearchOrchestrator ? new SearchOrchestrator(search, store, chroma, 0) : null;
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
    if (chroma) {
      // Batch the same upstream document formatter used by sync/backfill.
      // Live capture's row-at-a-time IPC is outside this retrieval evaluation.
      const stored = db.prepare("SELECT * FROM observations ORDER BY id").all();
      const documents = stored.flatMap(row => chroma.formatObservationDocs(row));
      if (await chroma.addDocuments(documents) !== documents.length) throw new Error("Incomplete Chroma capture");
    }
    captures.push({ id: conversation.id, memories: turnIds.size, capture_ms: performance.now() - start });
    for (const question of conversation.questions) {
      const start = performance.now();
      let result;
      if (orchestrator) {
        const response = await orchestrator.search({ query: question.question, project: conversation.id, limit: 5,
          orderBy: "relevance", searchType: "observations", ignoreDefaultRecencyWindow: true });
        strategies[response.strategy] = (strategies[response.strategy] ?? 0) + 1;
        if (!response.usedChroma) throw new Error("Configured Chroma evaluation silently fell back to SQLite");
        result = response.results.observations;
      } else {
        result = search.searchObservations(question.question, { project: conversation.id, limit: 5, orderBy: "relevance" });
        strategies.sqlite = (strategies.sqlite ?? 0) + 1;
      }
      rows.push({ id: question.id, retrieved: result.map((r: { id: number }) => turnIds.get(r.id)), latency_ms: performance.now() - start });
    }
    console.error(`Finished ${conversation.id}`);
  } finally { db.close(); }
}
offline.assertOffline();
if (existsSync(join(cache, "external-network-attempts.txt"))) throw new Error("Chroma attempted external network access");
writeFileSync(values.output!, JSON.stringify({ questions: rows, conversations: captures, query_strategies: strategies, runtime: { bun: Bun.version }, external_network_attempts: 0 }));
} finally { await client?.close(); }
