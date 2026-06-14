/**
 * Dev preview host (browser). A minimal but faithful MCP Apps host:
 *
 *   1. connect a real MCP Client to the dev server over StreamableHTTP
 *   2. call pi_open and obtain the widget HTML (inline for mcpui, read resource for apps)
 *   3. render it in a sandboxed iframe
 *   4. bridge the iframe to the Client with AppBridge + PostMessageTransport, so the
 *      widget's callServerTool() calls are forwarded to the real server → pi.
 *
 * This is bundled by esbuild (npm run build:dev) into dist/dev/dev-entry.js.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const CHAT_RESOURCE_URI = "ui://pi-agent/chat";

const statusEl = document.getElementById("dev-status")!;
const frameWrap = document.getElementById("frame")!;
const setStatus = (s: string) => (statusEl.textContent = s);

function findInlineHtml(result: any): string | null {
  for (const c of result?.content ?? []) {
    if (c?.type === "resource" && typeof c.resource?.text === "string") return c.resource.text;
  }
  return null;
}

async function extractWidgetHtml(client: Client, openResult: any): Promise<string> {
  const inline = findInlineHtml(openResult); // mcpui track
  if (inline) return inline;
  const res: any = await client.readResource({ uri: CHAT_RESOURCE_URI }); // apps track
  const item = res?.contents?.find((c: any) => typeof c.text === "string");
  if (item?.text) return item.text;
  throw new Error("Could not obtain widget HTML from pi_open result");
}

async function main() {
  setStatus("connecting…");
  const client = new Client({ name: "pi-dev-host", version: "0.1.0" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", location.origin)));

  setStatus("opening pi…");
  const opened = await client.callTool({ name: "pi_open", arguments: {} });
  const html = await extractWidgetHtml(client, opened);

  const iframe = document.createElement("iframe");
  // Dev sandbox keeps the iframe same-origin so postMessage origins stay clean.
  // Production hosts (Claude Desktop) apply their own stricter sandboxing.
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  iframe.style.cssText = "width:100%;height:100%;border:0;display:block;";
  iframe.srcdoc = html;
  frameWrap.innerHTML = "";
  frameWrap.appendChild(iframe);
  await new Promise<void>((res) => iframe.addEventListener("load", () => res(), { once: true }));

  const isDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const bridge = new AppBridge(client, { name: "pi-dev-host", version: "0.1.0" }, {});
  bridge.setHostContext({ theme: isDark ? "dark" : "light" });
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));

  setStatus("connected");
}

main().catch((err) => {
  console.error(err);
  setStatus("error: " + (err?.message ?? String(err)));
});
