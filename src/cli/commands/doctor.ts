import { createAutostart, invalidLaunchPaths } from "../autostart/index.js";
import { inspectWatchCheckpoint } from "../watchCheckpoint.js";
import BetterSqlite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolveInstallAdapters } from "../../adapters/installedHosts.js";
import { checkHooks, checkAgentGuidance, readMcpLaunch, probeMcpWiring } from "../../adapters/diagnostics.js";
import { ADAPTER_NAMES, AdapterFactory } from "../../adapters/factory.js";
import { createMemoryCoreService } from "../../core/api/memoryCoreService.js";
import { inspectMigrations } from "../../core/schema/runMigrations.js";
import { resolveDbPath, type CliContextOverrides } from "../context.js";
import { inspectTranscriptDiscovery, TRANSCRIPT_HOSTS } from "../transcripts/index.js";

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
  let autostartHealthy = false;
  const captureFix = "Run sessionmem autostart enable; inspect logs/watch.log beside the database and OS service logs, then run sessionmem doctor";
  try {
    const registration = createAutostart({ dbPath }).status();
    report("Auto-start registration", registration.registered, registration.detail, registration.registered ? undefined : captureFix);
    const invalid = registration.launch ? invalidLaunchPaths(registration.launch) : ["No registered binary"];
    autostartHealthy = registration.registered && invalid.length === 0;
    report("Auto-start binary", invalid.length === 0, invalid.length ? invalid.join(", ") : "Registered Node binary and sessionmem entry point are readable", invalid.length ? "Reinstall sessionmem if needed, then run sessionmem autostart enable" : undefined);
  } catch (err) {
    report("Auto-start registration", false, message(err), captureFix);
    report("Auto-start binary", false, "Cannot inspect the registration", captureFix);
  }
  let watcherHealthy = false;
  try {
    report("Watcher capture", true, inspectWatchCheckpoint(dbPath));
    watcherHealthy = true;
  } catch (err) {
    report("Watcher capture", false, message(err), captureFix);
  }
  for (const host of TRANSCRIPT_HOSTS) {
    try {
      report(`${host} transcripts`, true, await inspectTranscriptDiscovery(host));
    } catch (err) {
      report(`${host} transcripts`, false, message(err), `Check transcript directory permissions and format; check the watcher logs; imports retry automatically`);
    }
  }
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
      let hooksHealthy = false, wiringHealthy = false, guidanceHealthy = false;
      try {
        report(`${adapter.name} hooks`, true, `${checkHooks(installation)}; sessionmem ${VERSION}`);
        hooksHealthy = Boolean(installation.hooks);
      } catch (err) {
        report(`${adapter.name} hooks`, false, message(err), `Enable hooks in the host settings if disabled, then run ${installFix}`);
      }
      try {
        const launch = readMcpLaunch(installation);
        if (!schemaOk) throw new Error("MCP launch probe blocked until the store and schema checks pass");
        await probeMcpWiring(launch, dbPath, VERSION);
        report(`${adapter.name} adapter wiring`, true, "Configured MCP command starts, matches this version, and answers stats");
        wiringHealthy = true;
      } catch (err) {
        report(`${adapter.name} adapter wiring`, false, message(err), `Ensure sessionmem is on PATH, then run ${installFix}`);
      }
      try {
        report(`${adapter.name} agent instructions`, true, checkAgentGuidance(adapter));
        guidanceHealthy = true;
      } catch (err) {
        report(`${adapter.name} agent instructions`, false, message(err), installFix);
      }
      const native = Boolean(installation.hooks);
      const transcript = ["Claude Code", "Codex", "Cursor"].includes(adapter.name);
      const unverifiedHost = ["Antigravity", "QCoder"].includes(adapter.name);
      const capture = !unverifiedHost && schemaOk && (native ? hooksHealthy || (autostartHealthy && watcherHealthy) : transcript ? autostartHealthy && watcherHealthy : guidanceHealthy && wiringHealthy);
      report(`${adapter.name} automatic capture`, capture,
        unverifiedHost ? "Native adapter paths are unverified; automatic capture is not established" : native ? "Hook capture and transcript watcher configured; see hook and watcher checks"
          : transcript ? "Login watcher imports supported transcripts; a healthy sweep is required"
          : "Agent-driven saves only; no background transcript importer for this host",
        capture ? undefined : unverifiedHost ? "Verify the native host MCP and guidance paths in its current settings, or select a verified host adapter" : transcript ? captureFix : `Enable memory tool calls and load the instructions from ${adapter.guidanceTargets?.().join(", ")}; ${installFix}`);
      const recall = !unverifiedHost && schemaOk && wiringHealthy && (native ? hooksHealthy : guidanceHealthy);
      report(`${adapter.name} automatic recall`, recall,
        unverifiedHost ? "Native host loading is unverified; automatic recall is not established" : native ? "SessionStart and UserPromptSubmit hooks inject context"
          : "Instruction-driven startup and prompt recall configured; agent execution is not verified by doctor",
        recall ? undefined : unverifiedHost ? "Configure the MCP server and startup instructions in the native host settings; these adapter paths are unverified" : `Enable memory tools, load the installed instructions and run ${installFix}`);
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
