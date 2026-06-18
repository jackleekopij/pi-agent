/**
 * Smoke test: exercise the orchestrator + renderers across representative data
 * shapes. No LLM, no network. Asserts the chosen kind and a non-empty fragment.
 *
 *   npm run smoke   (from packages/viz)
 */
import { visualize, toFragment, toHTML } from "./index.js";
import type { VizSpec } from "./index.js";

interface Case {
  name: string;
  data: unknown;
  hint?: { kind?: string; title?: string };
  expect: VizSpec["kind"];
}

const cases: Case[] = [
  { name: "bar from {label,value}", data: [{ label: "Q1", value: 120 }, { label: "Q2", value: 180 }], expect: "bar" },
  { name: "bar from {title,data}", data: { title: "Revenue", data: [{ label: "A", value: 5 }] }, expect: "bar" },
  { name: "line from temporal x", data: [{ x: "2024-01-01", y: 10 }, { x: "2024-02-01", y: 14 }], expect: "line" },
  { name: "line from series", data: { series: [{ name: "s1", points: [{ x: 1, y: 2 }, { x: 2, y: 5 }] }] }, expect: "line" },
  { name: "kpi from metrics object", data: { revenue: 120, cost: 80, margin: 40 }, expect: "kpi" },
  { name: "table from records (3+ cols)", data: [{ id: 1, name: "A", status: "ok" }, { id: 2, name: "B", status: "down" }], expect: "table" },
  { name: "network from nodes+edges", data: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ source: "a", target: "b", label: "X" }] }, expect: "network" },
  { name: "network from records", data: { records: [{ asset: { assetId: "w1", displayName: "Well 1" }, relationship: { name: "flows_to" }, connectsTo: { assetId: "m1", displayName: "Manifold" } }] }, expect: "network" },
  { name: "sequence", data: { participants: ["User", "API"], steps: [{ from: "User", to: "API", label: "login" }] }, expect: "sequence" },
  { name: "image url string", data: "https://example.com/chart.png", expect: "image" },
  { name: "image data uri", data: { data: "iVBORw0KG", mimeType: "image/png", caption: "fig 1" }, expect: "image" },
  { name: "markdown fallback", data: "Just some **text** with no structure.", expect: "markdown" },
  { name: "compose: chart + table (extra cols)", data: [{ label: "A", value: 5, region: "W" }, { label: "B", value: 9, region: "E" }], expect: "dashboard" },
  { name: "hint forces table", data: [{ label: "A", value: 5 }], hint: { kind: "table" }, expect: "table" },
  { name: "hint forces pie", data: [{ label: "A", value: 5 }, { label: "B", value: 3 }], hint: { kind: "pie" }, expect: "pie" },
  { name: "table from {columns, rows} (arrays)", data: { columns: ["id", "name"], rows: [[1, "A"], [2, "B"]] }, expect: "table" },
  { name: "JSON string is parsed", data: '[{"label":"A","value":1}]', expect: "bar" },
];

let pass = 0;
const failures: string[] = [];

for (const c of cases) {
  const spec = visualize(c.data, c.hint);
  const frag = toFragment(spec);
  const okKind = spec.kind === c.expect;
  const okFrag = typeof frag === "string" && frag.length > 0 && frag.includes("<");
  if (okKind && okFrag) {
    pass++;
    console.log(`  ✓ ${c.name}  →  ${spec.kind} (${frag.length} chars)`);
  } else {
    failures.push(`  ✗ ${c.name}  →  got kind=${spec.kind} (expected ${c.expect}), fragOk=${okFrag}`);
  }
}

// Interactivity: toHTML must be a self-contained interactive document.
const barHtml = toHTML(visualize([{ label: "A", value: 5 }, { label: "B", value: 9 }]));
const interactive =
  barHtml.includes("<script") && barHtml.includes("viz-tip") && barHtml.includes("data-tip") && barHtml.toLowerCase().includes("<!doctype");
if (interactive) { pass++; console.log("  ✓ toHTML is interactive (script + tooltip + data-tip)"); }
else failures.push("  ✗ toHTML missing interactivity (script/viz-tip/data-tip)");
const totalCases = cases.length + 1;

console.log(`\n${pass}/${totalCases} passed`);
if (failures.length) {
  console.error("\nFAILURES:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("All viz smoke cases passed.");
