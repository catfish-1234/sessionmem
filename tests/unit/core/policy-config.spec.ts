import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DEFAULT_POLICY_CONFIG,
  readPolicyConfig,
  writePolicyConfig,
  resolvePolicySettings,
  resolveTeamConfig,
  configFilePath,
} from "../../../src/core/config/policyConfig.js";

describe("policyConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sessionmem-policy-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("DEFAULT_POLICY_CONFIG", () => {
    it("has retentionDays 90, redactionEnabled true, and team disabled", () => {
      expect(DEFAULT_POLICY_CONFIG).toEqual({
        retentionDays: 90,
        redactionEnabled: true,
        team: { enabled: false },
      });
    });
  });

  describe("readPolicyConfig", () => {
    it("returns defaults when the file does not exist", () => {
      const path = join(dir, "missing.json");
      expect(readPolicyConfig(path)).toEqual(DEFAULT_POLICY_CONFIG);
    });

    it("returns defaults (no throw) when the file is malformed JSON", () => {
      const path = join(dir, "bad.json");
      writeFileSync(path, "{ not json", "utf8");
      expect(() => readPolicyConfig(path)).not.toThrow();
      expect(readPolicyConfig(path)).toEqual(DEFAULT_POLICY_CONFIG);
    });

    it("merges stored values over defaults", () => {
      const path = join(dir, "config.json");
      writeFileSync(path, JSON.stringify({ retentionDays: 30 }), "utf8");
      const cfg = readPolicyConfig(path);
      expect(cfg.retentionDays).toBe(30);
      expect(cfg.redactionEnabled).toBe(true);
    });

    it("falls back to defaults when stored values fail validation", () => {
      const path = join(dir, "config.json");
      writeFileSync(
        path,
        JSON.stringify({ retentionDays: "not-a-number" }),
        "utf8",
      );
      expect(readPolicyConfig(path)).toEqual(DEFAULT_POLICY_CONFIG);
    });

    it("ignores unknown keys and only honors known settings", () => {
      const path = join(dir, "config.json");
      writeFileSync(
        path,
        JSON.stringify({ retentionDays: 15, somethingElse: "x" }),
        "utf8",
      );
      const cfg = readPolicyConfig(path);
      expect(cfg).toEqual({
        retentionDays: 15,
        redactionEnabled: true,
        team: { enabled: false },
      });
      expect((cfg as Record<string, unknown>).somethingElse).toBeUndefined();
    });
  });

  describe("team config section", () => {
    it("writePolicyConfig persists a team section that readPolicyConfig returns", () => {
      const path = join(dir, "config.json");
      writePolicyConfig(path, {
        team: { enabled: true, sharedPath: "/x" },
      });
      const cfg = readPolicyConfig(path);
      expect(cfg.team.enabled).toBe(true);
      expect(cfg.team.sharedPath).toBe("/x");
    });

    it("defaults team to { enabled: false } when config.json lacks a team key", () => {
      const path = join(dir, "config.json");
      writeFileSync(path, JSON.stringify({ retentionDays: 30 }), "utf8");
      const cfg = readPolicyConfig(path);
      expect(cfg.team).toEqual({ enabled: false });
    });

    it("rejects an unknown key inside team on write (.strict())", () => {
      const path = join(dir, "config.json");
      expect(() =>
        writePolicyConfig(path, {
          team: { enabled: true, bogus: 1 },
        } as never),
      ).toThrow();
    });
  });

  describe("writePolicyConfig", () => {
    it("creates parent dirs and persists merged config", () => {
      const path = join(dir, "nested", "deep", "config.json");
      writePolicyConfig(path, { retentionDays: 30 });
      expect(existsSync(path)).toBe(true);
      const roundTrip = readPolicyConfig(path);
      expect(roundTrip.retentionDays).toBe(30);
      expect(roundTrip.redactionEnabled).toBe(true);
    });

    it("writes pretty JSON that round-trips to the written values", () => {
      const path = join(dir, "config.json");
      writePolicyConfig(path, { redactionEnabled: false });
      const raw = readFileSync(path, "utf8");
      expect(raw).toContain("\n"); // pretty-printed (indented)
      const parsed = JSON.parse(raw);
      expect(parsed.redactionEnabled).toBe(false);
      expect(parsed.retentionDays).toBe(90);
    });

    it("rejects unknown keys instead of silently writing them", () => {
      const path = join(dir, "config.json");
      expect(() =>
        writePolicyConfig(path, { bogusKey: 1 } as never),
      ).toThrow();
    });
  });

  describe("resolvePolicySettings", () => {
    it("uses the override when defined (override > config > default)", () => {
      const result = resolvePolicySettings({
        override: { retentionDays: 7 },
        config: { retentionDays: 30, redactionEnabled: true },
      });
      expect(result.retentionDays).toBe(7);
    });

    it("uses the config value when no override is present", () => {
      const result = resolvePolicySettings({
        config: { retentionDays: 30, redactionEnabled: true },
      });
      expect(result.retentionDays).toBe(30);
    });

    it("falls back to defaults when neither override nor config is present", () => {
      const result = resolvePolicySettings({});
      expect(result.retentionDays).toBe(90);
      expect(result.redactionEnabled).toBe(true);
    });

    it("resolves each setting independently", () => {
      const result = resolvePolicySettings({
        override: { redactionEnabled: false },
        config: { retentionDays: 45, redactionEnabled: true },
      });
      expect(result.redactionEnabled).toBe(false);
      expect(result.retentionDays).toBe(45);
    });
  });

  describe("resolveTeamConfig", () => {
    it("resolves team as a whole object: override > config > default", () => {
      const override = { enabled: true, sharedPath: "/o" };
      const config = { enabled: true, sharedPath: "/c" };
      expect(resolveTeamConfig({ override, config })).toEqual(override);
      expect(resolveTeamConfig({ config })).toEqual(config);
      expect(resolveTeamConfig({})).toEqual({ enabled: false });
    });
  });

  describe("configFilePath", () => {
    it("returns a path ending in .sessionmem/config.json", () => {
      const p = configFilePath();
      expect(p.replace(/\\/g, "/")).toContain(".sessionmem/config.json");
    });
  });
});
