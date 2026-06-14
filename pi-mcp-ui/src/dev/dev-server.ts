/**
 * Dev server: serves the dev preview page and exposes the MCP server over
 * StreamableHTTP at /mcp so the browser dev host can drive the real pi agent.
 *
 * Uses the standard StreamableHTTP session pattern: each browser connection
 * (initialize) gets its own transport + McpServer, all sharing ONE PiBridge
 * (one pi process). This survives page reloads and multiple tabs.
 *
 * Run with: npm run dev   (builds the widget + dev-entry, then `tsx` this file)
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { PiBridge } from "../pi-bridge.js";
import { buildServer, configFromEnv } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const port = Number(process.env.PI_DEV_PORT || 5174);
const opts = configFromEnv();

// One shared pi session across all browser connections.
const bridge = new PiBridge(opts);
const transports = new Map<string, StreamableHTTPServerTransport>();

const page = readFileSync(resolve(here, "dev-page.html"), "utf8");
function devEntry(): string {
  return readFileSync(resolve(root, "dist/dev/dev-entry.js"), "utf8");
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        res(data ? JSON.parse(data) : undefined);
      } catch {
        res(undefined);
      }
    });
  });
}

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const body = req.method === "POST" ? await readJson(req) : undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (req.method === "POST" && isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await buildServer(bridge, opts.track ?? "apps").connect(transport);
    } else {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid MCP session — send an initialize request first" },
          id: null,
        }),
      );
      return;
    }
  }

  await transport.handleRequest(req, res, body);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    try {
      if (url.pathname === "/mcp") return await handleMcp(req, res);
      if (url.pathname === "/dev-entry.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(devEntry());
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  })
  .listen(port, () => {
    console.error(`[pi-mcp-ui] dev preview → http://127.0.0.1:${port}`);
    console.error(`[pi-mcp-ui]   track=${opts.track}  cwd=${opts.cwd}  provider=${opts.provider ?? "(pi default)"}`);
  });

const shutdown = async () => {
  await bridge.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
