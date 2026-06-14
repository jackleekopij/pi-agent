# Pi Web Chat

A small browser chat UI that talks directly to pi-agent core through the `@earendil-works/pi-coding-agent` SDK.

## Run

```bash
cd ~/Projects/pi-web-chat
npm run dev
```

Open http://localhost:8787.

## Options

```bash
# Use a different port
PORT=3000 npm run dev

# Make Pi tools operate in a specific working directory
PI_CHAT_CWD=~/Projects/my-repo npm run dev

# Persist sessions under ~/.pi/agent/sessions instead of in-memory sessions
PI_CHAT_PERSIST=1 npm run dev
```

The app uses your normal Pi auth at `~/.pi/agent/auth.json` and your default Pi model/settings.

## Features

- Streaming assistant responses
- Browser-local chat window history via `localStorage`
- Fixed-height visual cards/iframes so charts and MCP UI frames do not compress while text streams
- Woodside theme palette: navy `#003369`, grey `#4D4D4F`, red `#D71638`, plus blue ramp `#0071BC` → `#00AEEF`
- Tool call status panel
- Abort button
- New session button, which clears the browser-local history
- Uses the Pi SDK directly, no subprocess/RPC bridge
- MCP UI resource rendering for tool results that contain `ui://` resources
  - `text/html` / `text/html;profile=mcp-app` renders in a sandboxed iframe
  - `text/uri-list` renders the first HTTP(S) URL in a sandboxed iframe
  - UI actions from components are handled via `postMessage` (`prompt`, `tool`, `intent`, `notify`, `link`)

## MCP UI test

Type this in the web chat:

```text
/demo-ui
```

That renders a local demo MCP UI component and verifies host action handling.

## Visualization tests

```text
/demo-chart
/demo-network
/demo-network-records
/demo-network-interactive
/demo-sequence
```

The chat also auto-renders fenced JSON visualization blocks from assistant replies or your own input:

```chart-json
{"title":"Revenue","data":[{"label":"Q1","value":120},{"label":"Q2","value":180}]}
```

```network-json
{"title":"Graph DB result","nodes":[{"id":"a","label":"Asset A"},{"id":"b","label":"Asset B"}],"edges":[{"source":"a","target":"b","label":"CONNECTED_TO"}]}
```

```sequence-json
{"title":"Login flow","participants":["User","Web App","API","Database"],"steps":[{"from":"User","to":"Web App","label":"Submit login"},{"from":"Web App","to":"API","label":"POST /login"},{"from":"API","to":"Database","label":"Find user"},{"from":"Database","to":"API","label":"User record","type":"return"},{"from":"API","to":"Web App","label":"JWT token","type":"return"}]}
```

Alternative record-oriented network data is also supported:

```network-json
{"title":"Graph DB records","records":[{"asset":{"assetId":"a","displayName":"Asset A","class":"source"},"relationship":{"name":"CONNECTED_TO"},"connectsTo":{"assetId":"b","displayName":"Asset B","class":"target"}}]}
```

MCP UI components can also `postMessage` host actions with `type: "chart"`, `type: "network"`, or `type: "sequence"` and a compatible payload.

For a draggable iframe/SVG network component, run:

```text
/demo-network-interactive
```

You can drag nodes, double-click nodes to notify the host, and send the selected node back to Pi.
