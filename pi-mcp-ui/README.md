# pi-mcp-ui

An **MCP UI server** that wraps the [`pi`](https://github.com/earendil-works/pi) coding agent
in an interactive **chat GUI**. Instead of returning plain text, the server returns a live HTML
widget that the host (Claude Desktop, or the bundled dev page) renders in a sandboxed iframe; the
widget talks back over the **MCP Apps** protocol to drive the real pi agent.

This is the pattern from:
- *MCP UI: Extending the frontier* — Liad Yosef & Ido Salomon
- *Building Interactive UIs in VS Code with MCP Apps* — GitHub
- *The New Web: How MCP Apps Put Live UI Inside ChatGPT & Claude*

The modern stack has converged on **MCP Apps (SEP-1865)**, so this project is built on the official
[`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps)
extension, and also ships the [`@mcp-ui/server`](https://mcpui.dev) SDK path as a second delivery track.

## How it works

```
HOST (Claude Desktop  |  dev page)
  │  1. calls tool  pi_open
  ▼
pi-mcp-ui  (this MCP server)
  │  pi_open → ui://pi-agent/chat   (self-contained HTML widget)
  │  PiBridge ── RpcClient ── spawns `pi --mode rpc`
  ▼
HOST renders the widget in a sandboxed iframe
  │  2. you type → widget calls pi_send  (app.callServerTool over JSON-RPC postMessage)
  ▼
HOST forwards the tool call back to pi-mcp-ui
  │  3. PiBridge.prompt() → pi   |   pi streams AgentEvents → cursor'd ring buffer
  ▼
widget polls pi_events({ since }) → renders text + tool cards → stops at agent_end
```

- **`src/pi-bridge.ts`** — wraps pi's exported `RpcClient`, turning its push event stream into a
  pollable, cursor'd buffer (MCP tools are request/response, so the widget polls).
- **`src/widget/`** — the chat GUI; uses the official `@modelcontextprotocol/ext-apps` **guest** API
  (`App.callServerTool`). Bundled + inlined into one self-contained HTML string by
  `scripts/build-widget.mjs`.
- **`src/tools.ts`** — the `pi_*` tools the widget drives.
- **`src/ui.ts`** — `pi_open` in both delivery tracks (see below).
- **`src/server.ts`** — `createPiServer()` + the stdio entrypoint for Claude Desktop.
- **`src/dev/`** — a standalone browser preview: a minimal MCP Apps **host** (`AppBridge` + a real
  MCP `Client` over StreamableHTTP) so you can iterate on the GUI without a desktop host.

## Prerequisites

- **pi** installed and configured (you have it: `pi --version`). The MCP server inherits your
  environment, so pi uses your existing provider auth (`~/.pi/agent`) / API-key env vars.
- **Node 20+** (developed on Node 26).

## Setup

```bash
cd ~/Projects/pi-mcp-ui
npm install
npm run build
cp .env.example .env   # then edit (esp. PI_CWD)
```

## Run the dev preview (fastest way to see it)

```bash
npm run dev            # builds widget + dev bundle, serves http://localhost:5174
```

Open **http://localhost:5174**. The page connects a real MCP client to the server, calls `pi_open`,
renders the widget, and bridges it to pi. Type a message and watch pi stream a response.

> The dev page drives the **same** server and widget as Claude Desktop — only the host differs.

## Use it in Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pi": {
      "command": "node",
      "args": ["/Users/jacklee-kopij/Projects/pi-mcp-ui/dist/server.js"],
      "env": {
        "PI_CWD": "/Users/jacklee-kopij/Projects/some-project",
        "PI_PROVIDER": "openai-codex",
        "PI_MODEL": "gpt-5.5",
        "PI_MCP_UI_TRACK": "apps"
      }
    }
  }
}
```

Restart Claude Desktop, then say **"open pi"** — the chat panel renders inline and drives the real
pi agent. (Omit `PI_PROVIDER`/`PI_MODEL` to use pi's configured default.)

## The two UI tracks (`PI_MCP_UI_TRACK`)

Both ship the **same** widget; only how `pi_open` delivers the resource differs.

| Track            | How `pi_open` delivers the widget                                              | SDK used                              |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| `apps` (default) | Predeclared `ui://pi-agent/chat` resource + tool `_meta.ui.resourceUri`         | `@modelcontextprotocol/ext-apps`      |
| `mcpui`          | Inline embedded UI resource returned in the tool result (`createUIResource`)    | `@mcp-ui/server`                      |

`apps` is the native MCP Apps path and the recommended default for Claude Desktop. `mcpui`
demonstrates the mcp-ui server SDK; the widget speaks the MCP Apps guest protocol either way, so we
advertise the `text/html;profile=mcp-app` mime type and do **not** use mcp-ui's adapter (its injected
bridge would collide with the widget's own ext-apps bridge).

## Tools

| Tool           | Purpose                                                        |
| -------------- | ------------------------------------------------------------- |
| `pi_open`      | Open the chat GUI (returns the UI resource).                  |
| `pi_send`      | Send a user message; returns a cursor to poll from.          |
| `pi_events`    | Poll buffered agent events `{ events, cursor, idle }`.       |
| `pi_steer`     | Redirect pi mid-run.                                          |
| `pi_abort`     | Abort the current turn.                                       |
| `pi_state`     | Current session state (model, streaming, counts).            |
| `pi_history`   | All messages (initial render).                               |
| `pi_models`    | Available models (model picker).                             |
| `pi_set_model` | Switch provider/model.                                        |

## Verify

```bash
node scripts/smoke.mjs              # tools + pi_open + widget resource (no LLM)
SMOKE_STATE=1 node scripts/smoke.mjs  # also starts pi and reads live state (no LLM call)
SMOKE_LLM=1   node scripts/smoke.mjs  # real one-turn chat (costs tokens, needs provider auth)
```

## ⚠️ Security

`PI_CWD` runs pi as a **full coding agent** — read/bash/edit/write on that directory. The widget can
initiate those tool calls. The iframe is sandboxed and every call routes through the host, but set
`PI_CWD` to an intended project directory (never `/` or your home root), and treat the GUI as having
the same power as running `pi` in that directory yourself.
