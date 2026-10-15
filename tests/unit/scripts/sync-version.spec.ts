import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/sync-version.mjs");

describe("release manifest synchronization", () => {
  it("updates versions, dependency metadata and the Docker pin together", () => {
    const dir = mkdtempSync(join(tmpdir(), "sessionmem-version-"));
    const root = {
      version: "2.3.4",
      dependencies: { example: "^2.0.0" },
      devDependencies: { compiler: "^6.0.3" },
      engines: { node: ">=20.19.0" },
      bugs: { url: "https://example.com/issues" },
      homepage: "https://example.com",
    };
    const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));
    try {
      mkdirSync(join(dir, "package"));
      mkdirSync(join(dir, ".claude-plugin"));
      writeFileSync(join(dir, "package.json"), JSON.stringify(root));
      writeFileSync(join(dir, "package/package.json"), JSON.stringify({
        version: "1.0.0", dependencies: { obsolete: "^1.0.0" }, bin: "./dist/cli/index.js",
      }));
      writeFileSync(join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ version: "1.0.0", name: "sessionmem" }));
      writeFileSync(join(dir, "server.json"), JSON.stringify({ version: "1.0.0", packages: [{ version: "1.0.0" }] }));
      writeFileSync(join(dir, "Dockerfile"), "FROM node:20-slim\nRUN npm install -g sessionmem@1.0.6\n");
      execFileSync(process.execPath, [script], { cwd: dir });
      expect(read("package/package.json")).toEqual({ ...root, bin: "./dist/cli/index.js" });
      expect(read(".claude-plugin/plugin.json")).toEqual({ name: "sessionmem", version: root.version });
      expect(read("server.json")).toEqual({ version: root.version, packages: [{ version: root.version }] });
      expect(readFileSync(join(dir, "Dockerfile"), "utf8")).toBe("FROM node:20-slim\nRUN npm install -g sessionmem@2.3.4\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
