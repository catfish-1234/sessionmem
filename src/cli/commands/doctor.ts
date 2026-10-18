import BetterSqlite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolveInstallAdapters } from "../../adapters/installedHosts.js";
import { checkHooks, readMcpLaunch, probeMcpWiring } from "../../adapters/diagnostics.js";
import { ADAPTER_NAMES, AdapterFactory } from "../../adapters/factory.js";
import { createMemoryCoreService } from "../../core/api/memoryCoreService.js";
import { inspectMigrations } from "../../core/schema/runMigrations.js";
import { resolveDbPath, type CliContextOverrides } from "../context.js";

const VERSION = (createRequire(import.meta.url)("../../../package.json") as { version: string }).version;

export interface DiagnosticResult {
  check: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/** Exercise real storage, embedding, ranking and injection without retaining data. */
export async function probeRecall(db: Database): Promise<void> {
  const id = `sessionmem-doctor-${randomUUID()}`;
  const content = "Sessionmem doctor canary checks local memory recall.";
  const service = createMemoryCoreService({ db });
  // A separate project prevents both ranking collisions and access-count changes
  // to user memories. Rollback also removes FTS entries and feedback on failure.
  db.exec("BEGIN IMMEDIATE");
  try {
    const stored = await service.call("storeMemory", {
      projectId: id, sessionId: id, memoryId: id, sourceAdapter: "doctor",
      kind: "fact", content, importance: 5,
    });
    if (!stored.ok) throw new Error(`Canary write failed: ${stored.error.message}`);
    const recalled = await service.call("retrieveMemories", {
      projectId: id, query: content, limit: 5, mode: "auto", depth: "default",
    });
    if (!recalled.ok) throw new Error(`Canary recall failed: ${recalled.error.message}`);
    if (!recalled.memories.some((memory) => memory.id === id && memory.content === content)) {
      throw new Error("Recall did not return the canary memory");
    }
  } finally {
    db.exec("ROLLBACK");
  }
}

export async function doctorCommand(
  options?: { adapter?: string },
  overrides: Pick<CliContextOverrides, "dbPath" | "migrationsDir"> = {},
): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  const report = (check: string, ok: boolean, detail: string, fix?: string) => {
    results.push({ check, ok, detail, ...(fix ? { fix } : {}) });
    console.log(`${ok ? "PASS" : "FAIL"} ${check}: ${detail}`);
    if (fix) console.log(`  Fix: ${fix}`);
  };
  const message = (err: unknown) => err instanceof Error ? err.message : String(err);
  let adapters: ReturnType<typeof resolveInstallAdapters>["adapters"] = [];
  try {
    adapters = resolveInstallAdapters(options).adapters;
  } catch (err) {
    report("Agent hosts", false, message(err), "Install a supported host or select one with sessionmem doctor --adapter <name>");
  }

  const dbPath = resolveDbPath(overrides.dbPath);
  let db: Database | undefined;
  let schemaOk = false;
  try {
    try {
      if (dbPath === ":memory:") throw new Error("No persistent memory store selected (:memory:)");
      // fileMustExist prevents doctor from hiding a missing store; migrations
      // are inspected separately and are never applied during diagnosis.
      db = new BetterSqlite3(dbPath, { fileMustExist: true, timeout: 5000 });
      const status = db.pragma("quick_check", { simple: true });
      if (status !== "ok") throw new Error(`SQLite quick_check: ${String(status)}`);
      db.pragma("foreign_keys = ON");
      report("Memory store", true, `Exists and opens (${dbPath})`);
    } catch (err) {
      db?.close();
      db = undefined;
      report("Memory store", false, message(err), "Check the selected database path and directory permissions; initialize a missing store with sessionmem ping");
    }
    if (db) {
      try {
        const schema = inspectMigrations(db, overrides.migrationsDir);
        if (schema.unknown.length) {
          report("Schema", false, `Unrecognized migrations: ${schema.unknown.join(", ")}`, "Use the sessionmem version that created this database; do not downgrade its schema");
        } else if (schema.pending.length) {
          report("Schema", false, `Pending migrations: ${schema.pending.join(", ")}`, "sessionmem ping");
        } else {
          schemaOk = true;
          report("Schema", true, "All bundled migrations are applied");
        }
      } catch (err) {
        report("Schema", false, message(err), "Check the database and bundled schema migrations; sessionmem ping applies pending migrations");
      }
    } else {
      report("Schema", false, "Cannot inspect an unavailable store", "sessionmem ping");
    }

    for (const adapter of adapters) {
      const name = ADAPTER_NAMES.find((name) => AdapterFactory.forName(name).name === adapter.name);
      const installFix = name ? `sessionmem install --adapter ${name}` : "sessionmem install";
      const installation = adapter.installation?.();
      if (!installation) {
        report(`${adapter.name} hooks`, false, "Adapter has no installation diagnostics", installFix);
        report(`${adapter.name} adapter wiring`, false, "Adapter has no installation diagnostics", installFix);
        continue;
      }
      try {
        report(`${adapter.name} hooks`, true, `${checkHooks(installation)}; sessionmem ${VERSION}`);
      } catch (err) {
        report(`${adapter.name} hooks`, false, message(err), `Enable hooks in the host settings if disabled, then run ${installFix}`);
      }
      try {
        const launch = readMcpLaunch(installation);
        if (!schemaOk) throw new Error("MCP launch probe blocked until the store and schema checks pass");
        await probeMcpWiring(launch, dbPath, VERSION);
        report(`${adapter.name} adapter wiring`, true, "Configured MCP command starts, matches this version, and answers stats");
      } catch (err) {
        report(`${adapter.name} adapter wiring`, false, message(err), `Ensure sessionmem is on PATH, then run ${installFix}`);
      }
    }
    if (!adapters.length) {
      report("Hook configuration", false, "No host selected", "sessionmem doctor --adapter <name>");
      report("Adapter wiring", false, "No host selected", "sessionmem doctor --adapter <name>");
    }

    if (db && schemaOk) {
      try {
        await probeRecall(db);
        report("Recall canary", true, "Write and recall succeeded; canary rolled back");
      } catch (err) {
        report("Recall canary", false, message(err), "Check database write permissions and errors; run sessionmem doctor again after repair");
      }
    } else {
      report("Recall canary", false, "Blocked until the store and schema checks pass", "sessionmem ping");
    }
  } finally {
    db?.close();
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  return results;
}
