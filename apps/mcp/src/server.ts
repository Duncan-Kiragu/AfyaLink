import { McpServer } from "@modelcontextprotocol/server";
import { mcpTools } from "./tools/index.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "kkd",
    version: "0.0.0",
  });

  for (const name of mcpTools) {
    server.registerTool(
      name,
      {
        description: `${name} is not implemented. This tool must not diagnose or return disease probabilities.`,
      },
      async () => {
        return {
          content: [{ type: "text", text: `${name} is not implemented` }],
          isError: true,
        };
      },
    );
  }

  return server;
}
