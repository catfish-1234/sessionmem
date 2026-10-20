import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionmemClient } from "sessionmem/client";
import { projectIdFromCwd } from "../../../src/cli/projectId.js";

const cli = resolve("dist/cli/index.js");
let directory: string;
beforeEach(() => { directory = realpathSync(mkdtempSync(join(tmpdir(), "sessionmem-api-cli-"))); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const env = () => ({ ...process.env, SESSIONMEM_DB_PATH: join(directory, "store.db"), SESSIONMEM_PROJECT_ID: "", SESSIONMEM_API_TOKEN: "" });

describe("serve --api CLI", () => {
  it("validates opt-in, bind address, port and token before creating a database", async () => {
    for (const [args, message] of [
      [["serve"], "Use sessionmem serve --api"],
      [["serve", "--api", "--host", "0.0.0.0"], "Non-loopback bind refused"],
      [["serve", "--api", "--port", "65536"], "--port must be an integer"],
      [["serve", "--api", "--token", ""], "API token must contain"],
    ] as const) {
      await expect(promisify(execFile)(process.execPath, [cli, ...args], { env: env() }))
        .rejects.toMatchObject({ stderr: expect.stringContaining(message) });
      expect(existsSync(join(directory, "store.db"))).toBe(false);
    }
  });

  for (const tokenFlag of [false, true]) {
    it(`starts on the repository project, honors ${tokenFlag ? "flag over env" : "env token"}, and closes`, async () => {
      const project = join(directory, "project with spaces");
      const cwd = join(project, "nested");
      mkdirSync(cwd, { recursive: true });
      mkdirSync(join(project, ".git"));
      const token = tokenFlag ? "flag-secret" : "env-secret";
      const child = spawn(process.execPath, [cli, "serve", "--api", "--port", "0", ...(tokenFlag ? ["--token", token] : [])], {
        cwd, env: { ...env(), SESSIONMEM_API_TOKEN: "env-secret" }, stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = once(child, "close");
      let output = "";
      let errors = "";
      child.stderr.on("data", chunk => { errors += chunk; });
      const started = new Promise<string>((resolveUrl, reject) => {
        const timer = setTimeout(() => reject(new Error("API startup timed out: " + errors)), 10000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`API exited early: ${code} ${errors}`)); });
        child.stdout.on("data", chunk => {
          output += chunk;
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
          if (match) { clearTimeout(timer); resolveUrl(match[0]); }
        });
      });
      try {
        const url = await started;
        expect(output).toContain(`Project: ${projectIdFromCwd(realpathSync(project))}`);
        expect(output).toContain("Bearer auth enabled");
        expect(output).not.toContain(token);
        expect(output).not.toContain("env-secret");
        await expect(new SessionmemClient(url).searchMemoryIndex({ query: "test" })).rejects.toMatchObject({ status: 401 });
        expect((await new SessionmemClient(url, { token }).searchMemoryIndex({ query: "test" })).memories).toEqual([]);
        child.kill("SIGTERM");
        const [code, signal] = await closed;
        // Windows terminates children directly rather than delivering POSIX signals.
        if (process.platform !== "win32") expect({ code, signal, errors }).toEqual({ code: 0, signal: null, errors: "" });
        await expect(fetch(url)).rejects.toThrow();
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await closed;
      }
    });
  }
});
