import { once } from "node:events";
import { createCliContext } from "../context.js";
import { parseApiOptions, startApiServer, type ApiServerOptions } from "../../api/server.js";

export async function serveCommand(options: ApiServerOptions & { api?: boolean }): Promise<void> {
  if (!options.api) throw new Error("Use sessionmem serve --api to start the local single-user API");
  const parsed = parseApiOptions({ ...options, token: options.token ?? (process.env.SESSIONMEM_API_TOKEN || undefined) });
  const context = createCliContext();
  try {
    const api = await startApiServer(context, { ...parsed, allowRemote: options.allowRemote });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void api.close().catch(() => { process.exitCode = 1; });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const closed = once(api.server, "close");
      console.log(`sessionmem local API: ${api.url}\nProject: ${context.projectId}\nLocal single-user API, not a hosted service. Bearer auth ${parsed.token ? "enabled" : "disabled"}. Press Ctrl-C to stop.`);
      await closed;
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally { context.db.close(); }
}
