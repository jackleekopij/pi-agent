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

- Send ChatGPT 5.5 / Pi any file type via the paperclip or drag-and-drop
  - Text/code files are included in the prompt, truncated at 200 KB
  - Images are sent as model image inputs and also saved server-side
  - Binary/non-text files are saved under `.pi-web-chat-uploads/` and the saved path is sent to the model for tool inspection
  - Per-file upload limit: 50 MB
- Revit API 2026 documentation tools for ChatGPT 5.5/Pi:
  - `revit_api_search` searches classes, methods, properties, namespaces, etc.
  - `revit_api_doc` fetches a specific Revit API doc page by href/URL
  - `revit_api_lookup` searches and reads the top matching pages in one step
- Streaming assistant responses with **markdown** rendering (code blocks + copy) and a collapsible **thinking** panel
- **One conversation per browser tab** — opening a new tab starts a fresh chat; reloading a tab resumes it. The left panel lists **every conversation as a single entry** (newest first); click to open one, **New** starts another. Stored in `localStorage`.
- **Meaningful-messages view** (ChatGPT/Claude-style): the window shows user/assistant text and visual results; tool calls appear as compact, collapsed chips (full activity stays in the Activity stream panel)
- **Interactive chart rendering** — every chart/graph/table is returned as a self-contained interactive HTML document in a sandboxed, auto-resizing iframe (hover tooltips + highlight), not a static SVG
- Woodside theme palette: navy `#003369`, grey `#4D4D4F`, red `#D71638`, plus blue ramp `#0071BC` → `#00AEEF`
- Abort button
- Uses the Pi SDK directly, no subprocess/RPC bridge
- MCP UI resource rendering for tool results that contain `ui://` resources
  - `text/html` / `text/html;profile=mcp-app` renders in a sandboxed iframe
  - `text/uri-list` renders the first HTTP(S) URL in a sandboxed iframe
  - UI actions from components are handled via `postMessage` (`prompt`, `tool`, `intent`, `notify`, `link`); `tool` actions for viz tools render directly

## Visualizing data (the viz tools)

Pi has in-process **viz tools** backed by the shared [`@pi-harness/viz`](../packages/viz) library:

- **`visualize(data, hint?)`** — the orchestrator. Pass raw data; it scores each component against the shape and renders the best one, composing a chart + table when rows carry extra columns.
- **`render_<kind>`** — render a specific component: `bar`, `line`, `pie`, `kpi`, `table`, `network`, `sequence`, `image`, `markdown`.

The tool returns a short text summary to the model and the rendered fragment via the result's `details` (kept out of the model's context); the server forwards it as a `viz` message and the browser drops it into a card. The orchestrator understands common shapes — `{label,value}` arrays, `{x,y}`/time series, metric objects, `{nodes,edges}`/relationship records, `participants`+`steps`, image URLs, and SQL-style `{columns, rows}`.

Try it without spending tokens:

```text
/demo-visualize      # routes sample data through the real orchestrator
```

MCP UI components may also drive these tools directly: a widget that posts a `tool` action for `visualize` / `render_*` is executed by the host and rendered — no model round-trip. (Requests for any other tool are not auto-run.)

## Assessment (interactive questions)

Pi can pose **interactive questions** in the chat — multiple-choice or short-answer — that you answer in a UI component; every answer is then **marked and saved**.

- **`ask_question`** — the model renders an MCQ / short-answer card. The correct answer / rubric it passes stays **server-side** (never sent to the browser).
- You select / type and **Submit**.
- **Every answer is saved deterministically** on submit to `.pi-web-chat-assessment/answers.json` (+ an append-only `events.jsonl`) — saving does *not* depend on the model. MCQ is auto-marked instantly when the correct option is known.
- The answer is then handed to the model, which grades it and calls **`mark_answer`** (correct / score / feedback) — shown on the card and saved onto the record.
- **`list_answers`** lets the model review everything and compute a score.

Storage lives under the working directory in `.pi-web-chat-assessment/`:
`questions.json`, `answers.json` (all submissions), `events.jsonl` (audit trail).

See [`docs/SKILL-assessment.md`](../docs/SKILL-assessment.md) for the full agent protocol, schema, and how to drive a reproducible quiz from a question bank ([`docs/sample-questions.json`](../docs/sample-questions.json)).

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
