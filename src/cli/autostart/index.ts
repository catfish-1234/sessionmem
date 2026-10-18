import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "os";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDbPath } from "../context.js";

export interface Launch { command: string; args: string[] }
export interface Registration { registered: boolean; launch?: Launch; detail: string }
export interface Autostart {
  enable(): void;
  disable(): void;
  status(): Registration;
}
export interface CommandResult { status: number; stdout: string; stderr: string }
export type Runner = (command: string, args: string[]) => CommandResult;
export interface AutostartOptions {
  platform?: NodeJS.Platform;
  home?: string;
  dbPath?: string;
  nodePath?: string;
  cliPath?: string;
  uid?: number;
  run?: Runner;
}

export const LABEL = "io.sessionmem.watch";
export const UNIT = "sessionmem-watch.service";
export const xml = (value: string): string => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const unxml = (value: string): string => value.replace(/&(amp|lt|gt|quot|apos);/g, c => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[c]!);
const systemdQuote = (value: string): string => JSON.stringify(value).replace(/%/g, "%%").replace(/\$/g, () => "$$");
// All generated Windows arguments are quoted. Double backslashes before quotes
// and at the closing quote according to CommandLineToArgvW rules.
export const windowsQuote = (value: string): string => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;

export function renderPlist(launch: Launch, log: string, home: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${[launch.command, ...launch.args].map(v => `<string>${xml(v)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(home)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

export function renderSystemd(launch: Launch, log: string, home: string): string {
  return `[Unit]
Description=Capture agent transcripts with sessionmem
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=${[launch.command, ...launch.args].map(systemdQuote).join(" ")}
WorkingDirectory=${home.replace(/%/g, "%%")}
Restart=always
RestartSec=10
StandardInput=null
StandardOutput=append:${log.replace(/%/g, "%%")}
StandardError=append:${log.replace(/%/g, "%%")}

[Install]
WantedBy=default.target
`;
}

export function renderTask(launch: Launch, home: string, user: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(user)}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>255</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>${xml(launch.command)}</Command><Arguments>${xml(launch.args.map(windowsQuote).join(" "))}</Arguments><WorkingDirectory>${xml(home)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

export function decodeCommandOutput(value: Buffer): string {
  // schtasks XML may use UTF-16 even when stdout is a pipe.
  return (value[0] === 0xff && value[1] === 0xfe) || value[1] === 0
    ? value.toString("utf16le").replace(/^\uFEFF/, "") : value.toString("utf8").replace(/^\uFEFF/, "");
}

export const runCommand: Runner = (command, args) => {
  const result = spawnSync(command, args, { windowsHide: true, timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: decodeCommandOutput(result.stdout), stderr: decodeCommandOutput(result.stderr) };
};

function checked(run: Runner, command: string, args: string[]): CommandResult {
  const result = run(command, args);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`}`);
  return result;
}
function save(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}
function strings(value: string): string[] {
  return [...value.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(m => unxml(m[1]));
}
function launchFromArgs(args: string[]): Launch {
  if (args.length < 3 || args[2] !== "watch") throw new Error("Unrecognized watcher command; run sessionmem autostart enable");
  return { command: args[0], args: args.slice(1) };
}

export function invalidLaunchPaths(launch: Launch): string[] {
  return [launch.command, launch.args[0]].filter((path, index) => {
    try {
      if (!path || (!isAbsolute(path) && !win32.isAbsolute(path)) || !statSync(path).isFile()) return true;
      accessSync(path, index === 0 && process.platform !== "win32" ? constants.X_OK : constants.R_OK);
      return false;
    } catch { return true; }
  });
}

export function createAutostart(options: AutostartOptions = {}): Autostart {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const paths = platform === "win32" ? win32 : { join, dirname, resolve };
  const selectedDb = options.dbPath ?? resolveDbPath();
  if (selectedDb === ":memory:") throw new Error("Login capture requires a persistent database");
  const dbPath = paths.resolve(selectedDb);
  const data = paths.dirname(dbPath);
  const log = paths.join(data, "logs", "watch.log");
  // npm's sessionmem binary is a JS entry point. Pin both it and Node, avoiding
  // /usr/bin/env, npm shims and interactive shell/version-manager setup at login.
  const launch: Launch = {
    command: paths.resolve(options.nodePath ?? process.execPath),
    args: [paths.resolve(options.cliPath ?? fileURLToPath(new URL("../index.js", import.meta.url))), "watch", "--db-path", dbPath, "--log-file", log],
  };
  const run = options.run ?? runCommand;
  const invoke = (command: string, args: string[]) => checked(run, command, args);
  const prepare = () => {
    if ([home, launch.command, ...launch.args].some(value => /[\r\n\0]/.test(value))) throw new Error("Login service paths cannot contain line breaks or NUL");
    const invalid = invalidLaunchPaths(launch);
    if (invalid.length) throw new Error(`Cannot read or execute installed binary: ${invalid.join(", ")}`);
    mkdirSync(paths.dirname(log), { recursive: true });
  };
  if (platform === "darwin") {
    const file = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
    const domain = `gui/${options.uid ?? userInfo().uid}`;
    const target = `${domain}/${LABEL}`;
    const loaded = () => {
      const result = run("launchctl", ["print", target]);
      if (result.status === 0) return true;
      if (/could not find service|no such process/i.test(result.stderr)) return false;
      throw new Error(`launchctl print: ${result.stderr || result.stdout}`);
    };
    return {
      enable() {
        prepare();
        if (loaded()) invoke("launchctl", ["bootout", target]);
        save(file, renderPlist(launch, log, home));
        invoke("launchctl", ["enable", target]);
        invoke("launchctl", ["bootstrap", domain, file]);
      },
      disable() {
        if (loaded()) invoke("launchctl", ["bootout", target]);
        rmSync(file, { force: true });
      },
      status() {
        if (!existsSync(file)) return { registered: false, detail: `No LaunchAgent (${file})` };
        const content = readFileSync(file, "utf8");
        const args = strings(content.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? "");
        return { registered: loaded(), launch: launchFromArgs(args), detail: file };
      },
    };
  }
  if (platform === "linux") {
    const file = join(home, ".config", "systemd", "user", UNIT);
    return {
      enable() {
        prepare();
        save(file, renderSystemd(launch, log, home));
        invoke("systemctl", ["--user", "daemon-reload"]);
        invoke("systemctl", ["--user", "enable", UNIT]);
        invoke("systemctl", ["--user", "restart", UNIT]);
      },
      disable() {
        if (!existsSync(file)) return;
        invoke("systemctl", ["--user", "disable", "--now", UNIT]);
        rmSync(file, { force: true });
        invoke("systemctl", ["--user", "daemon-reload"]);
      },
      status() {
        if (!existsSync(file)) return { registered: false, detail: `No user service (${file})` };
        const value = readFileSync(file, "utf8").match(/^ExecStart=(.+)$/m)?.[1] ?? "";
        const args = [...value.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => JSON.parse(m[0]).replace(/%%/g, "%").replace(/\$\$/g, "$"));
        const result = run("systemctl", ["--user", "is-enabled", UNIT]);
        if (result.status !== 0 && !["disabled", "masked", "not-found"].includes(result.stdout.trim())) throw new Error(`systemctl --user is-enabled: ${result.stderr || result.stdout}`);
        return { registered: result.status === 0, launch: launchFromArgs(args), detail: `${file} (${result.stdout.trim()})` };
      },
    };
  }
  if (platform === "win32") {
    // Task names are machine-wide; one stable name per user's home avoids
    // overwriting another user's task on shared Windows machines.
    const name = `sessionmem-watch-${createHash("sha256").update(home.toLowerCase()).digest("hex").slice(0, 12)}`;
    const file = paths.join(data, "autostart-task.xml");
    const query = (): string | undefined => {
      const result = run("schtasks.exe", ["/Query", "/TN", name, "/XML", "/HRESULT"]);
      if ((result.status >>> 0) === 0x80070002) return undefined; // ERROR_FILE_NOT_FOUND
      if (result.status !== 0) throw new Error(`schtasks /Query: ${result.stderr || result.stdout || result.status}`);
      return result.stdout;
    };
    const stop = () => {
      const result = run("schtasks.exe", ["/End", "/TN", name, "/HRESULT"]);
      // Numeric HRESULTs avoid matching localized Windows error messages.
      if (result.status !== 0 && (result.status >>> 0) !== 0x8004130b) throw new Error(`schtasks /End: ${result.stderr || result.stdout || result.status}`);
    };
    return {
      enable() {
        prepare();
        const identity = invoke("whoami.exe", ["/USER", "/FO", "CSV", "/NH"]).stdout;
        const user = identity.match(/"(S-1-[0-9-]+)"/)?.[1];
        if (!user) throw new Error("whoami returned no user SID for the logon task");
        if (query() !== undefined) stop();
        save(file, renderTask(launch, home, user));
        invoke("schtasks.exe", ["/Create", "/TN", name, "/XML", file, "/F"]);
        invoke("schtasks.exe", ["/Run", "/TN", name]);
      },
      disable() {
        if (query() !== undefined) {
          stop();
          invoke("schtasks.exe", ["/Delete", "/TN", name, "/F"]);
        }
        rmSync(file, { force: true });
      },
      status() {
        const content = query();
        if (content === undefined) return { registered: false, detail: `No Scheduled Task (${name})` };
        const command = unxml(content.match(/<Command>([\s\S]*?)<\/Command>/)?.[1] ?? "");
        const args = unxml(content.match(/<Arguments>([\s\S]*?)<\/Arguments>/)?.[1] ?? "");
        // The first argument is an absolute .js path, which cannot contain quotes
        // on Windows. The remaining arguments are only needed for display.
        const cli = args.match(/^"([^"]+)"\s+"watch"(?:\s|$)/)?.[1];
        if (!command || !cli) throw new Error("Unrecognized Scheduled Task action; run sessionmem autostart enable");
        return { registered: !/<Enabled>false<\/Enabled>/.test(content), launch: { command, args: [cli, "watch"] }, detail: name };
      },
    };
  }
  throw new Error(`Login auto-start is unsupported on ${platform}`);
}
