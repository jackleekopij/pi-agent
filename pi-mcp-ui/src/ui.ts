/**
 * pi_open — the entry tool that surfaces the chat GUI — in both delivery tracks.
 *
 *   apps  : official MCP Apps (SEP-1865). The widget is a *predeclared* resource
 *           (ui://pi-agent/chat) registered via @modelcontextprotocol/ext-apps;
 *           pi_open links to it through tool _meta. Native to Claude Desktop.
 *
 *   mcpui : the @mcp-ui/server SDK. pi_open returns the widget *inline* as an
 *           embedded UI resource built with createUIResource().
 *
 * Both tracks ship the SAME widget (src/widget/chat.ts), which speaks the MCP
 * Apps guest protocol. We therefore advertise the MCP Apps mime type in both
 * cases and do NOT use mcp-ui's adapter (its injected bridge would collide with
 * the widget's own @modelcontextprotocol/ext-apps App bridge).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { createUIResource } from "@mcp-ui/server";
import { CHAT_WIDGET_HTML } from "./widget.generated.js";

export const CHAT_RESOURCE_URI = "ui://pi-agent/chat";
export const BAR_CHART_RESOURCE_URI = "ui://pi-agent/bar-chart";
export type UiTrack = "apps" | "mcpui";

const BAR_CHART_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 18px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #ffffff;
        color: #18181b;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0b0b0d; color: #f4f4f5; }
        .card { background: #18181b; border-color: #27272a; }
        .axis, .tick { color: #a1a1aa; }
      }
      .card {
        width: min(560px, 100%);
        border: 1px solid #e4e4e7;
        border-radius: 16px;
        padding: 18px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
      }
      h1 { margin: 0 0 4px; font-size: 18px; }
      p { margin: 0 0 18px; font-size: 13px; color: #71717a; }
      .chart { display: grid; gap: 12px; }
      .row { display: grid; grid-template-columns: 72px 1fr 42px; gap: 10px; align-items: center; }
      .label, .value { font-size: 13px; }
      .track { height: 28px; border-radius: 999px; background: rgba(113, 113, 122, 0.18); overflow: hidden; }
      .bar {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #6366f1, #22c55e);
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 8px;
        color: white;
        font-weight: 700;
        font-size: 12px;
        min-width: 28px;
      }
      .axis { display: flex; justify-content: space-between; margin: 10px 52px 0 82px; font-size: 11px; }
    </style>
  </head>
  <body>
    <section class="card" aria-label="Quarterly revenue bar chart">
      <h1>Quarterly Revenue</h1>
      <p>Example MCP-UI rendered result</p>
      <div class="chart">
        ${[
          ["Q1", 42],
          ["Q2", 68],
          ["Q3", 55],
          ["Q4", 91],
        ]
          .map(
            ([label, value]) => `<div class="row">
              <div class="label">${label}</div>
              <div class="track"><div class="bar" style="width: ${value}%">${value}</div></div>
              <div class="value">${value}k</div>
            </div>`,
          )
          .join("")}
      </div>
      <div class="axis"><span>0</span><span>25</span><span>50</span><span>75</span><span>100k</span></div>
    </section>
  </body>
</html>`;

export function registerChatUI(server: McpServer, track: UiTrack): void {
  if (track === "apps") {
    registerAppResource(
      server,
      "pi chat",
      CHAT_RESOURCE_URI,
      { description: "Interactive chat GUI for the pi coding agent" },
      async () => ({
        contents: [{ uri: CHAT_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: CHAT_WIDGET_HTML }],
      }),
    );

    registerAppTool(
      server,
      "pi_open",
      {
        title: "Open pi",
        description: "Open the interactive pi chat GUI (renders an inline panel).",
        _meta: { ui: { resourceUri: CHAT_RESOURCE_URI } },
      },
      async () => ({ content: [{ type: "text", text: "Opened the pi chat panel." }] }),
    );

    registerAppResource(
      server,
      "sample bar chart",
      BAR_CHART_RESOURCE_URI,
      { description: "A sample bar chart rendered as an MCP UI/App resource" },
      async () => ({
        contents: [{ uri: BAR_CHART_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: BAR_CHART_HTML }],
      }),
    );

    registerAppTool(
      server,
      "bar_chart_open",
      {
        title: "Open bar chart",
        description: "Render a sample bar chart inline as an MCP UI result.",
        _meta: { ui: { resourceUri: BAR_CHART_RESOURCE_URI } },
      },
      async () => ({ content: [{ type: "text", text: "Opened the sample bar chart." }] }),
    );
    return;
  }

  // mcpui track: build the embedded UI resource with the mcp-ui server SDK.
  server.registerTool(
    "pi_open",
    {
      title: "Open pi",
      description: "Open the interactive pi chat GUI (returns an inline UI resource).",
    },
    async () => {
      const ui = createUIResource({
        uri: CHAT_RESOURCE_URI,
        content: { type: "rawHtml", htmlString: CHAT_WIDGET_HTML },
        encoding: "text",
      });
      // createUIResource defaults to text/html; our widget uses the MCP Apps
      // guest protocol, so advertise the MCP Apps profile mime type instead.
      (ui.resource as { mimeType: string }).mimeType = RESOURCE_MIME_TYPE;
      return { content: [ui] } as Awaited<ReturnType<Parameters<McpServer["registerTool"]>[2]>>;
    },
  );

  server.registerTool(
    "bar_chart_open",
    {
      title: "Open bar chart",
      description: "Render a sample bar chart inline as an MCP UI result.",
    },
    async () => {
      const ui = createUIResource({
        uri: BAR_CHART_RESOURCE_URI,
        content: { type: "rawHtml", htmlString: BAR_CHART_HTML },
        encoding: "text",
      });
      return { content: [ui] } as Awaited<ReturnType<Parameters<McpServer["registerTool"]>[2]>>;
    },
  );
}
