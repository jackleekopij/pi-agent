/**
 * Viz tools registered in-process on the pi session.
 *
 * The agent gets `visualize` (the orchestrator — pass data, the server picks and
 * composes the right component) plus one `render_<kind>` tool per atomic
 * component. Each tool returns:
 *   - content:  a short text summary (what the model sees — kept lean)
 *   - details:  { viz: [{ spec, html }] }  (NOT sent to the model; the web server
 *               forwards it to the browser, which renders `html` in a sandboxed
 *               iframe — interactive HTML, not a static SVG)
 *
 * Rendering is the shared @pi-harness/viz library, so the web app and the
 * MCP-UI server stay pixel-identical.
 */
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visualize, toHTML, byKind, registry, defaultTheme, type VizSpec } from "@pi-harness/viz";

export interface VizItem {
  spec: VizSpec;
  /** Self-contained interactive HTML document (rendered in an iframe). */
  html: string;
}

/** Orchestrate loose data into rendered viz items (spec + interactive html).
 *  Shared by the `visualize` tool and the server's no-LLM demo path. */
export function renderData(data: unknown, hint?: { kind?: string; title?: string }): VizItem[] {
  const spec = visualize(data, hint);
  return [{ spec, html: toHTML(spec, defaultTheme) }];
}

/** Names the host may execute directly on a widget's behalf — pure, side-effect
 *  free renderers. Anything else from a widget must NOT be auto-run. */
export function isHostExecutableViz(name: string): boolean {
  if (name === "visualize" || name === "viz_visualize") return true;
  const m = /^(?:viz_)?render_(.+)$/.exec(name);
  return !!(m && byKind[m[1]]);
}

/** Execute an allowlisted viz tool by name (used for widget tool actions and the
 *  fenced-block path) without going through the model. Throws on unknown names. */
export function runVizTool(name: string, params: Record<string, unknown> = {}): VizItem[] {
  const data = "data" in params ? params.data : params;
  const hint = (params.hint as { kind?: string; title?: string } | undefined) ?? (params.title ? { title: String(params.title) } : undefined);
  if (name === "visualize" || name === "viz_visualize") return renderData(data, hint);
  const m = /^(?:viz_)?render_(.+)$/.exec(name);
  if (m && byKind[m[1]]) {
    const base = byKind[m[1]].toSpec(data);
    const spec = (params.title ? { ...base, title: String(params.title) } : base) as VizSpec;
    return [{ spec, html: toHTML(spec, defaultTheme) }];
  }
  throw new Error(`Not a host-executable viz tool: ${name}`);
}

function vizResult(spec: VizSpec) {
  return { content: [{ type: "text" as const, text: summarize(spec) }], details: { viz: [{ spec, html: toHTML(spec, defaultTheme) }] } };
}

function summarize(spec: VizSpec): string {
  const title = "title" in spec && spec.title ? ` "${spec.title}"` : "";
  switch (spec.kind) {
    case "bar":
      return `Rendered a bar chart${title} with ${spec.series.length} bars.`;
    case "line":
      return `Rendered a line chart${title} with ${spec.series.length} series.`;
    case "pie":
      return `Rendered a pie chart${title} with ${spec.slices.length} slices.`;
    case "kpi":
      return `Rendered ${spec.items.length} KPI card(s)${title}.`;
    case "table":
      return `Rendered a table${title}: ${spec.rows.length} rows × ${spec.columns.length} columns.`;
    case "network":
      return `Rendered a network graph${title}: ${spec.nodes.length} nodes, ${spec.edges.length} edges.`;
    case "sequence":
      return `Rendered a sequence diagram${title}: ${spec.participants.length} participants, ${spec.steps.length} steps.`;
    case "image":
      return `Rendered an image${title}.`;
    case "markdown":
      return `Rendered text${title}.`;
    case "dashboard":
      return `Rendered a dashboard${title} composed of ${spec.items.length} components (${spec.items.map((i) => i.kind).join(", ")}).`;
  }
}

const KIND_HELP: Record<string, string> = {
  bar: "data: an array of {label, value} objects (or [label, number] pairs, or plain numbers).",
  line: "data: an array of {x, y} points, or { series: [{ name, points: [{x, y}] }] }. Use for trends/time-series.",
  kpi: "data: a flat object of metric→number, or an array of {label, value, unit?, delta?}.",
  table: "data: an array of row objects with consistent keys.",
  network: "data: { nodes: [{id, label, group?}], edges: [{source, target, label?}] }, or relationship records.",
  sequence: "data: { participants: [...], steps: [{from, to, label, type?}] }.",
  image: "data: an image URL/data-URI string, or { src } / { data, mimeType }.",
  markdown: "data: a markdown/text string.",
};

export function buildVizTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  tools.push(
    defineTool({
      name: "visualize",
      label: "Visualize data",
      description:
        "Render the given data as the best-fitting visual (bar/line chart, KPI cards, table, network graph, sequence diagram, or image). " +
        "Pass the raw data and the server picks — and when useful composes — the right component(s). Prefer this when you have data to show the user.",
      promptSnippet: "visualize(data) — render data as a chart/table/graph/etc.",
      parameters: Type.Object({
        data: Type.Any({ description: "The data to visualize (array of rows, {nodes,edges}, a metrics object, an image url, etc.)." }),
        hint: Type.Optional(
          Type.Object({
            kind: Type.Optional(Type.String({ description: "Force a component: bar|line|kpi|table|network|sequence|image|markdown." })),
            title: Type.Optional(Type.String({ description: "A title to show above the visual." })),
          }),
        ),
      }),
      async execute(_id, params) {
        return vizResult(visualize(params.data, params.hint));
      },
    }),
  );

  for (const c of registry) {
    const kind = c.kind;
    tools.push(
      defineTool({
        name: `render_${kind}`,
        label: `Render ${kind}`,
        description: `Render a ${kind} visualization. ${KIND_HELP[kind] ?? ""}`,
        parameters: Type.Object({
          data: Type.Any({ description: KIND_HELP[kind] ?? `Data for a ${kind} component.` }),
          title: Type.Optional(Type.String({ description: "A title to show above the visual." })),
        }),
        async execute(_id, params) {
          const base = byKind[kind].toSpec(params.data);
          const spec = (params.title ? { ...base, title: params.title } : base) as VizSpec;
          return vizResult(spec);
        },
      }),
    );
  }

  return tools;
}
