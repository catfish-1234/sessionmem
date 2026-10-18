import { createAutostart, invalidLaunchPaths, type Autostart } from "../autostart/index.js";

export function autostartCommand(action: string, service?: Autostart): void {
  if (!["enable", "disable", "status"].includes(action)) throw new Error("Use sessionmem autostart enable, disable, or status");
  const autostart = service ?? createAutostart();
  if (action === "status") {
    const status = autostart.status();
    console.log(`Auto-start ${status.registered ? "enabled" : "disabled"}: ${status.detail}`);
    if (status.launch) {
      console.log(`Binary: ${status.launch.command}\nEntry point: ${status.launch.args[0]}`);
      const invalid = invalidLaunchPaths(status.launch);
      if (invalid.length) {
        console.error(`Invalid binary path: ${invalid.join(", ")}. Run sessionmem autostart enable.`);
        process.exitCode = 1;
      }
    }
    return;
  }
  if (action === "enable") autostart.enable();
  else autostart.disable();
  console.log(`Auto-start ${action === "enable" ? "enabled and started" : "disabled and stopped"}`);
}
