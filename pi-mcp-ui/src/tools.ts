/**
 * The pi_* data tools the chat widget drives over the MCP Apps bridge
 * (app.callServerTool). Each returns its payload as JSON in a text content
 * block; the widget JSON.parses content[0].text.
 *
 * pi_open (which returns the UI resource itself) lives in ui.ts because it is
 * track-specific (apps vs mcpui).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PiBridge } from "./pi-bridge.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(err: unknown, bridge: PiBridge): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, stderr: bridge.stderr() }) }],
    isError: true,
  };
}

async function guard(bridge: PiBridge, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err, bridge);
  }
}

/**
 * Register the pi_* data tools on an MCP server. Shared by the stdio server
 * (Claude Desktop) and the HTTP server (dev page) — same handlers, same bridge.
 */
export function registerPiTools(server: McpServer, bridge: PiBridge): void {
  server.registerTool(
    "pi_send",
    {
      title: "Send a message to pi",
      description:
        "Send a user message to the pi agent. Returns immediately with a cursor; " +
        "poll pi_events({ since: cursor }) to stream the response.",
      inputSchema: { message: z.string().describe("The user message to send to pi") },
    },
    async ({ message }) => guard(bridge, async () => ok(await bridge.prompt(message))),
  );

  server.registerTool(
    "pi_events",
    {
      title: "Poll pi events",
      description:
        "Return buffered agent events with seq > since (text/thinking deltas, tool " +
        "executions, agent_end). Response includes { events, cursor, idle }; keep " +
        "polling with the returned cursor while idle is false.",
      inputSchema: {
        since: z.number().int().nonnegative().default(0).describe("Last seq already seen"),
      },
    },
    async ({ since }) => guard(bridge, async () => ok(bridge.eventsSince(since))),
  );

  server.registerTool(
    "pi_steer",
    {
      title: "Steer the running agent",
      description: "Queue a steering message to redirect pi while it is mid-run.",
      inputSchema: { message: z.string().describe("Steering instruction") },
    },
    async ({ message }) =>
      guard(bridge, async () => {
        await bridge.steer(message);
        return ok({ ok: true });
      }),
  );

  server.registerTool(
    "pi_abort",
    {
      title: "Abort the current turn",
      description: "Abort pi's current operation.",
      inputSchema: {},
    },
    async () =>
      guard(bridge, async () => {
        await bridge.abort();
        return ok({ ok: true });
      }),
  );

  server.registerTool(
    "pi_state",
    {
      title: "Get pi session state",
      description: "Return pi's current session state (model, streaming status, counts).",
      inputSchema: {},
    },
    async () => guard(bridge, async () => ok(await bridge.state())),
  );

  server.registerTool(
    "pi_history",
    {
      title: "Get conversation history",
      description: "Return all messages in pi's current session for initial render.",
      inputSchema: {},
    },
    async () => guard(bridge, async () => ok({ messages: await bridge.history() })),
  );

  server.registerTool(
    "pi_models",
    {
      title: "List available models",
      description: "List the models configured for pi (for the model picker).",
      inputSchema: {},
    },
    async () => guard(bridge, async () => ok({ models: await bridge.models() })),
  );

  server.registerTool(
    "pi_set_model",
    {
      title: "Set the active model",
      description: "Switch pi to a specific provider/model.",
      inputSchema: {
        provider: z.string().describe("Provider name, e.g. anthropic"),
        modelId: z.string().describe("Model id, e.g. claude-opus-4-5"),
      },
    },
    async ({ provider, modelId }) =>
      guard(bridge, async () => ok(await bridge.setModel(provider, modelId))),
  );
}
