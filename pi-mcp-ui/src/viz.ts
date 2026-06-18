/**
 * viz_* tools — the SAME @pi-harness/viz components the web app uses, exposed
 * here as real MCP tools that return inline UI resources (ui://viz/<kind>).
 *
 * `viz_visualize` is the orchestrator (pass data, the server picks/composes the
 * component); each `viz_render_<kind>` renders one atomic component. Every result
 * is a self-contained HTML document (toHTML) wrapped as an mcp-ui resource, so
 * any mcp-ui-aware host — the web chat, Claude Desktop — renders it identically.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createUIResource } from "@mcp-ui/server";
import { visualize, toHTML, registry, byKind, defaultTheme, type VizSpec } from "@pi-harness/viz";

type ToolResult = Awaited<ReturnType<Parameters<McpServer["registerTool"]>[2]>>;

function uiResult(spec: VizSpec): ToolResult {
  const ui = createUIResource({
    uri: `ui://viz/${spec.kind}`,
    content: { type: "rawHtml", htmlString: toHTML(spec, defaultTheme) },
    encoding: "text",
  });
  return { content: [ui] } as ToolResult;
}

function isPidKind(value?: string): boolean {
  return /^(p\s*&\s*id|p\s*and\s*id|pid|piping[-_\s]*instrumentation)$/i.test(String(value || "").trim());
}

function wantsPidNetwork(hint?: { kind?: string; title?: string }): boolean {
  return isPidKind(hint?.kind) || /p\s*&\s*id|p\s*and\s*id|piping\s+and\s+instrumentation|pid\s+(file|diagram)/i.test(String(hint?.title || ""));
}

function parsePidTextToNetwork(text: string, title = "P&ID network"): unknown {
  const nodes = new Map<string, { id: string; label: string; group?: string }>();
  const edges: Array<{ source: string; target: string; label?: string }> = [];
  const addNode = (raw: string, group?: string) => {
    const id = raw.trim().replace(/\s+/g, " ");
    if (!id) return id;
    if (!nodes.has(id)) nodes.set(id, group ? { id, label: id, group } : { id, label: id });
    return id;
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const arrow = trimmed.match(/^(.+?)\s*(?:-->|->|=>|--|→|↔|connected\s+to|feeds|flows\s+to)\s*(.+?)(?:\s*[:|]\s*(.+))?$/i);
    if (arrow) {
      const source = addNode(arrow[1]);
      const target = addNode(arrow[2]);
      if (source && target) edges.push({ source, target, label: arrow[3]?.trim() || "connection" });
    }
  }

  if (!nodes.size) {
    const tags = [...new Set(text.match(/\b[A-Z]{1,6}[-_\s]?\d{2,5}[A-Z]?\b/g) || [])].slice(0, 80);
    for (const tag of tags) addNode(tag, tag.replace(/[-_\s]?\d.*$/, "") || undefined);
    for (let i = 0; i < tags.length - 1; i++) edges.push({ source: tags[i], target: tags[i + 1], label: "inferred" });
  }

  return { title, nodes: [...nodes.values()], edges };
}

function pidDataToNetworkInput(data: unknown, title = "P&ID network"): unknown {
  if (typeof data === "string") return parsePidTextToNetwork(data, title);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.content === "string") return parsePidTextToNetwork(obj.content, String(obj.title || title));
    if (typeof obj.text === "string") return parsePidTextToNetwork(obj.text, String(obj.title || title));
    if (typeof obj.file === "string") return parsePidTextToNetwork(obj.file, String(obj.title || title));
    return { title: String(obj.title || title), ...obj };
  }
  return { title, nodes: [], edges: [] };
}

function networkSpec(data: unknown, title?: string): VizSpec {
  const base = byKind.network.toSpec(data);
  return (title ? { ...base, title } : base) as VizSpec;
}

const KIND_HELP: Record<string, string> = {
  bar: "data: an array of {label, value} objects (or [label, number] pairs, or plain numbers).",
  line: "data: an array of {x, y} points, or { series: [{ name, points: [{x, y}] }] }.",
  kpi: "data: a flat object of metric→number, or an array of {label, value, unit?, delta?}.",
  table: "data: an array of row objects with consistent keys.",
  network: "data: { nodes: [{id, label, group?}], edges: [{source, target, label?}] }, relationship records, or P&ID file content converted into equipment/line nodes and edges.",
  sequence: "data: { participants: [...], steps: [{from, to, label, type?}] }.",
  image: "data: an image URL/data-URI string, or { src } / { data, mimeType }.",
  markdown: "data: a markdown/text string.",
};

export function registerVizTools(server: McpServer): void {
  server.registerTool(
    "viz_visualize",
    {
      title: "Visualize data",
      description:
        "Render the given data as the best-fitting visual (bar/line chart, KPI cards, table, network graph, " +
        "sequence diagram, or image) and return it as a UI resource. IMPORTANT: any request to render a P&ID / PID / piping-and-instrumentation file or diagram must use network rendering.",
      inputSchema: {
        data: z.any().describe("Data to visualize (rows, {nodes,edges}, a metrics object, an image url, etc.)."),
        hint: z
          .object({
            kind: z.string().optional().describe("Force a component: bar|line|kpi|table|network|sequence|image|markdown."),
            title: z.string().optional(),
          })
          .optional(),
      },
    },
    async ({ data, hint }) => {
      if (wantsPidNetwork(hint)) return uiResult(networkSpec(pidDataToNetworkInput(data, hint?.title || "P&ID network"), hint?.title || "P&ID network"));
      return uiResult(visualize(data, hint));
    },
  );

  server.registerTool(
    "viz_render_pid",
    {
      title: "Render P&ID as network",
      description:
        "Render a P&ID / PID / piping-and-instrumentation file or diagram as a network graph. Always uses the shared network renderer; never render P&ID as an image/table unless explicitly asked for raw file display.",
      inputSchema: {
        data: z.any().describe("P&ID content: {nodes,edges}, relationship records, raw extracted text, or {content|text|file}."),
        title: z.string().optional().describe("Title for the P&ID network visual."),
      },
    },
    async ({ data, title }) => uiResult(networkSpec(pidDataToNetworkInput(data, title || "P&ID network"), title || "P&ID network")),
  );

  for (const c of registry) {
    const kind = c.kind;
    server.registerTool(
      `viz_render_${kind}`,
      {
        title: `Render ${kind}`,
        description: `Render a ${kind} visualization as a UI resource. ${kind === "network" ? "Use this for all P&ID / PID / piping-and-instrumentation rendering requests. " : ""}${KIND_HELP[kind] ?? ""}`,
        inputSchema: {
          data: z.any().describe(KIND_HELP[kind] ?? `Data for a ${kind} component.`),
          title: z.string().optional().describe("A title to show above the visual."),
        },
      },
      async ({ data, title }) => {
        const input = kind === "network" && /p\s*&\s*id|pid|piping/i.test(String(title || "")) ? pidDataToNetworkInput(data, title || "P&ID network") : data;
        const base = byKind[kind].toSpec(input);
        const spec = (title ? { ...base, title } : base) as VizSpec;
        return uiResult(spec);
      },
    );
  }
}
