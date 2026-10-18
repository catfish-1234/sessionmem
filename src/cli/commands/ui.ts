import BetterSqlite3 from "better-sqlite3";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createMemoryCoreService } from "../../core/api/memoryCoreService.js";
import { deriveProjectId } from "../projectId.js";
import { resolveDbPath } from "../context.js";
import { inspectMigrations } from "../../core/schema/runMigrations.js";
import { parseUiPort, startUiServer } from "../../ui/server.js";

/** Open the OS browser without a shell or an additional runtime dependency. */
export function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  const failed = () => console.error("Could not open a browser. Open the printed URL manually.");
  child.once("error", failed);
  child.once("exit", code => { if (code) failed(); });
  child.unref();
}

export async function uiCommand(options: { port?: string | number } = {}): Promise<void> {
  const port = parseUiPort(options.port);
  // Unlike the normal CLI context, a viewer must not create, migrate or write the store.
  let db: BetterSqlite3.Database;
  try {
    db = new BetterSqlite3(resolveDbPath(), { readonly: true, fileMustExist: true });
  } catch {
    throw new Error("Cannot open the memory store. Run sessionmem ping first, or check SESSIONMEM_DB_PATH.");
  }
  try {
    db.pragma("query_only = ON");
    db.pragma("busy_timeout = 5000");
    const migrations = inspectMigrations(db);
    if (migrations.unknown.length) {
      throw new Error("The memory store uses an unrecognized schema. Use the sessionmem version that created it.");
    }
    if (migrations.pending.length) {
      throw new Error("The memory store needs an upgrade. Run sessionmem ping first to apply pending migrations.");
    }
    const viewer = await startUiServer({ db, service: createMemoryCoreService({ db }), projectId: deriveProjectId() }, port);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void viewer.close().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const closed = once(viewer.server, "close");
      console.log(`sessionmem viewer: ${viewer.url}\nRead-only. Press Ctrl-C to stop.`);
      openBrowser(viewer.url);
      await closed;
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    db.close();
  }
}
