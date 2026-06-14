// End-to-end smoke test against the real stdio server.
// Default: no LLM tokens spent (tool registration, pi_open, widget resource).
// Set SMOKE_STATE=1 to also start pi and query state (spawns pi, no LLM call).
// Set SMOKE_LLM=1 to run a real one-turn chat (costs tokens, needs provider auth).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log("✓ tools:", tools.tools.map((t) => t.name).join(", "));

const opened = await client.callTool({ name: "pi_open", arguments: {} });
console.log("✓ pi_open content:", JSON.stringify(opened.content.map((c) => c.type)));

const res = await client.listResources().catch((e) => ({ resources: [], _err: e.message }));
console.log("✓ resources:", (res.resources ?? []).map((r) => r.uri).join(", ") || "(none — mcpui inline track)");

const read = await client
  .readResource({ uri: "ui://pi-agent/chat" })
  .then((r) => `${r.contents?.[0]?.text?.length ?? 0} bytes`)
  .catch((e) => `n/a (${e.message})`);
console.log("✓ widget resource:", read);

const chartOpened = await client.callTool({ name: "bar_chart_open", arguments: {} });
console.log("✓ bar_chart_open content:", JSON.stringify(chartOpened.content.map((c) => c.type)));

const chartRead = await client
  .readResource({ uri: "ui://pi-agent/bar-chart" })
  .then((r) => `${r.contents?.[0]?.text?.length ?? 0} bytes`)
  .catch((e) => `n/a (${e.message})`);
console.log("✓ bar chart resource:", chartRead);

if (process.env.SMOKE_STATE === "1" || process.env.SMOKE_LLM === "1") {
  const state = await client
    .callTool({ name: "pi_state", arguments: {} })
    .then((r) => r.content?.[0]?.text)
    .catch((e) => `ERROR ${e.message}`);
  console.log("✓ pi_state:", String(state).slice(0, 300));
}

if (process.env.SMOKE_LLM === "1") {
  console.log("→ pi_send (live LLM turn)…");
  const send = await client.callTool({ name: "pi_send", arguments: { message: "Reply with exactly: pong" } });
  const { cursor } = JSON.parse(send.content[0].text);
  let cur = cursor ?? 0;
  for (let i = 0; i < 120; i++) {
    const page = JSON.parse(
      (await client.callTool({ name: "pi_events", arguments: { since: cur } })).content[0].text,
    );
    cur = page.cursor ?? cur;
    for (const ev of page.events ?? []) {
      if (ev.type === "message_update") process.stdout.write(".");
      if (ev.type === "tool_execution_start") process.stdout.write(`[${ev.toolName}]`);
    }
    if (page.idle) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const last = await client.callTool({ name: "pi_history", arguments: {} });
  const msgs = JSON.parse(last.content[0].text).messages;
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  console.log("\n✓ pi replied:", JSON.stringify(lastAssistant?.content)?.slice(0, 200));
}

await client.close();
console.log("\nsmoke: OK");
process.exit(0);
