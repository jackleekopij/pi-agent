/**
 * pi-mcp-ui MCP server.
 *
 * createPiServer() builds an McpServer wired to a PiBridge (one live pi agent)
 * with the pi_* tools and the pi_open UI tool. The default entrypoint runs it
 * over stdio for Claude Desktop; the dev server reuses createPiServer() over an
 * HTTP transport for the browser preview.
 *
 * IMPORTANT: in stdio mode, stdout is the MCP channel — all logging goes to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { PiBridge, type PiBridgeOptions } from "./pi-bridge.js";
import { registerPiTools } from "./tools.js";
import { registerChatUI, type UiTrack } from "./ui.js";

export interface CreateServerOptions extends PiBridgeOptions {
  track?: UiTrack;
}

/** Build an McpServer wired to an existing bridge. Used per-session by the dev
 *  server so multiple browser sessions can share one pi process. */
export function buildServer(bridge: PiBridge, track: UiTrack = "apps"): McpServer {
  const server = new McpServer(
    { name: "pi-mcp-ui", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerPiTools(server, bridge);
  registerChatUI(server, track);
  return server;
}

export function createPiServer(opts: CreateServerOptions = {}): { server: McpServer; bridge: PiBridge } {
  const bridge = new PiBridge(opts);
  const server = buildServer(bridge, opts.track ?? "apps");
  return { server, bridge };
}

export function configFromEnv(): CreateServerOptions {
  const track: UiTrack = process.env.PI_MCP_UI_TRACK === "mcpui" ? "mcpui" : "apps";
  return {
    cwd: process.env.PI_CWD || process.cwd(),
    provider: process.env.PI_PROVIDER || undefined,
    model: process.env.PI_MODEL || undefined,
    track,
  };
}

async function main(): Promise<void> {
  const opts = configFromEnv();
  const { server, bridge } = createPiServer(opts);

  const shutdown = async () => {
    await bridge.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[pi-mcp-ui] stdio ready — track=${opts.track}, cwd=${opts.cwd}`);
}

// Run main() only when executed directly (not when imported by the dev server).
const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("[pi-mcp-ui] fatal:", err);
    process.exit(1);
  });
}
