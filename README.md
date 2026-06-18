# Pi Agent Harness

Process AI Harness workspace containing:

- `pi-web-chat` — browser chat UI on top of Pi agent core
- `pi-mcp-ui` — MCP UI server exposing Pi/MCP Apps widgets and visualization tools
- `packages/viz` — shared visualization renderers

## Prerequisites

- Node.js 20+
- npm
- Git

## Install Pi agent core

Pi agent core is provided by the `@earendil-works/pi-coding-agent` package.

Install the Pi CLI globally:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Alternative installer:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

Verify it is available:

```bash
pi --version
```

Authenticate Pi. For ChatGPT/Codex subscription auth, start Pi and login:

```bash
pi
/login
```

Then select your provider, e.g. OpenAI Codex / ChatGPT. Pi stores auth under your normal Pi config directory, and the web/MCP apps reuse that auth.

You can also use API keys, for example:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

## Install this workspace

Clone and install dependencies:

```bash
git clone git@github.com:jackleekopij/pi-agent.git
cd pi-agent
npm install
```

Build everything:

```bash
npm run build --workspaces
```

## Run the web chat

```bash
cd pi-web-chat
PI_WEB_CHAT_LOG_LEVEL=debug npm run dev
```

Open the printed URL, usually:

```text
http://localhost:8787
```

If that port is busy, the app auto-selects the next available port.

Useful options:

```bash
# choose working directory for Pi tools
PI_CHAT_CWD=~/Projects/my-repo npm run dev

# persist Pi sessions
PI_CHAT_PERSIST=1 npm run dev

# point the web chat MCP bridge to a specific MCP UI server build
PI_MCP_UI_SERVER=~/Projects/pi-agent/pi-mcp-ui/dist/server.js npm run dev
```

Logs are written to:

```text
pi-web-chat/.pi-web-chat-debug/server.log
```

## Run the MCP UI server

Build first:

```bash
cd pi-mcp-ui
npm run build
```

Run over stdio, as an MCP host would:

```bash
npm run start
```

Inspect with the MCP inspector:

```bash
npm run inspect
```

Run the browser dev host:

```bash
npm run dev
```

Then open:

```text
http://localhost:5174
```

## Claude Desktop MCP config example

After building `pi-mcp-ui`, add this to Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "pi-mcp-ui": {
      "command": "node",
      "args": ["/absolute/path/to/pi-agent/pi-mcp-ui/dist/server.js"],
      "env": {
        "PI_MCP_UI_TRACK": "apps"
      }
    }
  }
}
```

Restart Claude Desktop, then ask it to open Pi or use the `viz_*` tools.

## Notes

- The web chat uses the Pi SDK and your existing Pi auth.
- Visualization tools in the web chat are bridged through the `pi-mcp-ui` MCP server.
- P&ID / PID rendering requests are routed to network rendering via `viz_render_pid` / `render_pid`.
- Runtime files such as uploads, logs, and assessment records are ignored by Git.
