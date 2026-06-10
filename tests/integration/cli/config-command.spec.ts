import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, rmSync } from "fs";
import {
  configGetCommand,
  configSetCommand,
} from "../../../src/cli/commands/config.js";

describe("config get/set commands", () => {
  let configPath: string;

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(configPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  function freshPath(): string {
    configPath = join(tmpdir(), `sessionmem-config-${randomUUID()}.json`);
    return configPath;
  }

  it("get of retention.days with no prior set prints the default 90", () => {
    const path = freshPath();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    configGetCommand("retention.days", { configPath: path });

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logs.some((m) => m.trim() === "90")).toBe(true);
  });

  it("set retention.days then get prints the new value", () => {
    const path = freshPath();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    configSetCommand("retention.days", "30", { configPath: path });
    configGetCommand("retention.days", { configPath: path });

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logs.some((m) => m.trim() === "30")).toBe(true);
  });

  it("set redactionEnabled false persists a boolean", () => {
    const path = freshPath();
    vi.spyOn(console, "log").mockImplementation(() => {});

    configSetCommand("redactionEnabled", "false", { configPath: path });

    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.redactionEnabled).toBe(false);
  });

  it("written config.json round-trips set values via JSON.parse", () => {
    const path = freshPath();
    vi.spyOn(console, "log").mockImplementation(() => {});

    configSetCommand("retention.days", "45", { configPath: path });

    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.retentionDays).toBe(45);
  });

  it("get of an unknown key errors and exits 1", () => {
    const path = freshPath();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit called");
      });

    expect(() => configGetCommand("bogus.key", { configPath: path })).toThrow(
      "process.exit called",
    );
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("set of an unknown key does NOT write the file and exits 1", () => {
    const path = freshPath();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit called");
      });

    expect(() =>
      configSetCommand("bogus.key", "x", { configPath: path }),
    ).toThrow("process.exit called");

    expect(existsSync(path)).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("set with an invalid value type errors and exits 1 without writing", () => {
    const path = freshPath();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit called");
      });

    expect(() =>
      configSetCommand("retention.days", "not-a-number", { configPath: path }),
    ).toThrow("process.exit called");

    expect(existsSync(path)).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
