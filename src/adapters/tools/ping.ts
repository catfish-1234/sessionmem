import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json") as { version: string };

export const pingTool = {
  name: "sessionmem_ping",
  description: "Ping the sessionmem MCP server to verify it is running correctly.",
  schema: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    return {
      status: "ok",
      version: pkg.version,
      message: "sessionmem MCP server is operational.",
    };
  }
};
