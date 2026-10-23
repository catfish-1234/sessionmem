import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { detectScope, scopeLabelSchema } from "../../../src/core/scopes.js";
import { readPolicyConfig, writePolicyConfig } from "../../../src/core/config/policyConfig.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function temporary() { const dir = mkdtempSync(join(tmpdir(), "sessionmem-scope-detection-")); dirs.push(dir); return dir; }

describe("automatic local scope detection", () => {
  it("uses the real working directory name, including through a directory alias", () => {
    const dir = temporary(), target = join(dir, "atlas"), alias = join(dir, "alias");
    mkdirSync(target); symlinkSync(target, alias, "junction");
    expect(detectScope(target, "other")).toBe("atlas");
    expect(detectScope(alias, "other")).toBe("atlas");
  });
  it("handles missing directories and falls back to the project or no label", () => {
    expect(detectScope(join(temporary(), "offline-context"), "project")).toBe("offline-context");
    expect(detectScope(undefined, "project")).toBe("project");
    expect(detectScope(parse(process.cwd()).root, "project")).toBe("project");
    expect(detectScope()).toBeNull();
  });
  it("validates single-line labels while preserving case and context names", () => {
    expect(scopeLabelSchema.parse("  Release Planning  ")).toBe("Release Planning");
    for (const input of ["", " ", "x".repeat(161), "a\nb", "a\u0000b"]) expect(scopeLabelSchema.safeParse(input).success).toBe(false);
  });
  it("round-trips capture defaults and salvages independent policy settings", () => {
    const path = join(temporary(), "config.json");
    expect(readPolicyConfig(path).scope).toBeUndefined();
    expect(writePolicyConfig(path, { scope: "custom" }).scope).toBe("custom");
    expect(writePolicyConfig(path, { scope: null }).scope).toBeNull();
    expect(() => writePolicyConfig(path, { scope: "bad\nlabel" })).toThrow();
  });
});
