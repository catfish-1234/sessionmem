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
      version: "0.1.0",
      message: "sessionmem MCP server is operational.",
    };
  }
};
