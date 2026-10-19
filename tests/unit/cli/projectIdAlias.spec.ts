import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveProjectId } from "../../../src/cli/projectId.js";

describe("deriveProjectId with symlinked directories", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.SESSIONMEM_PROJECT_ID;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("gives the same id for a directory and a symlink alias to it", () => {
    const base = mkdtempSync(join(tmpdir(), "sm-alias-"));
    dirs.push(base);
    const real = join(base, "proj");
    mkdirSync(join(real, ".git"), { recursive: true });
    const alias = join(base, "alias");
    symlinkSync(real, alias, "dir");
    expect(deriveProjectId(alias)).toBe(deriveProjectId(realpathSync(real)));
  });
});
