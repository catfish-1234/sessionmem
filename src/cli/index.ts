#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { runMcpServer } from "./commands/run.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { pingCommand } from "./commands/ping.js";
import { searchCommand } from "./commands/search.js";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { forgetCommand } from "./commands/forget.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { statsCommand } from "./commands/stats.js";
import { redactScanCommand } from "./commands/redactScan.js";
import { retentionPruneCommand } from "./commands/retention.js";
import { configGetCommand, configSetCommand } from "./commands/config.js";
import {
  teamEnableCommand,
  teamDisableCommand,
  teamStatusCommand,
} from "./commands/team.js";
import { syncCommand } from "./commands/sync.js";

// Source the version from package.json (single source of truth) so `--version`
// never drifts from the published manifest. createRequire + resolveJsonModule
// reads the manifest relative to this module; from dist/cli/index.js the
// "../../package.json" specifier resolves to the package root.
const pkg = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

const program = new Command();
program.name("sessionmem").version(pkg.version);

program
  .command("run")
  .description("Start the sessionmem MCP server")
  .action(runMcpServer);

program
  .command("install")
  .description("Install sessionmem into the current MCP host")
  .action(installCommand);

program
  .command("uninstall")
  .description("Remove sessionmem from the current MCP host")
  .option("--purge", "Also delete the local memories database")
  .action(uninstallCommand);

program
  .command("ping")
  .description("Check sessionmem server connectivity")
  .action(pingCommand);

// NOTE: commander always appends its own Command instance as the final
// argument to .action() callbacks. The search/list/show/forget/export/import/
// stats commands all declare a trailing `ctx?: CliContext` parameter (the
// test-injection seam). Passing a bare function reference would let commander's
// Command object land in the ctx slot, so `ctx ?? createCliContext()` resolves
// to a Command (which has no `.service`) and every command crashes at runtime.
// Arrow-wrap each handler to forward ONLY the real positional args/options and
// drop commander's trailing Command argument, leaving ctx undefined in
// production so each command falls through to createCliContext().
program
  .command("search <query>")
  .description("Search memories by semantic query")
  .option("--limit <n>", "Maximum number of results", "10")
  .action((query, options) => searchCommand(query, options));

program
  .command("list")
  .description("List all memories for the current project")
  .action(() => listCommand());

program
  .command("show <id>")
  .description("Show full details of a memory by ID")
  .action((id) => showCommand(id));

program
  .command("forget <id>")
  .description("Delete a memory by ID")
  .option("--force", "Confirm deletion without dry-run prompt")
  .action((id, options) => forgetCommand(id, options));

program
  .command("export [path]")
  .description("Export memories to a JSON file")
  .action((path) => exportCommand(path));

program
  .command("import <path>")
  .description("Import memories from a JSON file")
  .option("--merge", "Overwrite existing memories with imported data")
  .action((path, options) => importCommand(path, options));

program
  .command("stats")
  .description("Show memory statistics for the current project")
  .action(() => statsCommand());

// redact-scan — one-time scrub over existing memories. Scan is the
// non-destructive default; --apply redacts matching rows in place.
program
  .command("redact-scan")
  .description("Scan existing memories for secrets (dry-run by default)")
  .option("--apply", "Redact matching memories in place")
  .action((options) => redactScanCommand(options));

// retention command group — room for future subcommands. The "prune"
// subcommand is dry-run by default; --force confirms the hard delete.
const retention = program
  .command("retention")
  .description("Retention policy operations");

retention
  .command("prune")
  .description("Delete memories older than the retention window (dry-run by default)")
  .option("--force", "Confirm deletion without dry-run")
  .option("--days <n>", "Override the retention window in days")
  .action((options) => retentionPruneCommand(options));

// config command group — generic get/set over ~/.sessionmem/config.json.
// config get/set are synchronous and take no CliContext, so the arrow-wrap here
// only drops commander's trailing Command argument.
const config = program
  .command("config")
  .description("Read and write sessionmem policy config");

config
  .command("get <key>")
  .description("Print the effective value of a config key")
  .action((key) => configGetCommand(key));

config
  .command("set <key> <value>")
  .description("Persist a config key to ~/.sessionmem/config.json")
  .action((key, value) => configSetCommand(key, value));

// team command group — turn shared-memory mode on/off and inspect it.
// enable/status take no CliContext (config-only), so their arrow-wraps just drop
// commander's trailing Command argument. disable accepts an optional CliContext
// seam for the --remove-team-memories DB delete; the arrow-wrap forwards only
// options so production falls through to createCliContext() (NOTE above).
const team = program
  .command("team")
  .description("Manage shared-path team memory mode");

team
  .command("enable <path>")
  .description("Enable team mode and record the shared memory path")
  .action((path) => teamEnableCommand(path));

team
  .command("disable")
  .description("Disable team mode (teammate memories preserved by default)")
  .option(
    "--remove-team-memories",
    "Also delete teammate-authored memories for this project (local-only revert)",
  )
  .action((options) => teamDisableCommand(options));

team
  .command("status")
  .description("Show team mode state and shared-path availability")
  .action(() => teamStatusCommand());

// sync — push a local snapshot to the shared path and pull every
// teammate snapshot back. syncCommand declares a trailing `ctx?` test seam, so
// arrow-wrap to drop commander's trailing Command argument (NOTE above).
program
  .command("sync")
  .description("Push local memories and pull teammate memories via the shared path")
  .action(() => syncCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
