const messages = document.getElementById("messages");
const meta = document.getElementById("meta");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const tools = document.getElementById("tools");
const sendButton = document.getElementById("send");
const abortButton = document.getElementById("abort");
const newSessionButton = document.getElementById("newSession");
const historyList = document.getElementById("historyList");
const activity = document.getElementById("activity");

let ws;
let currentAssistant;
let status = "connecting";
const toolRows = new Map();
const toolCards = new Map();
const HISTORY_KEY = "pi-web-chat-history-v1";
let saveTimer;
let messageCounter = 0;
let lastThinkingActivity = 0;

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.addEventListener("open", () => { setMeta("Connected. Starting Pi…"); addActivity("Connected to Pi server"); });
  ws.addEventListener("close", () => {
    setMeta("Disconnected. Reconnecting…");
    addActivity("Disconnected. Reconnecting…", "error");
    addMessage("system", "Connection closed. Reconnecting…");
    setTimeout(connect, 1000);
  });
  ws.addEventListener("error", () => addMessage("error", "WebSocket error"));
  ws.addEventListener("message", (event) => handleServerMessage(JSON.parse(event.data)));
}

function setMeta(text) { meta.textContent = text; }
function scrollDown() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
    document.scrollingElement?.scrollTo?.(0, document.scrollingElement.scrollHeight);
  });
}

function addActivity(text, kind = "info") {
  if (!activity) return;
  const el = document.createElement("div");
  el.className = `activity-entry ${kind}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.innerHTML = `<div class="time">${time}</div><div>${escapeHtml(text)}</div>`;
  activity.appendChild(el);
  activity.scrollTop = activity.scrollHeight;
}

function saveHistorySoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(HISTORY_KEY, messages.innerHTML);
    updateHistoryPanel();
  }, 100);
}

function restoreHistory() {
  const html = localStorage.getItem(HISTORY_KEY);
  if (html) {
    messages.innerHTML = html;
    messageCounter = messages.children.length;
    updateHistoryPanel();
    scrollDown();
  }
}

function clearHistory() {
  messages.innerHTML = "";
  localStorage.removeItem(HISTORY_KEY);
  currentAssistant = null;
  messageCounter = 0;
  updateHistoryPanel();
  addActivity("Started a new chat", "session");
}

function updateHistoryPanel() {
  if (!historyList) return;
  historyList.innerHTML = "";
  const items = [...messages.querySelectorAll(".message.user, .message.assistant, .tool-card, .mcp-card, .viz-card")];
  for (const el of items) {
    if (!el.id) el.id = `msg-${++messageCounter}`;
    const role = el.classList.contains("user") ? "user" : el.classList.contains("assistant") ? "assistant" : el.classList.contains("tool-card") ? "tool" : "visual";
    const raw = el.classList.contains("viz-card")
      ? el.querySelector(".viz-title")?.textContent || "Visualization"
      : el.classList.contains("mcp-card")
        ? el.querySelector(".mcp-title")?.textContent || "MCP UI"
        : el.classList.contains("tool-card")
          ? el.querySelector(".tool-card-title")?.textContent || "Tool call"
          : el.textContent || "";
    const label = raw.trim().replace(/\s+/g, " ").slice(0, 90) || role;
    const button = document.createElement("button");
    button.className = `history-item ${role}`;
    button.textContent = `${role === "user" ? "You" : role === "assistant" ? "Pi" : role === "tool" ? "Tool" : "Visual"}: ${label}`;
    button.addEventListener("click", () => {
      el.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    historyList.appendChild(button);
  }
}

function addMessage(role, text = "") {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.id = `msg-${++messageCounter}`;
  el.textContent = text;
  messages.appendChild(el);
  scrollDown();
  saveHistorySoon();
  return el;
}

function ensureAssistant() {
  if (!currentAssistant) currentAssistant = addMessage("assistant", "");
  return currentAssistant;
}

function send(payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function modelLabel(model) {
  if (!model) return "No model";
  return `${model.provider || "provider"}/${model.id || model.name || "model"}`;
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "ready":
      status = "idle";
      setMeta(`${modelLabel(msg.model)} · thinking ${msg.thinkingLevel} · ${msg.sessionId || "no session id"}`);
      addActivity(`Ready: ${modelLabel(msg.model)} · thinking ${msg.thinkingLevel}`);
      currentAssistant = null;
      if (!messages.children.length) renderExistingMessages(msg.messages || []);
      if (msg.modelFallbackMessage) addMessage("system", msg.modelFallbackMessage);
      break;
    case "status":
      status = msg.status;
      sendButton.disabled = status === "starting";
      addActivity(`Status: ${msg.status}`);
      scrollDown();
      break;
    case "user":
      addActivity("User prompt sent", "user");
      addMessage("user", msg.text);
      break;
    case "assistant_start":
      addActivity("Assistant response started", "assistant");
      currentAssistant = addMessage("assistant", "");
      break;
    case "assistant_delta":
      ensureAssistant().textContent += msg.delta;
      scrollDown();
      saveHistorySoon();
      break;
    case "thinking_delta":
      if (Date.now() - lastThinkingActivity > 1500) {
        lastThinkingActivity = Date.now();
        addActivity("Receiving thinking stream…", "thinking");
      }
      break;
    case "tool_start":
      addActivity(`Tool started: ${msg.toolName}`, "tool");
      showTool(msg.toolCallId, `▶ ${msg.toolName} ${JSON.stringify(msg.args || {})}`);
      renderToolCallCard(msg.toolCallId, msg.toolName, "running", msg.args, "");
      break;
    case "tool_update":
      addActivity(`Tool running: ${msg.toolName}`, "tool");
      showTool(msg.toolCallId, `… ${msg.toolName} running\n${toolResultPreview(msg.partialResult)}`.trim());
      renderToolCallCard(msg.toolCallId, msg.toolName, "running", msg.args, toolResultPreview(msg.partialResult));
      break;
    case "tool_end":
      addActivity(`Tool finished: ${msg.toolName}${msg.isError ? " (error)" : ""}`, msg.isError ? "error" : "tool");
      showTool(msg.toolCallId, `${msg.isError ? "✗" : "✓"} ${msg.toolName}\n${toolResultPreview(msg.result)}`.trim());
      renderToolCallCard(msg.toolCallId, msg.toolName, msg.isError ? "error" : "done", undefined, toolResultPreview(msg.result));
      renderMcpUiResources(msg.result, msg.toolName);
      break;
    case "queue":
      setMeta(`Queued: steer ${msg.steering?.length || 0}, follow-up ${msg.followUp?.length || 0}`);
      addActivity(`Queue updated: steer ${msg.steering?.length || 0}, follow-up ${msg.followUp?.length || 0}`);
      break;
    case "messages":
      addActivity("Assistant response complete", "assistant");
      currentAssistant = null;
      renderVisualizationsFromLastAssistant(msg.messages || []);
      saveHistorySoon();
      scrollDown();
      break;
    case "error":
      addActivity(msg.error || "Unknown error", "error");
      addMessage("error", msg.error || "Unknown error");
      currentAssistant = null;
      break;
  }
}

function toolResultPreview(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.text || item?.resource?.uri || "")
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
}

function renderToolCallCard(id, toolName, state, args, preview) {
  let card = toolCards.get(id);
  if (!card) {
    card = document.createElement("section");
    card.className = "tool-card";
    card.id = `msg-${++messageCounter}`;
    messages.appendChild(card);
    toolCards.set(id, card);
  }
  const stateLabel = state === "done" ? "complete" : state === "error" ? "error" : "running";
  const argText = args ? JSON.stringify(args, null, 2) : "";
  card.className = `tool-card ${state}`;
  card.innerHTML = `<div class="tool-card-title"><span>${state === "done" ? "✓" : state === "error" ? "✗" : "▶"}</span> ${escapeHtml(toolName)} <em>${stateLabel}</em></div>
    ${argText ? `<pre class="tool-card-block">${escapeHtml(argText)}</pre>` : ""}
    ${preview ? `<pre class="tool-card-block result">${escapeHtml(preview)}</pre>` : ""}`;
  scrollDown();
  saveHistorySoon();
}

function showTool(id, text) {
  tools.classList.remove("hidden");
  let row = toolRows.get(id);
  if (!row) {
    row = document.createElement("div");
    row.className = "tool";
    tools.appendChild(row);
    toolRows.set(id, row);
  }
  row.textContent = text;
  tools.scrollTop = tools.scrollHeight;
  scrollDown();
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function resourceText(resource) {
  if (typeof resource?.text === "string") return resource.text;
  if (typeof resource?.blob === "string") return decodeBase64Utf8(resource.blob);
  return "";
}

function isMcpUiResource(resource) {
  const mime = String(resource?.mimeType || "").toLowerCase();
  return String(resource?.uri || "").startsWith("ui://") ||
    mime.includes("text/html") ||
    mime.includes("text/uri-list") ||
    mime.includes("application/vnd.mcp-ui.remote-dom");
}

function extractMcpUiResources(result) {
  const out = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "resource" && value.resource && isMcpUiResource(value.resource)) {
      out.push(value.resource);
      return;
    }
    if ((value.type === "resource_link" || value.uri || value.mimeType) && isMcpUiResource(value)) {
      out.push(value);
      return;
    }
    if (value.type === "text" && typeof value.text === "string" && /^\s*</.test(value.text)) {
      out.push({ uri: `ui://html-text/${out.length + 1}`, mimeType: "text/html", text: value.text });
      return;
    }
    if (value.resource && isMcpUiResource(value.resource)) {
      out.push(value.resource);
      return;
    }
    if (typeof value.text === "string") {
      const parsed = tryParseJson(value.text);
      if (parsed) visit(parsed);
    }
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  visit(result?.content || result);
  return out;
}

function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function renderMcpUiResources(result, toolName = "tool") {
  const resources = extractMcpUiResources(result);
  addActivity(resources.length ? `Rendering ${resources.length} MCP UI resource(s) from ${toolName}` : `No MCP UI resources detected in ${toolName} result`, resources.length ? "tool" : "info");
  for (const resource of resources) renderMcpUiResource(resource, toolName);
}

function wrapInteractiveHtml(html, resource) {
  const renderData = JSON.stringify({
    uri: resource.uri || null,
    mimeType: resource.mimeType || null,
    theme: {
      text: "#4D4D4F",
      navy: "#003369",
      red: "#D71638",
      lightGrey: "#E6E7E8",
      midBlue: "#0071BC",
      lightBlue: "#00AEEF",
      purple: "#75287B",
      orange: "#F58220",
      green: "#50B848",
    },
  }).replace(/</g, "\\u003c");

  const bridge = `
<script>
(() => {
  window.__MCP_UI_RENDER_DATA__ = ${renderData};
  function send(type, payload, messageId) {
    window.parent.postMessage({ type, payload: payload || {}, messageId: messageId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) }, '*');
  }
  window.mcpUi = window.mcpUi || {
    prompt: (prompt) => send('prompt', { prompt }),
    tool: (toolName, params) => send('tool', { toolName, params: params || {} }),
    intent: (intent, params) => send('intent', { intent, params: params || {} }),
    notify: (message) => send('notify', { message }),
    link: (url) => send('link', { url }),
    chart: (payload) => send('chart', payload || {}),
    network: (payload) => send('network', payload || {}),
    sequence: (payload) => send('sequence', payload || {}),
  };
  window.callTool = window.callTool || window.mcpUi.tool;
  window.sendPrompt = window.sendPrompt || window.mcpUi.prompt;
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-prompt],[data-tool],[data-intent],[data-notify],[data-link]');
    if (!el) return;
    if (el.dataset.prompt) send('prompt', { prompt: el.dataset.prompt });
    if (el.dataset.tool) send('tool', { toolName: el.dataset.tool, params: safeJson(el.dataset.params) });
    if (el.dataset.intent) send('intent', { intent: el.dataset.intent, params: safeJson(el.dataset.params) });
    if (el.dataset.notify) send('notify', { message: el.dataset.notify });
    if (el.dataset.link) send('link', { url: el.dataset.link });
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form.matches('[data-prompt],[data-tool]')) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.prompt) send('prompt', { prompt: form.dataset.prompt, values });
    if (form.dataset.tool) send('tool', { toolName: form.dataset.tool, params: values });
  });
  function safeJson(value) { try { return value ? JSON.parse(value) : {}; } catch { return {}; } }
})();
</scr${""}ipt>`;

  const baseStyle = `<style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #4D4D4F; }
    body { margin: 0; }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
  </style>`;

  if (/<!doctype|<html|<head|<body/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${baseStyle}${bridge}`);
    if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => `${m}${baseStyle}${bridge}`);
    return `${bridge}${html}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${baseStyle}${bridge}</head><body>${html}</body></html>`;
}

function setIframeHtml(iframe, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  iframe.src = url;
  iframe.addEventListener("load", () => {
    // Keep the object URL alive long enough for iframe scripts/assets to initialize.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, { once: true });
}

function renderMcpUiResource(resource, toolName) {
  addActivity(`Rendering iframe HTML for ${resource.uri || resource.mimeType || toolName}`, "tool");
  const card = document.createElement("section");
  card.className = "mcp-card";
  card.id = `msg-${++messageCounter}`;

  const title = document.createElement("div");
  title.className = "mcp-title";
  title.textContent = `MCP UI · ${toolName} · ${resource.uri || resource.mimeType || "resource"}`;
  card.appendChild(title);

  const mime = String(resource.mimeType || "").toLowerCase();
  const iframe = document.createElement("iframe");
  iframe.className = "mcp-frame";
  iframe.sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";
  iframe.referrerPolicy = "no-referrer";

  const text = resourceText(resource);
  if (mime.includes("text/uri-list")) {
    const url = text.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line));
    if (url) iframe.src = url;
    else setIframeHtml(iframe, `<p>No valid URL in MCP UI resource.</p>`);
  } else if (mime.includes("application/vnd.mcp-ui.remote-dom")) {
    setIframeHtml(iframe, remoteDomFallbackHtml(text));
  } else {
    setIframeHtml(iframe, wrapInteractiveHtml(text || "<p>Empty MCP UI resource.</p>", resource));
  }

  card.appendChild(iframe);
  messages.appendChild(card);
  scrollDown();
  saveHistorySoon();
}

function remoteDomFallbackHtml(script) {
  const escaped = script.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:16px;background:#FFFFFF;color:#4D4D4F"><h3 style="color:#003369">Remote DOM resource</h3><p>This lightweight host renders HTML/URL MCP UI resources. Remote DOM needs the full @mcp-ui/client React renderer.</p><pre style="white-space:pre-wrap;background:#E6E7E8;padding:12px;border-radius:8px">${escaped}</pre></body>`;
}

function postIframeAck(source, action, result = { ok: true }) {
  if (!source || !action?.messageId) return;
  try {
    source.postMessage({ type: "ui-action-result", messageId: action.messageId, result }, "*");
    source.postMessage({ type: "mcp-ui-action-result", messageId: action.messageId, result }, "*");
  } catch {}
}

function handleMcpUiAction(action, source) {
  if (!action || typeof action !== "object") return;
  const payload = action.payload || {};
  if (action.type === "prompt" && payload.prompt) {
    send({ type: "prompt", message: String(payload.prompt), streamingBehavior: status === "running" ? "followUp" : undefined });
    postIframeAck(source, action);
  } else if (action.type === "tool") {
    const toolName = payload.toolName || "unknown";
    const params = JSON.stringify(payload.params || {});
    send({ type: "prompt", message: `MCP UI requested tool call: ${toolName} with params ${params}. If this tool is available, run it.`, streamingBehavior: status === "running" ? "followUp" : undefined });
    postIframeAck(source, action);
  } else if (action.type === "intent") {
    send({ type: "prompt", message: `Handle this MCP UI intent: ${JSON.stringify(payload)}`, streamingBehavior: status === "running" ? "followUp" : undefined });
    postIframeAck(source, action);
  } else if (action.type === "notify") {
    addMessage("system", payload.message || "MCP UI notification");
    postIframeAck(source, action);
  } else if (action.type === "link" && payload.url) {
    window.open(String(payload.url), "_blank", "noopener,noreferrer");
    postIframeAck(source, action);
  } else if (action.type === "chart") {
    renderBarChart(payload, payload.title || "MCP UI chart");
    postIframeAck(source, action);
  } else if (action.type === "network") {
    renderNetworkGraph(payload, payload.title || "MCP UI network");
    postIframeAck(source, action);
  } else if (action.type === "sequence") {
    renderSequenceDiagram(payload, payload.title || "MCP UI sequence");
    postIframeAck(source, action);
  }
}

window.addEventListener("message", (event) => {
  // MCP-UI adapters commonly post { type, payload }, { detail: { type, payload } },
  // or { event: '...', data: ... }. Normalize the common shapes.
  const raw = event.data?.detail || event.data;
  const data = raw?.type ? raw : raw?.action ? { type: raw.action, payload: raw.payload || raw.data, messageId: raw.messageId } : raw?.event ? { type: raw.event, payload: raw.payload || raw.data, messageId: raw.messageId } : raw;
  if (["tool", "prompt", "intent", "notify", "link", "chart", "network", "sequence"].includes(data?.type)) {
    handleMcpUiAction(data, event.source);
  }
});

const renderedVizKeys = new Set();

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return String(hash);
}

function renderVisualizationsFromLastAssistant(existing) {
  const last = [...existing].reverse().find((msg) => msg.role === "assistant");
  if (!last) return;
  const text = (last.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  renderVisualizationBlocks(text);
}

function renderVisualizationBlocks(text) {
  const blockPattern = /```(chart-json|bar-chart|network-json|network|sequence-json|sequence)\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = blockPattern.exec(text))) {
    const kind = match[1].toLowerCase();
    const json = match[2].trim();
    const key = `${kind}:${hashText(json)}`;
    if (renderedVizKeys.has(key)) continue;
    renderedVizKeys.add(key);
    try {
      const data = JSON.parse(json);
      if (kind.includes("network")) renderNetworkGraph(data, data.title || "Network graph");
      else if (kind.includes("sequence")) renderSequenceDiagram(data, data.title || "Sequence diagram");
      else renderBarChart(data, data.title || "Bar chart");
    } catch (error) {
      addMessage("error", `Could not parse ${kind}: ${error.message}`);
    }
  }
}

function normalizeBarData(input) {
  const rows = Array.isArray(input) ? input : input.data || input.values || [];
  return rows.map((row, index) => ({
    label: String(row.label ?? row.name ?? row.x ?? index + 1),
    value: Number(row.value ?? row.y ?? row.count ?? 0),
    color: row.color,
  })).filter((row) => Number.isFinite(row.value));
}

function renderBarChart(input, title = "Bar chart") {
  const data = normalizeBarData(input);
  if (!data.length) return addMessage("error", "Chart has no numeric data.");

  const max = Math.max(...data.map((d) => d.value), 1);
  const width = 860;
  const height = 360;
  const margin = { top: 40, right: 24, bottom: 72, left: 64 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const gap = 10;
  const barW = Math.max(12, (plotW - gap * (data.length - 1)) / data.length);

  const bars = data.map((d, i) => {
    const h = (d.value / max) * plotH;
    const x = margin.left + i * (barW + gap);
    const y = margin.top + plotH - h;
    const palette = ["#003369", "#0071BC", "#00AEEF", "#75287B", "#F58220", "#50B848", "#D71638"];
    const color = d.color || palette[i % palette.length];
    return `<g>
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="7" fill="${color}"></rect>
      <text x="${x + barW / 2}" y="${y - 7}" text-anchor="middle" fill="#4D4D4F" font-size="12">${escapeHtml(String(d.value))}</text>
      <text x="${x + barW / 2}" y="${height - 36}" text-anchor="end" transform="rotate(-35 ${x + barW / 2} ${height - 36})" fill="#4D4D4F" font-size="12">${escapeHtml(d.label)}</text>
    </g>`;
  }).join("");

  const card = document.createElement("section");
  card.className = "viz-card";
  card.innerHTML = `<div class="viz-title">${escapeHtml(title)}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="#E6E7E8" />
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#E6E7E8" />
      <text x="${margin.left}" y="24" fill="#4D4D4F" font-size="12">max ${max}</text>
      ${bars}
    </svg>`;
  messages.appendChild(card);
  scrollDown();
  saveHistorySoon();
}

function getNodeId(value) {
  if (value == null) return undefined;
  if (typeof value !== "object") return String(value);
  return value.id ?? value.key ?? value.assetId ?? value.uuid ?? value.code ?? value.name ?? value.label;
}

function normalizeNetworkNode(value, fallbackIndex = 0) {
  const id = getNodeId(value) ?? `node-${fallbackIndex + 1}`;
  if (!value || typeof value !== "object") return { id: String(id), label: String(id), group: undefined, i: fallbackIndex };
  return {
    id: String(id),
    label: String(value.label ?? value.name ?? value.displayName ?? value.title ?? id),
    group: value.group ?? value.type ?? value.category ?? value.class ?? value.kind,
    i: fallbackIndex,
  };
}

function normalizeNetworkEdge(value) {
  const source = value.source ?? value.from ?? value.start ?? value.src;
  const target = value.target ?? value.to ?? value.end ?? value.dst;
  return {
    source: String(getNodeId(source) ?? source),
    target: String(getNodeId(target) ?? target),
    label: value.label ?? value.type ?? value.name ?? value.predicate ?? value.relationshipType ?? "",
  };
}

function normalizeNetworkData(input) {
  const nodeById = new Map();
  const edges = [];
  const addNode = (value) => {
    const node = normalizeNetworkNode(value, nodeById.size);
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    return node.id;
  };

  for (const node of input.nodes || input.vertices || input.entities || input.items || []) addNode(node);
  for (const edge of input.edges || input.relationships || input.links || input.connections || []) {
    const normalized = normalizeNetworkEdge(edge);
    if (normalized.source !== "undefined" && normalized.target !== "undefined") edges.push(normalized);
  }

  for (const record of input.records || input.rows || []) {
    const source = record.source ?? record.from ?? record.start ?? record.asset ?? record.parent;
    const target = record.target ?? record.to ?? record.end ?? record.connectsTo ?? record.child;
    if (!source || !target) continue;
    const sourceId = addNode(source);
    const targetId = addNode(target);
    const relation = record.relationship ?? record.relation ?? record.edge ?? record.link ?? {};
    edges.push({
      source: sourceId,
      target: targetId,
      label: relation.label ?? relation.type ?? relation.name ?? relation.predicate ?? record.label ?? record.type ?? "",
    });
  }

  return { nodes: [...nodeById.values()].map((node, i) => ({ ...node, i })), edges };
}

function renderNetworkGraph(input, title = "Network graph") {
  const { nodes, edges } = normalizeNetworkData(input);
  if (!nodes.length) return addMessage("error", "Network graph has no nodes.");

  const width = 860;
  const height = 430;
  const cx = width / 2;
  const cy = height / 2 + 10;
  const radius = Math.min(width, height) * 0.34;
  const byId = new Map(nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    return [node.id, { ...node, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }];
  }));

  const edgeSvg = edges.map((edge) => {
    const a = byId.get(edge.source); const b = byId.get(edge.target);
    if (!a || !b) return "";
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    return `<g><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#0071BC" stroke-width="2" />
      ${edge.label ? `<text x="${mx}" y="${my - 4}" text-anchor="middle" fill="#4D4D4F" font-size="11">${escapeHtml(edge.label)}</text>` : ""}</g>`;
  }).join("");

  const nodeSvg = [...byId.values()].map((node, i) => {
    const palette = ["#003369", "#0071BC", "#00AEEF", "#75287B", "#F58220", "#50B848", "#D71638"];
    const color = palette[i % palette.length];
    return `<g><circle cx="${node.x}" cy="${node.y}" r="24" fill="${color}" stroke="#E6E7E8" stroke-opacity="1" stroke-width="2" />
      <text x="${node.x}" y="${node.y + 4}" text-anchor="middle" fill="white" font-size="12" font-weight="700">${escapeHtml(node.label.slice(0, 12))}</text>
      ${node.group ? `<text x="${node.x}" y="${node.y + 42}" text-anchor="middle" fill="#4D4D4F" font-size="11">${escapeHtml(String(node.group))}</text>` : ""}</g>`;
  }).join("");

  const card = document.createElement("section");
  card.className = "viz-card";
  card.innerHTML = `<div class="viz-title">${escapeHtml(title)} · ${nodes.length} nodes · ${edges.length} edges</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${edgeSvg}${nodeSvg}</svg>`;
  messages.appendChild(card);
  scrollDown();
  saveHistorySoon();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function renderDemoChart() {
  renderBarChart({
    title: "Sample LNG train throughput",
    data: [
      { label: "Jan", value: 84 }, { label: "Feb", value: 91 }, { label: "Mar", value: 76 },
      { label: "Apr", value: 103 }, { label: "May", value: 117 }, { label: "Jun", value: 98 }
    ]
  }, "Sample LNG train throughput");
}

function renderSequenceDiagram(input, title = "Sequence diagram") {
  const participants = (input.participants || input.actors || []).map((p) =>
    typeof p === "string" ? { id: p, label: p } : { id: String(p.id || p.name || p.label), label: String(p.label || p.name || p.id) }
  );
  const steps = (input.steps || input.messages || []).map((s, i) => ({
    from: String(s.from || s.source || s.sender || ""),
    to: String(s.to || s.target || s.receiver || ""),
    label: String(s.label || s.message || s.text || `Step ${i + 1}`),
    type: String(s.type || s.kind || "call"),
  }));

  for (const step of steps) {
    for (const id of [step.from, step.to]) {
      if (id && !participants.some((p) => p.id === id)) participants.push({ id, label: id });
    }
  }
  if (!participants.length || !steps.length) return addMessage("error", "Sequence diagram needs participants and steps.");

  const width = Math.max(860, participants.length * 170);
  const top = 70;
  const rowH = 58;
  const bottom = 60;
  const height = top + steps.length * rowH + bottom;
  const leftPad = 80;
  const rightPad = 80;
  const gap = participants.length === 1 ? 0 : (width - leftPad - rightPad) / (participants.length - 1);
  const palette = ["#003369", "#0071BC", "#00AEEF", "#75287B", "#F58220", "#50B848", "#D71638"];
  const pos = new Map(participants.map((p, i) => [p.id, { ...p, x: leftPad + i * gap, color: palette[i % palette.length] }]));

  const heads = participants.map((p) => {
    const item = pos.get(p.id);
    return `<g>
      <rect x="${item.x - 58}" y="20" width="116" height="34" rx="8" fill="${item.color}" />
      <text x="${item.x}" y="42" text-anchor="middle" fill="#FFFFFF" font-size="12" font-weight="700">${escapeHtml(p.label.slice(0, 18))}</text>
      <line x1="${item.x}" y1="58" x2="${item.x}" y2="${height - 28}" stroke="#E6E7E8" stroke-width="2" stroke-dasharray="6 7" />
    </g>`;
  }).join("");

  const arrows = steps.map((s, i) => {
    const a = pos.get(s.from); const b = pos.get(s.to);
    if (!a || !b) return "";
    const y = top + i * rowH;
    const forward = b.x >= a.x;
    const color = s.type === "return" || s.type === "response" ? "#50B848" : s.type === "error" ? "#D71638" : "#003369";
    const dash = s.type === "return" || s.type === "response" ? "stroke-dasharray='7 5'" : "";
    const labelX = (a.x + b.x) / 2;
    const labelY = y - 10;
    if (a.x === b.x) {
      return `<g>
        <path d="M ${a.x} ${y} C ${a.x + 70} ${y}, ${a.x + 70} ${y + 30}, ${a.x} ${y + 30}" fill="none" stroke="${color}" stroke-width="2" ${dash}/>
        <polygon points="${a.x},${y + 30} ${a.x + 10},${y + 24} ${a.x + 10},${y + 36}" fill="${color}" />
        <text x="${a.x + 76}" y="${y + 18}" fill="#4D4D4F" font-size="12">${escapeHtml(s.label)}</text>
      </g>`;
    }
    const arrow = forward
      ? `<polygon points="${b.x},${y} ${b.x - 10},${y - 6} ${b.x - 10},${y + 6}" fill="${color}" />`
      : `<polygon points="${b.x},${y} ${b.x + 10},${y - 6} ${b.x + 10},${y + 6}" fill="${color}" />`;
    return `<g>
      <line x1="${a.x}" y1="${y}" x2="${b.x}" y2="${y}" stroke="${color}" stroke-width="2" ${dash}/>
      ${arrow}
      <rect x="${labelX - Math.min(180, s.label.length * 3.5)}" y="${labelY - 15}" width="${Math.min(360, Math.max(90, s.label.length * 7))}" height="22" rx="5" fill="#FFFFFF" opacity=".92" />
      <text x="${labelX}" y="${labelY}" text-anchor="middle" fill="#4D4D4F" font-size="12">${escapeHtml(s.label.slice(0, 55))}</text>
    </g>`;
  }).join("");

  const card = document.createElement("section");
  card.className = "viz-card sequence-card";
  card.innerHTML = `<div class="viz-title">${escapeHtml(title)} · ${participants.length} participants · ${steps.length} steps</div>
    <div class="viz-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${heads}${arrows}</svg></div>`;
  messages.appendChild(card);
  scrollDown();
  saveHistorySoon();
}

function renderDemoSequence() {
  renderSequenceDiagram({
    title: "Pi Web Chat streaming flow",
    participants: ["User", "Web Chat", "Pi SDK", "Model", "Tools"],
    steps: [
      { from: "User", to: "Web Chat", label: "Send prompt" },
      { from: "Web Chat", to: "Pi SDK", label: "session.prompt()" },
      { from: "Pi SDK", to: "Model", label: "stream request" },
      { from: "Model", to: "Pi SDK", label: "text_delta / thinking_delta", type: "response" },
      { from: "Pi SDK", to: "Tools", label: "tool call", type: "call" },
      { from: "Tools", to: "Pi SDK", label: "tool result", type: "return" },
      { from: "Pi SDK", to: "Web Chat", label: "events over WebSocket", type: "response" },
      { from: "Web Chat", to: "User", label: "render text, charts, MCP UI", type: "response" }
    ]
  }, "Pi Web Chat streaming flow");
}

function renderDemoInteractiveNetwork() {
  renderMcpUiResource({
    uri: "ui://demo/interactive-network",
    mimeType: "text/html",
    text: `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; color: #4D4D4F; background: #fff; }
    .wrap { padding: 14px; }
    .bar { display:flex; gap:8px; align-items:center; margin-bottom:10px; }
    .title { color:#003369; font-weight:800; margin-right:auto; }
    button { border:0; border-radius:8px; padding:8px 10px; color:white; background:#D71638; cursor:pointer; }
    svg { width: 100%; height: 520px; border:1px solid #E6E7E8; border-radius:14px; background: linear-gradient(180deg,#fff,#fafafa); touch-action: none; }
    .edge { stroke:#0071BC; stroke-width:2.5; opacity:.75; }
    .edge-label { fill:#4D4D4F; font-size:12px; paint-order:stroke; stroke:white; stroke-width:4px; }
    .node circle { stroke:#E6E7E8; stroke-width:3; cursor:grab; filter: drop-shadow(0 4px 8px rgba(0,0,0,.14)); }
    .node:active circle { cursor:grabbing; stroke:#D71638; stroke-width:5; }
    .node text { fill:white; font-size:12px; font-weight:800; text-anchor:middle; dominant-baseline:middle; pointer-events:none; }
    .hint { color:#6f7073; font-size:12px; margin-top:8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <div class="title">Interactive Graph DB Network</div>
      <button id="layout">Reset layout</button>
      <button id="send">Send selected to Pi</button>
    </div>
    <svg id="graph" viewBox="0 0 900 520" aria-label="Draggable network plot">
      <g id="edges"></g>
      <g id="nodes"></g>
    </svg>
    <div class="hint">Drag nodes to reposition them. Click a node to select it. Double-click a node to notify the host.</div>
  </div>
  <script>
    const palette = ['#003369','#0071BC','#00AEEF','#75287B','#F58220','#50B848','#D71638'];
    const nodes = [
      {id:'tank', label:'Tank', group:'Storage'},
      {id:'pump', label:'Pump', group:'Equipment'},
      {id:'valve', label:'Valve', group:'Equipment'},
      {id:'train', label:'Train', group:'Process'},
      {id:'meter', label:'Meter', group:'Instrument'},
      {id:'ops', label:'Ops', group:'Team'}
    ];
    const edges = [
      {source:'tank', target:'pump', label:'FEEDS'},
      {source:'pump', target:'valve', label:'PRESSURIZES'},
      {source:'valve', target:'train', label:'CONTROLS'},
      {source:'meter', target:'valve', label:'MEASURES'},
      {source:'meter', target:'train', label:'REPORTS'},
      {source:'ops', target:'train', label:'MONITORS'}
    ];
    const svg = document.getElementById('graph');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    let selected = null;
    let drag = null;

    function resetLayout() {
      const cx = 450, cy = 260, r = 185;
      nodes.forEach((n, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / nodes.length;
        n.x = cx + Math.cos(a) * r;
        n.y = cy + Math.sin(a) * r;
      });
      render();
    }

    function pt(event) {
      const p = svg.createSVGPoint();
      p.x = event.clientX; p.y = event.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }

    function render() {
      const byId = new Map(nodes.map(n => [n.id, n]));
      edgeLayer.innerHTML = edges.map(e => {
        const a = byId.get(e.source), b = byId.get(e.target);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        return '<g><line class="edge" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" />' +
          '<text class="edge-label" x="'+mx+'" y="'+(my-7)+'" text-anchor="middle">'+e.label+'</text></g>';
      }).join('');
      nodeLayer.innerHTML = nodes.map((n,i) => '<g class="node" data-id="'+n.id+'" transform="translate('+n.x+' '+n.y+')">' +
        '<circle r="34" fill="'+palette[i % palette.length]+'" />' +
        '<text>'+n.label+'</text>' +
        (selected === n.id ? '<circle r="42" fill="none" stroke="#D71638" stroke-width="4" />' : '') +
      '</g>').join('');
    }

    svg.addEventListener('pointerdown', (event) => {
      const g = event.target.closest('.node');
      if (!g) return;
      const n = nodes.find(x => x.id === g.dataset.id);
      const p = pt(event);
      drag = { n, dx: n.x - p.x, dy: n.y - p.y };
      selected = n.id;
      svg.setPointerCapture(event.pointerId);
      render();
    });
    svg.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const p = pt(event);
      drag.n.x = Math.max(45, Math.min(855, p.x + drag.dx));
      drag.n.y = Math.max(45, Math.min(475, p.y + drag.dy));
      render();
    });
    svg.addEventListener('pointerup', () => { drag = null; });
    svg.addEventListener('dblclick', (event) => {
      const g = event.target.closest('.node');
      if (!g) return;
      const n = nodes.find(x => x.id === g.dataset.id);
      window.mcpUi.notify('Selected node: ' + n.label + ' (' + n.group + ')');
    });
    document.getElementById('layout').onclick = resetLayout;
    document.getElementById('send').onclick = () => {
      const n = nodes.find(x => x.id === selected);
      if (!n) return window.mcpUi.notify('Select a node first');
      window.mcpUi.prompt('Analyze this selected graph node and its relationships: ' + JSON.stringify({ selected: n, edges: edges.filter(e => e.source === n.id || e.target === n.id) }));
    };
    resetLayout();
  </script>
</body>
</html>`
  }, "interactive-network-demo");
}

function renderDemoNetwork() {
  renderNetworkGraph({
    title: "Sample graph-db asset network",
    nodes: [
      { id: "tank", label: "Tank", group: "storage" },
      { id: "pump", label: "Pump", group: "equipment" },
      { id: "valve", label: "Valve", group: "equipment" },
      { id: "train", label: "Train", group: "process" },
      { id: "meter", label: "Meter", group: "instrument" }
    ],
    edges: [
      { source: "tank", target: "pump", label: "feeds" },
      { source: "pump", target: "valve", label: "pressurizes" },
      { source: "valve", target: "train", label: "controls" },
      { source: "meter", target: "valve", label: "measures" },
      { source: "meter", target: "train", label: "reports" }
    ]
  }, "Sample graph-db asset network");
}

function renderDemoNetworkRecords() {
  renderNetworkGraph({
    title: "Sample network from query records",
    records: [
      {
        asset: { assetId: "well-07", displayName: "Well 07", class: "source" },
        relationship: { name: "flows_to" },
        connectsTo: { assetId: "manifold-a", displayName: "Manifold A", class: "gathering" }
      },
      {
        asset: { assetId: "well-12", displayName: "Well 12", class: "source" },
        relationship: { name: "flows_to" },
        connectsTo: { assetId: "manifold-a", displayName: "Manifold A", class: "gathering" }
      },
      {
        asset: { assetId: "manifold-a", displayName: "Manifold A", class: "gathering" },
        relationship: { name: "feeds" },
        connectsTo: { assetId: "separator-2", displayName: "Separator 2", class: "process" }
      },
      {
        asset: { assetId: "separator-2", displayName: "Separator 2", class: "process" },
        relationship: { name: "exports_liquid" },
        connectsTo: { assetId: "tank-farm", displayName: "Tank Farm", class: "storage" }
      },
      {
        asset: { assetId: "separator-2", displayName: "Separator 2", class: "process" },
        relationship: { name: "exports_gas" },
        connectsTo: { assetId: "compressor-k101", displayName: "K-101", class: "equipment" }
      }
    ]
  }, "Sample network from query records");
}

function renderDemoMcpUi() {
  renderMcpUiResource({ 
    uri: "ui://demo/card",
    mimeType: "text/html",
    text: `<!doctype html><meta charset="utf-8">
      <body style="margin:0;font-family:system-ui;background:linear-gradient(135deg,#003369,#0071BC,#00AEEF);color:white;padding:20px">
        <h2 style="margin-top:0">MCP UI Demo Component</h2>
        <p>This is an iframe-rendered MCP UI resource inside Pi Web Chat.</p>
        <button style="padding:10px 14px;border-radius:10px;border:0;background:#D71638;color:white;font-weight:700" onclick="parent.postMessage({type:'prompt',payload:{prompt:'Say hello from the MCP UI demo component'}},'*')">Send prompt action</button>
        <button style="padding:10px 14px;border-radius:10px;border:1px solid #00AEEF;background:transparent;color:white" onclick="parent.postMessage({type:'notify',payload:{message:'Hello from MCP UI'}},'*')">Notify host</button>
      </body>`
  }, "demo");
}

function renderExistingMessages(existing) {
  for (const msg of existing) {
    if (msg.role === "user") {
      addMessage("user", typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
    } else if (msg.role === "assistant") {
      const text = (msg.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text) addMessage("assistant", text);
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  currentAssistant = null;
  if (message === "/demo-ui") {
    renderDemoMcpUi();
    return;
  }
  if (message === "/demo-chart") {
    renderDemoChart();
    return;
  }
  if (message === "/demo-network") {
    renderDemoNetwork();
    return;
  }
  if (message === "/demo-network-interactive" || message === "/demo-network-interactiv" || message === "/demo-drag-network") {
    addActivity("Opening draggable network demo", "tool");
    renderDemoInteractiveNetwork();
    return;
  }
  if (message === "/demo-sequence") {
    renderDemoSequence();
    return;
  }
  if (message === "/demo-network-records" || message === "/demo-network-alt") {
    renderDemoNetworkRecords();
    return;
  }
  renderVisualizationBlocks(message);
  send({ type: "prompt", message, streamingBehavior: status === "running" ? "followUp" : undefined });
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

abortButton.addEventListener("click", () => send({ type: "abort" }));
newSessionButton.addEventListener("click", () => {
  toolRows.clear();
  toolCards.clear();
  tools.innerHTML = "";
  tools.classList.add("hidden");
  renderedVizKeys.clear();
  clearHistory();
  send({ type: "new_session" });
});

new MutationObserver(() => scrollDown()).observe(messages, { childList: true, subtree: true, characterData: true });
restoreHistory();
connect();
