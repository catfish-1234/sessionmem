#!/usr/bin/env node
import { Command } from "commander";
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

const program = new Command();
program.name("sessionmem").version("0.1.0");

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

program
  .command("search <query>")
  .description("Search memories by semantic query")
  .option("--limit <n>", "Maximum number of results", "10")
  .action(searchCommand);

program
  .command("list")
  .description("List all memories for the current project")
  .action(listCommand);

program
  .command("show <id>")
  .description("Show full details of a memory by ID")
  .action(showCommand);

program
  .command("forget <id>")
  .description("Delete a memory by ID")
  .option("--force", "Confirm deletion without dry-run prompt")
  .action(forgetCommand);

program
  .command("export [path]")
  .description("Export memories to a JSON file")
  .action(exportCommand);

program
  .command("import <path>")
  .description("Import memories from a JSON file")
  .option("--merge", "Overwrite existing memories with imported data")
  .action(importCommand);

program
  .command("stats")
  .description("Show memory statistics for the current project")
  .action(statsCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
