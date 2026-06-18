/**
 * Integration smoke for the in-process viz tools — no LLM, no pi session.
 * Confirms the TypeBox schemas construct, the tools register, and each
 * execute() returns a model summary in `content` and a rendered fragment in
 * `details.viz`.
 *
 *   npm run viz:smoke -w pi-web-chat
 */
import { buildVizTools, renderData } from "../src/viz-tools.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("  ✗ " + msg);
    process.exitCode = 1;
  } else {
    console.log("  ✓ " + msg);
  }
}

const tools = buildVizTools();
console.log("Registered tools:", tools.map((t) => t.name).join(", "));
assert(tools.some((t) => t.name === "visualize"), "visualize tool present");
assert(tools.some((t) => t.name === "render_network"), "render_network tool present");
assert(tools.every((t) => t.parameters && typeof t.parameters === "object"), "every tool has a parameters schema");

const ctx = undefined as never; // execute ignores ctx here

const r1 = await tools.find((t) => t.name === "visualize")!.execute(
  "c1",
  { data: [{ label: "Q1", value: 120 }, { label: "Q2", value: 180, region: "W" }] } as never,
  undefined,
  undefined,
  ctx,
);
assert(r1.content?.[0]?.type === "text" && r1.content[0].text.length > 0, `visualize → content summary: ${(r1.content?.[0] as { text?: string })?.text}`);
const v1 = (r1 as { details?: { viz?: Array<{ html: string; spec: { kind: string } }> } }).details?.viz;
assert(!!v1?.[0]?.html?.includes("<script"), `visualize → interactive html rendered (kind=${v1?.[0]?.spec.kind})`);

const r2 = await tools.find((t) => t.name === "render_network")!.execute(
  "c2",
  { data: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ source: "a", target: "b", label: "X" }] }, title: "My net" } as never,
  undefined,
  undefined,
  ctx,
);
const v2 = (r2 as { details?: { viz?: Array<{ html: string; spec: { kind: string; title?: string } }> } }).details?.viz;
assert(v2?.[0]?.spec.kind === "network", "render_network → network spec");
assert(v2?.[0]?.spec.title === "My net", "render_network → title applied");
assert(!!v2?.[0]?.html?.includes("<svg"), "render_network → svg in html");

const items = renderData({ participants: ["U", "API"], steps: [{ from: "U", to: "API", label: "login" }] });
assert(items[0]?.spec.kind === "sequence", "renderData → sequence");

console.log(process.exitCode ? "\nviz-smoke FAILED" : "\nviz-smoke passed");
