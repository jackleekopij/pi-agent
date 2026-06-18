/**
 * VizSpec — the normalized, declarative contract every visualization renders
 * against. The orchestrator maps loose input data into one of these; renderers
 * turn a VizSpec into a self-contained HTML/SVG fragment. This union is the
 * single source of truth shared by the web app and the MCP-UI server.
 */
export type VizSpec =
  | { kind: "bar"; title?: string; series: BarDatum[] }
  | { kind: "line"; title?: string; series: LineSeries[] }
  | { kind: "pie"; title?: string; slices: BarDatum[] }
  | { kind: "kpi"; title?: string; items: KpiItem[] }
  | { kind: "table"; title?: string; columns: TableColumn[]; rows: Record<string, unknown>[] }
  | { kind: "network"; title?: string; nodes: NetworkNode[]; edges: NetworkEdge[]; layout?: "circle" }
  | { kind: "sequence"; title?: string; participants: SeqParticipant[]; steps: SeqStep[] }
  | { kind: "image"; title?: string; src: string; alt?: string; caption?: string }
  | { kind: "markdown"; title?: string; text: string }
  | { kind: "dashboard"; title?: string; layout: "grid" | "stack"; items: VizSpec[] };

export type VizKind = Exclude<VizSpec["kind"], "dashboard">;

export interface BarDatum { label: string; value: number; color?: string }
export interface LineSeries { name: string; points: { x: string | number; y: number }[] }
export interface KpiItem { label: string; value: string | number; unit?: string; delta?: number }
export interface TableColumn { key: string; label: string; align?: "left" | "right" }
export interface NetworkNode { id: string; label: string; group?: string }
export interface NetworkEdge { source: string; target: string; label?: string }
export interface SeqParticipant { id: string; label: string }
export interface SeqStep { from: string; to: string; label: string; type?: "call" | "return" | "response" | "error" }

export interface Theme {
  text: string;
  bg: string;
  muted: string;
  border: string;
  navy: string;
  red: string;
  lightGrey: string;
  midBlue: string;
  lightBlue: string;
  purple: string;
  orange: string;
  green: string;
  palette: string[];
}

/**
 * One atomic component. `match` scores how well the loose input fits this
 * component (drives orchestration); `toSpec` normalizes input into a spec;
 * `toFragment` renders a self-contained fragment (data values escaped) suitable
 * for direct DOM insertion or wrapping in a full HTML document.
 */
export interface VizComponent<S extends VizSpec = VizSpec> {
  kind: S["kind"];
  /** 0 = no match; higher = stronger fit. */
  match(data: unknown): number;
  toSpec(input: unknown): S;
  toFragment(spec: S, theme: Theme): string;
}
