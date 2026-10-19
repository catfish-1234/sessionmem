import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { AdapterFactory, type AdapterName } from "./factory.js";
import type { HostAdapterContract } from "./contract/hostAdapterContract.js";

export interface HostDetection {
  adapter: AdapterName;
  executables: readonly string[];
  /** Known installation locations outside PATH, relative to the home directory. */
  homeExecutables?: readonly string[];
}

// Installed-host detection is deliberately separate from runtime session-env
// detection. Add a row here when another host has a verified install probe.
export const INSTALLED_HOSTS: readonly HostDetection[] = [
  { adapter: "codex", executables: ["codex"] },
  { adapter: "cursor", executables: ["cursor"] },
  { adapter: "windsurf", executables: ["windsurf"] },
  {
    adapter: "claude-code",
    executables: ["claude"],
    homeExecutables: [".local/bin/claude", ".claude/local/claude"],
  },
];

export function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function executableCandidates(file: string): string[] {
  if (process.platform !== "win32") return [file];
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
  return [file, ...extensions.filter(Boolean).map((ext) => file + ext.toLowerCase())];
}

export function detectInstalledAdapters(
  table: readonly HostDetection[] = INSTALLED_HOSTS,
): HostAdapterContract[] {
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return table.filter((host) => {
    const paths = [
      ...host.executables.flatMap((name) => pathDirs.map((dir) => join(dir.replace(/^"|"$/g, ""), name))),
      ...(host.homeExecutables ?? []).map((file) => join(homedir(), file)),
    ];
    return paths.some((file) => executableCandidates(file).some(isExecutable));
  }).map((host) => AdapterFactory.forName(host.adapter));
}

/** Explicit flags take precedence over the existing environment override. */
export function resolveInstallAdapters(options?: { adapter?: string }): {
  adapters: HostAdapterContract[];
  forced: boolean;
} {
  const explicit = options?.adapter?.trim() || process.env.SESSIONMEM_ADAPTER?.trim();
  if (explicit) return { adapters: [AdapterFactory.forName(explicit)], forced: true };
  const adapters = detectInstalledAdapters();
  if (adapters.length === 0) {
    throw new Error("No supported agent host found. Install a supported host CLI or use sessionmem install --adapter <name>.");
  }
  return { adapters, forced: false };
}
