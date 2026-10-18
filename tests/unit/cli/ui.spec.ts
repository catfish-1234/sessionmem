import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { openBrowser } from "../../../src/cli/commands/ui.js";
import { parseUiPort } from "../../../src/ui/server.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("viewer CLI options and browser launch", () => {
  it("uses a fixed default, accepts ephemeral ports, and rejects invalid ports", () => {
    expect(parseUiPort()).toBe(3777);
    expect(parseUiPort("0")).toBe(0);
    expect(parseUiPort("65535")).toBe(65535);
    for (const value of ["", " ", "abc", "1.5", "-1", "65536", "1e3", NaN]) {
      expect(() => parseUiPort(value)).toThrow(/--port/);
    }
  });

  it.each([
    ["linux", "xdg-open", ["http://127.0.0.1:1234/"]],
    ["darwin", "open", ["http://127.0.0.1:1234/"]],
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler", "http://127.0.0.1:1234/"]],
  ])("opens the browser on %s without a shell", (platform, command, args) => {
    vi.stubGlobal("process", { ...process, platform });
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    openBrowser("http://127.0.0.1:1234/");
    expect(spawn).toHaveBeenLastCalledWith(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    expect(child.unref).toHaveBeenCalled();
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    child.emit("error", new Error("unavailable"));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("printed URL manually"));
  });
});
