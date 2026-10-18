import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { createAutostart, decodeCommandOutput, invalidLaunchPaths, LABEL, renderPlist, renderSystemd, renderTask, UNIT, windowsQuote, type CommandResult, type Runner } from "../../../../src/cli/autostart/index.js";

vi.mock("node:fs", async original => ({
  ...await original<typeof import("node:fs")>(),
  accessSync: vi.fn(), statSync: vi.fn(), existsSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), rmSync: vi.fn(),
}));

const launch = { command: '/opt/node & co/node', args: ['/opt/session & co/index.js', 'watch', '--db-path', '/data/a%b$db.db', '--log-file', '/data/logs/watch.log'] };
const ok = (stdout = ""): CommandResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr: string, stdout = ""): CommandResult => ({ status: 1, stdout, stderr });
let files: Map<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  files = new Map();
  vi.mocked(fs.existsSync).mockImplementation(p => files.has(String(p)));
  vi.mocked(fs.readFileSync).mockImplementation(p => files.get(String(p)) as never);
  vi.mocked(fs.writeFileSync).mockImplementation((p, content) => { files.set(String(p), String(content)); });
  vi.mocked(fs.rmSync).mockImplementation(p => { files.delete(String(p)); });
  vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as never);
});

function fixture(platform: NodeJS.Platform = "linux") {
  let active = false;
  let enabled = false;
  let taskXml = "";
  const home = platform === "win32" ? "C:\\Users\\A & B" : "/users/A & B";
  const nodePath = platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : launch.command;
  const cliPath = platform === "win32" ? "C:\\Users\\A & B\\npm\\sessionmem\\index.js" : launch.args[0];
  const dbPath = platform === "win32" ? "C:\\Users\\A & B\\.sessionmem\\memories.db" : "/data/memories.db";
  const taskName = `sessionmem-watch-${createHash("sha256").update(home.toLowerCase()).digest("hex").slice(0, 12)}`;
  const run = vi.fn<Runner>((cmd, args) => {
    if (cmd === "whoami.exe") return ok('"DOMAIN\\A & B","S-1-5-21-1000"\r\n');
    if (cmd === "launchctl") {
      if (args[0] === "print") return active ? ok("running") : fail("Could not find service");
      if (args[0] === "bootstrap") active = true;
      if (args[0] === "bootout") active = false;
    }
    if (cmd === "systemctl") {
      if (args[1] === "is-enabled") return enabled ? ok("enabled\n") : fail("", "disabled\n");
      if (args[1] === "enable") enabled = true;
      if (args[1] === "restart") active = true;
      if (args[1] === "disable") { enabled = false; active = false; }
    }
    if (cmd === "schtasks.exe") {
      if (args[0] === "/Query") return enabled ? ok(taskXml) : { status: 0x80070002, stdout: "", stderr: "missing" };
      if (args[0] === "/Create") { taskXml = files.get(args[4])!; enabled = true; }
      if (args[0] === "/End") active = false;
      if (args[0] === "/Run") active = true;
      if (args[0] === "/Delete") enabled = false;
    }
    return ok();
  });
  const service = createAutostart({ platform, home, nodePath, cliPath, dbPath, uid: 501, run });
  return { service, run, home, nodePath, cliPath, taskName, active: () => active };
}

describe("native definitions", () => {
  it("generates a LaunchAgent with an argument array, immediate start, restart and both log streams", () => {
    const plist = renderPlist(launch, "/data/logs/watch & errors.log", "/users/A & B");
    expect(plist).toContain(`<key>Label</key><string>${LABEL}</string>`);
    expect(plist).toContain('<array><string>/opt/node &amp; co/node</string><string>/opt/session &amp; co/index.js</string><string>watch</string>');
    expect(plist).toContain('<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>');
    expect(plist.match(/watch &amp; errors.log/g)).toHaveLength(2);
    expect(plist).toContain('<key>ThrottleInterval</key><integer>10</integer>');
    expect(plist).not.toContain('/bin/sh');
  });
  it("quotes systemd arguments and escapes dollar variables and percent specifiers", () => {
    const unit = renderSystemd(launch, "/data/logs/watch % errors.log", "/users/A B");
    expect(unit).toContain('ExecStart="/opt/node & co/node" "/opt/session & co/index.js" "watch" "--db-path" "/data/a%%b$$db.db"');
    expect(unit).toContain('WorkingDirectory=/users/A B');
    expect(unit).toContain('Restart=always\nRestartSec=10');
    expect(unit).toContain('StandardInput=null');
    expect(unit).toContain('StandardError=append:/data/logs/watch %% errors.log');
    expect(unit).toContain('WantedBy=default.target');
  });
  it("quotes Windows arguments including trailing backslashes and embedded quotes", () => {
    expect(windowsQuote('C:\\some folder\\')).toBe('"C:\\some folder\\\\"');
    expect(windowsQuote('a"b')).toBe('"a\\"b"');
  });
  it("generates a per-user logon task without password, time limit or battery shutdown", () => {
    const task = renderTask({ command: 'C:\\Program Files\\node.exe', args: ['C:\\A & B\\index.js', 'watch'] }, 'C:\\A & B', 'DOMAIN\\A & B');
    expect(task).toContain('<LogonTrigger><Enabled>true</Enabled><UserId>DOMAIN\\A &amp; B</UserId>');
    expect(task).toContain('<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>');
    expect(task).toContain('<Arguments>&quot;C:\\A &amp; B\\index.js&quot; &quot;watch&quot;</Arguments>');
    expect(task).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(task).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(task).toContain('<RestartOnFailure><Interval>PT1M</Interval><Count>255</Count>');
    expect(task).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    // Microsoft Task Scheduler schema: version 1.3, restart Count is an
    // unsigned byte and Interval is at least one minute.
    expect(task).toContain('<Task version="1.3"');
    const count = Number(task.match(/<Count>(\d+)<\/Count>/)?.[1]);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(255);
    expect(task).not.toContain('Password');
  });
});

for (const platform of ["darwin", "linux", "win32"] as const) describe(platform, () => {
  it("updates one registration in place and stops capture on repeated disable", () => {
    const f = fixture(platform);
    expect(f.service.status().registered).toBe(false);
    f.service.enable();
    const first = new Map(files);
    expect(files.size).toBe(1);
    expect(f.active()).toBe(true);
    expect(f.service.status()).toMatchObject({ registered: true, launch: { command: f.nodePath, args: expect.arrayContaining([f.cliPath, "watch"]) } });
    f.service.enable();
    expect(files).toEqual(first);
    expect(files.size).toBe(1);
    expect(f.active()).toBe(true);
    f.service.disable();
    f.service.disable();
    expect(f.active()).toBe(false);
    expect(files.size).toBe(0);
    expect(f.service.status().registered).toBe(false);
    if (platform === "linux") {
      expect(f.run.mock.calls.filter(([, args]) => args[1] === "restart")).toEqual([
        ["systemctl", ["--user", "restart", UNIT]], ["systemctl", ["--user", "restart", UNIT]],
      ]);
    } else if (platform === "darwin") {
      expect([...first.keys()]).toEqual([`${f.home}/Library/LaunchAgents/${LABEL}.plist`]);
      expect(f.run).toHaveBeenCalledWith("launchctl", ["bootstrap", "gui/501", `${f.home}/Library/LaunchAgents/${LABEL}.plist`]);
      expect(f.run.mock.calls.filter(([, args]) => args[0] === "bootout")).toHaveLength(2);
    } else {
      expect(f.run.mock.calls.filter(([, args]) => args[0] === "/Create")).toEqual([
        ["schtasks.exe", ["/Create", "/TN", f.taskName, "/XML", 'C:\\Users\\A & B\\.sessionmem\\autostart-task.xml', "/F"]],
        ["schtasks.exe", ["/Create", "/TN", f.taskName, "/XML", 'C:\\Users\\A & B\\.sessionmem\\autostart-task.xml', "/F"]],
      ]);
      expect(f.run).toHaveBeenCalledWith("schtasks.exe", ["/Run", "/TN", f.taskName]);
      expect(f.run.mock.calls.filter(([, args]) => args[0] === "/Delete")).toHaveLength(1);
    }
  });
  it("uses the paths in the registration when this installation has moved", () => {
    const f = fixture(platform);
    f.service.enable();
    const other = createAutostart({ platform, home: f.home, nodePath: '/new/node', cliPath: '/new/index.js', run: f.run, uid: 501 });
    const registered = other.status();
    expect(registered.launch?.command).toBe(f.nodePath);
    expect(registered.launch?.args[0]).toBe(f.cliPath);
    vi.mocked(fs.statSync).mockImplementation(path => { if (path === f.cliPath) throw new Error("ENOENT"); return { isFile: () => true } as never; });
    expect(invalidLaunchPaths(registered.launch!)).toEqual([f.cliPath]);
  });
  it("updates the registered executable paths after an upgrade", () => {
    const f = fixture(platform); f.service.enable();
    const movedNode = platform === "win32" ? "C:\\new\\node.exe" : "/new/node";
    const movedCli = platform === "win32" ? "C:\\new\\sessionmem.js" : "/new/sessionmem.js";
    const updated = createAutostart({ platform, home: f.home, dbPath: platform === "win32" ? "C:\\data\\memories.db" : "/data/memories.db", nodePath: movedNode, cliPath: movedCli, uid: 501, run: f.run });
    updated.enable();
    expect(updated.status().launch).toMatchObject({ command: movedNode, args: expect.arrayContaining([movedCli]) });
    expect(files.size).toBe(platform === "win32" ? 2 : 1); // task XML is a staging file; OS task identity stays fixed
  });
  it("reports native registration failures", () => {
    const f = fixture(platform);
    f.run.mockReturnValue(fail("Access denied"));
    expect(() => f.service.enable()).toThrow(/Access denied/);
  });
  it("retains the definition when the OS refuses to stop or unregister it", () => {
    const f = fixture(platform);
    f.service.enable();
    f.run.mockReturnValue(fail("Access denied"));
    expect(() => f.service.disable()).toThrow(/Access denied/);
    expect(files.size).toBe(1);
  });
});

it("rejects unsupported platforms and an ephemeral database", () => {
  expect(() => createAutostart({ platform: "freebsd" })).toThrow(/unsupported/);
  expect(() => createAutostart({ dbPath: ":memory:" })).toThrow(/persistent/);
});
it("refuses registration when the installed executable is missing", () => {
  const f = fixture();
  vi.mocked(fs.statSync).mockImplementation(() => { throw new Error("ENOENT"); });
  expect(() => f.service.enable()).toThrow(/installed binary/);
  expect(f.run).not.toHaveBeenCalled();
});
it("reports a disabled user service and rejects malformed native command lines", () => {
  const f = fixture();
  f.service.enable();
  f.run.mockReturnValue(fail("", "disabled\n"));
  expect(f.service.status().registered).toBe(false);
  files.set(`${f.home}/.config/systemd/user/${UNIT}`, "[Service]\nExecStart=unknown\n");
  expect(() => f.service.status()).toThrow(/Unrecognized watcher/);
});

it("decodes UTF-16 task XML and UTF-8 output without losing non-ASCII paths", () => {
  expect(decodeCommandOutput(Buffer.from("\uFEFF<Command>C:\\用户\\node.exe</Command>", "utf16le"))).toBe("<Command>C:\\用户\\node.exe</Command>");
  expect(decodeCommandOutput(Buffer.from("Résumé"))).toBe("Résumé");
});
it("accepts the numeric not-running HRESULT when disabling a stopped Windows task", () => {
  const f = fixture("win32"); f.service.enable();
  const normal = f.run.getMockImplementation()!;
  f.run.mockImplementation((cmd, args) => args[0] === "/End" ? { status: -2147216629, stdout: "", stderr: "localized error" } : normal(cmd, args));
  expect(() => f.service.disable()).not.toThrow();
  expect(f.run).toHaveBeenCalledWith("schtasks.exe", ["/End", "/TN", f.taskName, "/HRESULT"]);
});
