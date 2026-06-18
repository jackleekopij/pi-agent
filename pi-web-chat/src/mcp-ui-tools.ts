import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registry } from "@pi-harness/viz";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type McpCallResult = { content?: unknown[]; isError?: boolean; [key: string]: unknown };

type McpLogger = (level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void;

let clientPromise: Promise<Client> | undefined;
let mcpLogger: McpLogger | undefined;
let mcpCwd = process.cwd();

function mcpLog(level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) {
  mcpLogger?.(level, message, meta);
}

function mcpServerPath(): string {
  return process.env.PI_MCP_UI_SERVER || path.resolve(__dirname, "../../pi-mcp-ui/dist/server.js");
}

async function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new Client({ name: "process-ai-harness-web-chat", version: "1.0.0" });
      const serverPath = mcpServerPath();
      mcpLog("info", "Starting pi-mcp-ui stdio server", { serverPath, cwd: mcpCwd });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: {
          ...process.env,
          PI_MCP_UI_TRACK: process.env.PI_MCP_UI_TRACK || "mcpui",
          PI_CWD: mcpCwd,
        } as Record<string, string>,
      });
      await client.connect(transport);
      mcpLog("info", "Connected to pi-mcp-ui MCP server", { serverPath, cwd: mcpCwd });
      return client;
    })();
  }
  return clientPromise;
}

function summarizeMcpResult(toolName: string, result: McpCallResult): string {
  const count = Array.isArray(result.content) ? result.content.length : 0;
  if (result.isError) return `MCP UI server returned an error for ${toolName}.`;
  return `MCP UI server rendered ${toolName} and returned ${count} UI resource/content item${count === 1 ? "" : "s"}.`;
}

async function callMcpTool(toolName: string, args: Record<string, unknown>) {
  mcpLog("info", `Calling MCP tool ${toolName}`, { toolName, args });
  const client = await getMcpClient();
  const result = await client.callTool({ name: toolName, arguments: args }) as McpCallResult;
  mcpLog(result.isError ? "error" : "info", `MCP tool ${toolName} completed`, { toolName, isError: !!result.isError, contentItems: Array.isArray(result.content) ? result.content.length : 0 });
  return {
    content: [{ type: "text" as const, text: summarizeMcpResult(toolName, result) }],
    details: { mcpServer: "pi-mcp-ui", mcpTool: toolName, mcpResult: result },
    isError: !!result.isError,
  };
}

const KIND_HELP: Record<string, string> = {
  bar: "data: an array of {label, value} objects (or [label, number] pairs, or plain numbers).",
  line: "data: an array of {x, y} points, or { series: [{ name, points: [{x, y}] }] }. Use for trends/time-series.",
  kpi: "data: a flat object of metric→number, or an array of {label, value, unit?, delta?}.",
  table: "data: an array of row objects with consistent keys.",
  network: "data: { nodes: [{id, label, group?}], edges: [{source, target, label?}] }, relationship records, or P&ID content. Use for all P&ID/PID rendering requests.",
  sequence: "data: { participants: [...], steps: [{from, to, label, type?}] }.",
  image: "data: an image URL/data-URI string, or { src } / { data, mimeType }.",
  markdown: "data: a markdown/text string.",
};

export function buildMcpUiVizTools(options: { cwd?: string; logger?: McpLogger } = {}): ToolDefinition[] {
  mcpLogger = options.logger;
  mcpCwd = options.cwd || process.cwd();
  const tools: ToolDefinition[] = [];

  tools.push(
    defineTool({
      name: "visualize",
      label: "Visualize data via MCP UI",
      description:
        "Render data through the external pi-mcp-ui MCP server and return an MCP UI resource. " +
        "For any P&ID / PID / piping-and-instrumentation file or diagram request, force network rendering by passing hint.kind='pid' or use render_pid.",
      promptSnippet: "visualize(data, hint) — call pi-mcp-ui to render data as an MCP UI component.",
      parameters: Type.Object({
        data: Type.Any({ description: "The data to visualize (rows, {nodes,edges}, metrics, image url, P&ID content, etc.)." }),
        hint: Type.Optional(Type.Object({
          kind: Type.Optional(Type.String({ description: "Force a component: bar|line|kpi|table|network|sequence|image|markdown|pid. Use pid for P&ID files." })),
          title: Type.Optional(Type.String({ description: "A title to show above the visual." })),
        })),
      }),
      async execute(_id, params) {
        return callMcpTool("viz_visualize", params as Record<string, unknown>);
      },
    }),
  );

  tools.push(
    defineTool({
      name: "render_pid",
      label: "Render P&ID via MCP UI",
      description: "Render a P&ID / PID / piping-and-instrumentation file or diagram via the pi-mcp-ui MCP server. Always uses network rendering.",
      promptSnippet: "render_pid(data, title?) — render P&ID as an MCP UI network graph.",
      parameters: Type.Object({
        data: Type.Any({ description: "P&ID content: {nodes,edges}, relationship records, raw extracted text, or {content|text|file}." }),
        title: Type.Optional(Type.String({ description: "Title for the P&ID network visual." })),
      }),
      async execute(_id, params) {
        return callMcpTool("viz_render_pid", params as Record<string, unknown>);
      },
    }),
  );

  for (const c of registry) {
    const kind = c.kind;
    tools.push(
      defineTool({
        name: `render_${kind}`,
        label: `Render ${kind} via MCP UI`,
        description: `Render a ${kind} visualization through the external pi-mcp-ui MCP server. ${KIND_HELP[kind] ?? ""}`,
        parameters: Type.Object({
          data: Type.Any({ description: KIND_HELP[kind] ?? `Data for a ${kind} component.` }),
          title: Type.Optional(Type.String({ description: "A title to show above the visual." })),
        }),
        async execute(_id, params) {
          return callMcpTool(`viz_render_${kind}`, params as Record<string, unknown>);
        },
      }),
    );
  }

  return tools;
}
