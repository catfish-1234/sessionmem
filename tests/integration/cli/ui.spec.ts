import BetterSqlite3 from "better-sqlite3";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";

const cli = resolve("dist/cli/index.js");
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "sessionmem-ui-cli-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const env = () => ({ ...process.env, SESSIONMEM_DB_PATH: join(directory, "store.db"), SESSIONMEM_PROJECT_ID: "ui-test" });

describe("ui entrypoint", () => {
  it("validates the port before creating a store", async () => {
    await expect(promisify(execFile)(process.execPath, [cli, "ui", "--port", "65536"], { env: env() }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("--port must be an integer") });
    expect(existsSync(join(directory, "store.db"))).toBe(false);
  });

  it("reports a missing store without creating one", async () => {
    await expect(promisify(execFile)(process.execPath, [cli, "ui", "--port", "0"], { env: env() }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("Run sessionmem ping first") });
    expect(existsSync(join(directory, "store.db"))).toBe(false);
  });

  it("reports pending migrations without modifying an existing database", async () => {
    const dbPath = join(directory, "store.db");
    const db = new BetterSqlite3(dbPath);
    db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY)");
    db.close();
    const before = readFileSync(dbPath);
    await expect(promisify(execFile)(process.execPath, [cli, "ui", "--port", "0"], { env: env() }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("Run sessionmem ping first") });
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });

  // Windows does not deliver POSIX SIGINT/SIGTERM to child processes. Browser
  // selection on Windows is covered by the unit spec without launching a browser.
  it.skipIf(process.platform === "win32")("prints its ephemeral URL, launches the browser, and shuts down cleanly on Ctrl-C", async () => {
    const dbPath = join(directory, "store.db");
    const db = openDb({ dbPath });
    insertMemory(db, { id: "visible", project_id: "ui-test", session_id: "s", source_adapter: "test", kind: "fact",
      content: "Alice uses TypeScript.", normalized_content: "alice uses typescript", importance: 5 });
    db.close();
    const before = readFileSync(dbPath);
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const launched = join(directory, "browser-url");
    // Fake the OS browser launcher so the CLI can be tested without opening UI.
    writeFileSync(join(bin, process.platform === "darwin" ? "open" : "xdg-open"), '#!/bin/sh\nprintf "%s" "$1" > "$SESSIONMEM_TEST_BROWSER_URL"\n', { mode: 0o755 });
    const child = spawn(process.execPath, [cli, "ui", "--port", "0"], {
      env: { ...env(), PATH: bin, SESSIONMEM_TEST_BROWSER_URL: launched }, stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = once(child, "close");
    let output = "";
    let errors = "";
    child.stderr.on("data", chunk => { errors += chunk; });
    const started = new Promise<string>((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error("Viewer startup timed out: " + errors)), 10000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error("Viewer exited early: " + code + " " + errors)); });
      child.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) { clearTimeout(timer); resolveUrl(match[0]); }
      });
    });
    try {
      const url = await started;
      const response = await fetch(new URL("api/memories", url));
      expect((await response.json()).memories).toMatchObject([{ id: "visible" }]);
      // Also exercise real recall against the command's read-only connection.
      expect((await fetch(new URL("api/memories?q=TypeScript", url))).status).toBe(200);
      await expect.poll(() => existsSync(launched) && readFileSync(launched, "utf8")).toBe(url);
      expect(output).toContain("Ctrl-C");
      child.kill("SIGINT");
      const [code, signal] = await closed;
      expect({ code, signal, errors }).toEqual({ code: 0, signal: null, errors: "" });
      await expect(fetch(url)).rejects.toThrow();
      expect(readFileSync(dbPath).equals(before)).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
  }, 20000);
});
