const messages = document.getElementById("messages");
const meta = document.getElementById("meta");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const tools = document.getElementById("tools");
const artifacts = document.getElementById("artifacts");
const promptTurns = document.getElementById("promptTurns");
const inspector = document.getElementById("inspector");
const approvalMode = document.getElementById("approvalMode");
const folderList = document.getElementById("folderList");
const leftResize = document.getElementById("leftResize");
const rightResize = document.getElementById("rightResize");
const learningMode = document.getElementById("learningMode");
const learningTopic = document.getElementById("learningTopic");
const learningDepth = document.getElementById("learningDepth");
const learningVault = document.getElementById("learningVault");
const startLearningBtn = document.getElementById("startLearning");
const pretestLearningBtn = document.getElementById("pretestLearning");
const useWorkspaceVaultBtn = document.getElementById("useWorkspaceVault");
const learningStatus = document.getElementById("learningStatus");
const learningHint = document.getElementById("learningHint");
const sendButton = document.getElementById("send");
const abortButton = document.getElementById("abort");
const newSessionButton = document.getElementById("newSession");
const historyList = document.getElementById("historyList");
const activity = document.getElementById("activity");
const cwdInput = document.getElementById("cwdInput");
const cwdSetBtn = document.getElementById("cwdSet");
const fileInput = document.getElementById("fileInput");
const fileReadBtn = document.getElementById("fileRead");
const attachmentsBar = document.getElementById("attachments");
const attachBtn = document.getElementById("attachBtn");
const fileUpload = document.getElementById("fileUpload");
const appEl = document.querySelector(".app");
const dropzone = document.getElementById("dropzone");
const themeBtn = document.getElementById("theme");
const inputModalMount = document.getElementById("inputModalMount");
const scrollBottomBtn = document.getElementById("scrollBottom");
const scrollBottomCount = scrollBottomBtn?.querySelector(".scroll-bottom-count");

// Theme: documentElement[data-theme] was set pre-paint by the head script.
function applyPanelWidths() {
  const left = localStorage.getItem("process-ai-left-width");
  const right = localStorage.getItem("process-ai-right-width");
  if (left) document.documentElement.style.setProperty("--left-panel-width", left);
  if (right) document.documentElement.style.setProperty("--right-panel-width", right);
}
function makePanelResizable(handle, side) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const move = (e) => {
      if (side === "left") {
        const w = Math.max(260, Math.min(560, e.clientX));
        document.documentElement.style.setProperty("--left-panel-width", `${w}px`);
        localStorage.setItem("process-ai-left-width", `${w}px`);
      } else {
        const w = Math.max(320, Math.min(720, window.innerWidth - e.clientX - 18));
        document.documentElement.style.setProperty("--right-panel-width", `${w}px`);
        localStorage.setItem("process-ai-right-width", `${w}px`);
      }
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}
applyPanelWidths();
makePanelResizable(leftResize, "left");
makePanelResizable(rightResize, "right");
const THEME_KEY = "pi-web-chat-theme";
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  if (themeBtn) { themeBtn.textContent = t === "dark" ? "☀️" : "🌙"; themeBtn.title = t === "dark" ? "Switch to light" : "Switch to dark"; }
}
applyTheme(document.documentElement.getAttribute("data-theme") || "light");
themeBtn?.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme(next);
});

const pendingAttachments = [];
const MAX_ATTACH_BYTES = 200 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
let ws;
let currentAssistant;
let currentAssistantRaw = "";
let assistantRenderPending = false;
let currentThinkingEl = null;
let currentThinkingRaw = "";
let status = "connecting";
const toolRows = new Map();
const toolCards = new Map();
const toolChips = new Map();
const CONVOS_KEY = "pi-web-chat-conversations-v1";
const CURRENT_CONVO_KEY = "pi-web-chat-current-convo";
let currentConvoId = null;
let saveTimer;
let messageCounter = 0;
let lastThinkingActivity = 0;
const pendingQuestions = [];
let activeQuestionIndex = 0;
let questionModal;

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

// Only stick to the bottom while the user is already near it, so scrolling up to
// read history during a stream isn't fought. Sending a prompt re-enables follow.
let autoFollow = true;
let unreadWhilePaused = 0;
let lastScrollHeight = 0;
function distanceFromBottom() {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight;
}
function updateScrollAffordance() {
  const nearBottom = distanceFromBottom() < 96;
  autoFollow = nearBottom;
  scrollBottomBtn?.classList.toggle("hidden", nearBottom);
  if (nearBottom) unreadWhilePaused = 0;
  if (scrollBottomCount) {
    scrollBottomCount.textContent = String(unreadWhilePaused);
    scrollBottomCount.classList.toggle("hidden", unreadWhilePaused <= 0);
  }
}
messages.addEventListener("scroll", updateScrollAffordance, { passive: true });
function scrollDown(force = false) {
  if (!force && !autoFollow) {
    if (messages.scrollHeight !== lastScrollHeight) unreadWhilePaused++;
    lastScrollHeight = messages.scrollHeight;
    updateScrollAffordance();
    return;
  }
  requestAnimationFrame(() => {
    messages.scrollTo({ top: messages.scrollHeight, behavior: force ? "smooth" : "auto" });
    lastScrollHeight = messages.scrollHeight;
    unreadWhilePaused = 0;
    updateScrollAffordance();
  });
}
function jumpToLatest() {
  autoFollow = true;
  unreadWhilePaused = 0;
  scrollDown(true);
}
scrollBottomBtn?.addEventListener("click", jumpToLatest);
messages.addEventListener("keydown", (event) => {
  if (event.key === "End") { event.preventDefault(); jumpToLatest(); }
  if (event.key === "Home") { event.preventDefault(); autoFollow = false; messages.scrollTo({ top: 0, behavior: "smooth" }); updateScrollAffordance(); }
});

function showInspectorPanel() {
  // Split inspector: timeline and MCP UI/artifacts stay visible together.
  inspector?.querySelectorAll(".inspector-panel").forEach((panel) => panel.classList.remove("hidden"));
}
inspector?.addEventListener("click", (event) => {
  const tab = event.target.closest?.("[data-inspector-tab]");
  if (tab) document.getElementById(tab.dataset.inspectorTab === "artifacts" ? "artifacts" : tab.dataset.inspectorTab === "prompts" ? "promptTurns" : "tools")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
if (approvalMode) approvalMode.value = localStorage.getItem("process-ai-approval-mode") || "smart";
approvalMode?.addEventListener("change", () => {
  localStorage.setItem("process-ai-approval-mode", approvalMode.value);
  addActivity(`Command approval mode: ${approvalMode.options[approvalMode.selectedIndex]?.text || approvalMode.value}`, "session");
});

function approvalPolicyText() {
  const mode = approvalMode?.value || "smart";
  const label = approvalMode?.options[approvalMode.selectedIndex]?.text || mode;
  const rules = {
    auto: "Auto-run: do not ask before shell commands unless you need missing information.",
    always: "Always ask: before any shell command, call ask_question to request user approval. Continue only if approved.",
    risky: "Ask risky only: call ask_question before destructive, network, install, credential, filesystem write, long-running, or external side-effect commands. Read-only inspection commands may run without approval.",
    readonly: "Read-only auto-run: read/list/search/status commands may run without approval. Before write/edit/delete/install/network/process-kill commands, call ask_question to request approval.",
    smart: "Smart approvals: use judgement. Auto-run safe read-only inspection. Call ask_question for destructive, costly, privacy-sensitive, network, install, write, or ambiguous commands."
  };
  return `[Process AI Harness command approval mode: ${label}]\n${rules[mode] || rules.smart}\nUse the existing ask_question tool for approval so the browser shows the MCP-style input modal.`;
}

function renderServiceLog(msg) {
  const level = msg.level || "info";
  const service = msg.service || "service";
  const body = msg.meta && Object.keys(msg.meta).length ? JSON.stringify(msg.meta, null, 2) : "";
  addTimelineEntry(`${service}: ${msg.message || "log"}`, body, level);
  if (level === "error" || level === "warn") addActivity(`${service}: ${msg.message || "log"}`, level === "error" ? "error" : "info");
}

function addPromptTurn(text, attachments = []) {
  if (!promptTurns) return;
  const entry = document.createElement("details");
  entry.className = "prompt-turn";
  entry.open = true;
  const n = promptTurns.children.length + 1;
  entry.innerHTML = `<summary><span>Turn ${n}</span><time>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></summary><pre></pre>${attachments.length ? `<div class="prompt-attachments">${attachments.map((a) => `<span>${escapeHtml(a.path || "attachment")}</span>`).join("")}</div>` : ""}`;
  entry.querySelector("pre").textContent = text;
  promptTurns.prepend(entry);
}

function addTimelineEntry(title, body = "", kind = "info") {
  if (!tools) return null;
  const entry = document.createElement("details");
  entry.className = `timeline-entry ${kind}`;
  entry.open = kind === "running" || kind === "error";
  entry.innerHTML = `<summary><span class="timeline-dot"></span><span class="timeline-title"></span><span class="timeline-state"></span></summary><pre class="timeline-body"></pre>`;
  entry.querySelector(".timeline-title").textContent = title;
  entry.querySelector(".timeline-state").textContent = kind;
  entry.querySelector(".timeline-body").textContent = body;
  tools.prepend(entry);
  return entry;
}

function addArtifactCard(card) {
  if (!card) return;
  // Render MCP UI components and visualizations inline in the chat transcript so
  // they stay in conversational context. The right inspector remains for logs.
  messages.appendChild(card);
  addTimelineEntry(`Rendered UI · ${card.querySelector(".mcp-title, .viz-title")?.textContent || "artifact"}`, "", "info");
  scrollDown();
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

// ---------------------------------------------------------------------------
// conversations — each browser tab is its own conversation; the left panel
// lists every conversation as a single entry (newest first), click to open.
// ---------------------------------------------------------------------------
function loadConvos() {
  try { return JSON.parse(localStorage.getItem(CONVOS_KEY) || "{}"); } catch { return {}; }
}
function saveConvos(store) {
  localStorage.setItem(CONVOS_KEY, JSON.stringify(store));
}
function newConvoId() {
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
function convoTitle() {
  const firstUser = messages.querySelector(".message.user");
  const t = (firstUser?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  return t || "New chat";
}

function saveHistorySoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentConvo, 120);
}
function saveCurrentConvo() {
  if (!currentConvoId) return;
  messages.querySelector(".empty-state")?.remove();
  const store = loadConvos();
  const hasContent = messages.querySelector(".message.user, .message.assistant, .viz-card, .mcp-card, .tool-chip, .file-card, .question-card");
  if (!hasContent) {
    delete store[currentConvoId];
  } else {
    store[currentConvoId] = { id: currentConvoId, title: convoTitle(), updatedAt: Date.now(), html: messages.innerHTML };
  }
  saveConvos(store);
  renderConversationList();
}

function resetTranscriptState() {
  currentAssistant = null;
  currentAssistantRaw = "";
  currentThinkingEl = null;
  currentThinkingRaw = "";
  toolRows.clear();
  toolCards.clear();
  toolChips.clear();
  renderedVizKeys.clear();
  pendingAttachments.length = 0;
  pendingQuestions.length = 0;
  activeQuestionIndex = 0;
  if (questionModal) { questionModal.classList.add("hidden"); questionModal.innerHTML = ""; }
}

function loadConversationInto(id) {
  const c = loadConvos()[id];
  currentConvoId = id;
  sessionStorage.setItem(CURRENT_CONVO_KEY, id);
  resetTranscriptState();
  renderAttachmentsBar();
  messages.innerHTML = c?.html || "";
  messageCounter = messages.children.length;
  if (!messages.children.length) showEmptyState();
  renderConversationList();
  scrollDown(true);
}

function openConversation(id) {
  if (id === currentConvoId) return;
  saveCurrentConvo();
  loadConversationInto(id);
  send({ type: "new_session" }); // fresh server session to continue chatting
}

function startNewConversation() {
  saveCurrentConvo();
  loadConversationInto(newConvoId());
  send({ type: "new_session" });
  addActivity("Started a new chat", "session");
}

// New tab → fresh conversation; same-tab reload → resume this tab's conversation.
function initConversation() {
  const existing = sessionStorage.getItem(CURRENT_CONVO_KEY);
  loadConversationInto(existing && loadConvos()[existing] ? existing : newConvoId());
}

function clearHistory() { startNewConversation(); }

function relTime(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function renderConversationList() {
  if (!historyList) return;
  const store = loadConvos();
  const items = Object.values(store).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // Always show the active conversation, even before its first message lands.
  if (currentConvoId && !store[currentConvoId]) {
    items.unshift({ id: currentConvoId, title: "New chat", updatedAt: Date.now() });
  }
  historyList.innerHTML = "";
  for (const c of items) {
    const btn = document.createElement("button");
    btn.className = "history-item convo" + (c.id === currentConvoId ? " active" : "");
    const title = document.createElement("span");
    title.className = "convo-title";
    title.textContent = c.title || "New chat";
    const time = document.createElement("span");
    time.className = "convo-time";
    time.textContent = relTime(c.updatedAt || Date.now());
    btn.append(title, time);
    btn.addEventListener("click", () => openConversation(c.id));
    historyList.appendChild(btn);
  }
}

// Keep the conversation list fresh when another tab adds/updates one.
window.addEventListener("storage", (e) => { if (e.key === CONVOS_KEY) renderConversationList(); });

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
      if (cwdInput && msg.cwd && document.activeElement !== cwdInput) cwdInput.value = msg.cwd;
      if (msg.cwd) { addWorkspaceFolder(msg.cwd); renderWorkspaceFolders(msg.cwd); }
      if (onlyEmptyState()) renderExistingMessages(msg.messages || []);
      if (msg.modelFallbackMessage) addMessage("system", msg.modelFallbackMessage);
      break;
    case "cwd":
      if (cwdInput) cwdInput.value = msg.cwd;
      if (msg.cwd) { addWorkspaceFolder(msg.cwd); renderWorkspaceFolders(msg.cwd); }
      addActivity(`Working directory: ${msg.cwd}`, "session");
      addMessage("system", `Working directory set to ${msg.cwd}`);
      break;
    case "file":
      addActivity(`Read file: ${msg.path}${msg.truncated ? " (truncated)" : ""}`, "tool");
      addFileAttachment(msg.path, msg.content, msg.truncated);
      break;
    case "status":
      status = msg.status;
      sendButton.disabled = status === "starting";
      addActivity(`Status: ${msg.status}`);
      scrollDown();
      break;
    case "log":
      renderServiceLog(msg);
      break;
    case "user":
      addActivity("User prompt sent", "user");
      addMessage("user", msg.text);
      break;
    case "assistant_start":
      addActivity("Assistant response started", "assistant");
      currentAssistant = addMessage("assistant", "");
      currentAssistant.classList.add("markdown", "assistant-loading");
      currentAssistant.innerHTML = thinkingDotsHtml();
      currentAssistantRaw = "";
      currentThinkingEl = null;
      currentThinkingRaw = "";
      break;
    case "assistant_delta":
      currentAssistantRaw += msg.delta;
      if (currentAssistant) currentAssistant.classList.remove("assistant-loading");
      renderCurrentAssistant();
      saveHistorySoon();
      break;
    case "thinking_delta":
      currentThinkingRaw += msg.delta || "";
      renderThinking();
      if (Date.now() - lastThinkingActivity > 1500) {
        lastThinkingActivity = Date.now();
        addActivity("Receiving thinking stream…", "thinking");
      }
      break;
    case "tool_start":
      addActivity(`Tool started: ${msg.toolName}`, "tool");
      renderToolChip(msg.toolCallId, msg.toolName, "running", msg.args, "");
      break;
    case "tool_update":
      addActivity(`Tool running: ${msg.toolName}`, "tool");
      renderToolChip(msg.toolCallId, msg.toolName, "running", msg.args, toolResultPreview(msg.partialResult));
      break;
    case "tool_end":
      addActivity(`Tool finished: ${msg.toolName}${msg.isError ? " (error)" : ""}`, msg.isError ? "error" : "tool");
      renderToolChip(msg.toolCallId, msg.toolName, msg.isError ? "error" : "done", undefined, toolResultPreview(msg.result));
      renderMcpUiResources(msg.result, msg.toolName);
      renderToolImages(msg.result, msg.toolName);
      break;
    case "viz":
      addActivity(`Rendering ${msg.viz?.length || 0} visual(s) from ${msg.toolName}`, "tool");
      renderServerViz(msg.viz || []);
      break;
    case "question":
      addActivity(`Question posed: ${msg.question?.id || ""}`, "tool");
      renderQuestion(msg.question);
      break;
    case "answer_saved":
      applyAnswerSaved(msg.record);
      break;
    case "question_marked":
      applyQuestionMark(msg);
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

// Viz tools render a chart card — that's the meaningful output, so don't also
// show a tool chip for them.
function isVizToolName(name) {
  return name === "visualize" || name === "viz_visualize" || /^(?:viz_)?render_/.test(name);
}
// Tools whose meaningful output is its own card (no redundant tool chip).
function isQuietToolName(name) {
  return isVizToolName(name) || name === "ask_question" || name === "mark_answer";
}

// Compact, collapsed-by-default tool chip (ChatGPT/Claude-style) instead of a
// big card. Keeps the window to meaningful messages; details on expand.
function toolTimelineLabel(toolName) {
  const n = String(toolName || "tool");
  if (/read|list|grep|search|find/i.test(n)) return `Inspect · ${n}`;
  if (/bash|shell|exec|command|terminal/i.test(n)) return `Run command · ${n}`;
  if (/write|edit|patch|apply/i.test(n)) return `Modify file · ${n}`;
  if (/ask_question/i.test(n)) return "Ask user";
  if (/mark_answer/i.test(n)) return "Mark answer";
  if (isVizToolName(n)) return `Render visualization · ${n}`;
  return `Tool · ${n}`;
}

function renderToolChip(id, toolName, state, args, output) {
  let chip = toolChips.get(id);
  if (!chip) {
    chip = document.createElement("details");
    chip.id = `msg-${++messageCounter}`;
    chip.innerHTML = `<summary><span class="tc-name"></span><span class="tc-state"></span></summary><pre class="tc-body"></pre>`;
    (tools || messages).prepend(chip);
    toolChips.set(id, chip);
  }
  if (args && Object.keys(args).length) chip.dataset.args = JSON.stringify(args, null, 2);
  chip.className = "tool-chip " + state;
  chip.querySelector(".tc-name").textContent = toolTimelineLabel(toolName);
  chip.querySelector(".tc-state").textContent = state === "done" ? "done" : state === "error" ? "error" : "running…";
  chip.querySelector(".tc-body").textContent = [chip.dataset.args, output].filter(Boolean).join("\n\n");
  showInspectorPanel();
  saveHistorySoon();
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

// Server-rendered viz fragments (from the @pi-harness/viz tools, carried in the
// tool result's `details`). Fragments are trusted, self-contained HTML/SVG with
// data values already escaped — and being static (no scripts/iframes) they also
// survive the localStorage history round-trip.
const VIZ_KIND_LABELS = {
  bar: "Bar chart", line: "Line chart", kpi: "KPI", table: "Table",
  network: "Network graph", sequence: "Sequence diagram", image: "Image",
  markdown: "Text", dashboard: "Dashboard",
};

function renderServerViz(items) {
  for (const item of items) {
    if (!item || typeof item.html !== "string") continue;
    const spec = item.spec || {};
    const card = document.createElement("section");
    card.className = "viz-card";
    card.id = `msg-${++messageCounter}`;

    const head = document.createElement("div");
    head.className = "viz-title";
    head.textContent = spec.title || VIZ_KIND_LABELS[spec.kind] || "Visualization";
    card.appendChild(head);

    // Interactive HTML in a sandboxed iframe (not a static SVG). srcdoc survives
    // the localStorage restore; the doc reports its height so we size the frame.
    const iframe = document.createElement("iframe");
    iframe.className = "viz-frame";
    iframe.sandbox = "allow-scripts";
    iframe.referrerPolicy = "no-referrer";
    iframe.srcdoc = item.html;
    card.appendChild(iframe);

    addArtifactCard(card);
    saveHistorySoon();
  }
}

// ---------------------------------------------------------------------------
// assessment questions (interactive MCQ / short-answer cards)
// ---------------------------------------------------------------------------
// Rendered as inline DOM (not iframes) so clicks work via event delegation and
// survive a localStorage restore; state is reflected in the saved HTML.
function ensureQuestionModal() {
  if (questionModal) return questionModal;
  questionModal = document.createElement("section");
  questionModal.id = "questionModal";
  questionModal.className = "question-modal hidden";
  (inputModalMount || form.parentElement).appendChild(questionModal);
  return questionModal;
}

function renderQuestion(spec) {
  if (!spec || !spec.id) return;
  const hadOpenQuestions = getOpenQuestions().length > 0;
  if (!pendingQuestions.some((q) => q.id === spec.id)) pendingQuestions.push({ ...spec, state: "open", answer: "" });
  // When several questions arrive from one LLM turn, keep the modal on the first
  // input instead of jumping to each newly appended question.
  if (!hadOpenQuestions) activeQuestionIndex = 0;
  renderQuestionModal();
  addActivity(`Input required: ${spec.type === "multiple_choice" ? "multiple choice" : "written answer"}`, "tool");
}

function getOpenQuestions() {
  return pendingQuestions.filter((q) => q.state === "open");
}

function renderQuestionModal() {
  const modal = ensureQuestionModal();
  const open = getOpenQuestions();
  if (!open.length) { modal.classList.add("hidden"); modal.innerHTML = ""; return; }
  if (activeQuestionIndex < 0 || activeQuestionIndex >= open.length) activeQuestionIndex = 0;
  const q = open[activeQuestionIndex];
  const tabs = open.length > 1 ? `<div class="q-tabs">${open.map((item, i) =>
    `<button type="button" class="q-tab ${i === activeQuestionIndex ? "active" : ""}" data-qtab="${i}">Input ${i + 1}</button>`
  ).join("")}</div>` : "";
  const body = q.type === "multiple_choice"
    ? `<div class="q-choices modal-choices">${(q.choices || []).map((c) =>
        `<button type="button" class="q-choice ${q.answerValue === c.id ? "selected" : ""}" data-choice="${escapeHtml(c.id)}"><span class="q-choice-id">${escapeHtml(c.id)}</span><span class="q-choice-text">${escapeHtml(c.text)}</span></button>`
      ).join("")}</div>`
    : `<textarea class="q-input modal-input" rows="4" placeholder="Type your answer…">${escapeHtml(q.answer || "")}</textarea>`;
  modal.classList.remove("hidden");
  modal.dataset.qid = q.id;
  modal.dataset.qtype = q.type;
  modal.innerHTML = `<div class="q-modal-shell">
    <div class="q-modal-head"><div><span class="q-kicker">Input required</span><strong>${escapeHtml(q.type === "multiple_choice" ? "Choose an answer" : "Written response")}</strong></div><span class="q-count">${activeQuestionIndex + 1}/${open.length}</span></div>
    ${tabs}
    <div class="q-prompt"></div>
    <div class="q-body">${body}</div>
    <div class="q-result hidden"></div>
    <div class="q-actions">${open.length > 1 && activeQuestionIndex < open.length - 1 ? `<button type="button" class="q-next">Next input</button>` : ""}<button type="button" class="q-submit">${open.length > 1 ? "Submit all to Pi" : "Submit to Pi"}</button></div>
  </div>`;
  modal.querySelector(".q-prompt").textContent = q.question;
  const firstInput = modal.querySelector(q.type === "multiple_choice" ? ".q-choice" : ".q-input");
  setTimeout(() => firstInput?.focus?.(), 0);
}

function currentOpenQuestion() {
  const open = getOpenQuestions();
  return open[activeQuestionIndex] || open[0];
}

function setQResultInModal(text, cls) {
  const res = questionModal?.querySelector(".q-result");
  if (!res) return;
  res.className = `q-result ${cls || ""}`.trim();
  res.textContent = text;
}

function collectQuestionAnswer(q, visibleModal = false) {
  if (!q) return null;
  if (q.type === "multiple_choice") {
    if (visibleModal && questionModal?.dataset.qid === q.id) {
      const sel = questionModal.querySelector(".q-choice.selected");
      if (sel) {
        q.answerValue = sel.dataset.choice;
        q.answer = `${sel.dataset.choice}. ${sel.querySelector(".q-choice-text")?.textContent || ""}`.trim();
      }
    }
    if (!q.answerValue) return null;
    return { questionId: q.id, value: q.answerValue, text: q.answer };
  }
  if (visibleModal && questionModal?.dataset.qid === q.id) {
    const ta = questionModal.querySelector(".q-input");
    q.answer = (ta?.value || "").trim();
  }
  if (!q.answer) return null;
  return { questionId: q.id, value: q.answer, text: q.answer };
}

function saveVisibleQuestionDraft() {
  const q = currentOpenQuestion();
  if (!q || !questionModal) return;
  collectQuestionAnswer(q, true);
}

function goToNextQuestionIfAny() {
  const open = getOpenQuestions();
  if (activeQuestionIndex < open.length - 1) {
    activeQuestionIndex++;
    renderQuestionModal();
    return true;
  }
  return false;
}

function submitQuestionFromModal() {
  if (!questionModal) return;
  const current = currentOpenQuestion();
  collectQuestionAnswer(current, true);
  const open = getOpenQuestions();
  const answers = [];
  for (let i = 0; i < open.length; i++) {
    const ans = collectQuestionAnswer(open[i], false);
    if (!ans) {
      activeQuestionIndex = i;
      renderQuestionModal();
      setQResultInModal(open[i].type === "multiple_choice" ? "Answer every tab before submitting." : "Type an answer on every tab before submitting.", "hint");
      return;
    }
    answers.push(ans);
  }
  for (const q of open) q.state = "submitted";
  send(answers.length === 1 ? { type: "answer", ...answers[0] } : { type: "answer_batch", answers });
  addMessage("system", `Submitted ${answers.length} answer${answers.length === 1 ? "" : "s"} to Pi for marking.`);
  activeQuestionIndex = 0;
  renderQuestionModal();
  saveHistorySoon();
}

function applyAnswerSaved(rec) {
  if (!rec) return;
  const q = pendingQuestions.find((item) => item.id === rec.questionId);
  if (q) q.state = "saved";
  renderQuestionModal();
  const suffix = rec.autoMark ? ` · ${rec.autoMark.correct ? "auto-check correct" : "auto-check incorrect"}` : "";
  addMessage("system", `Answer saved for ${rec.questionId}${suffix}. Awaiting marking…`);
}

function applyQuestionMark(msg) {
  const m = msg.mark || {};
  const bits = [];
  if (m.correct != null) bits.push(m.correct ? "✓ Correct" : "✗ Incorrect");
  if (m.score != null) bits.push(`Score ${Math.round(m.score * 100)}%`);
  const text = [`Marked ${msg.questionId}: ${bits.join(" · ") || "Marked"}`, m.feedback].filter(Boolean).join("\n");
  addMessage(m.correct === false ? "error" : "system", text);
  saveHistorySoon();
}

// ---------------------------------------------------------------------------
// markdown + streaming render
// ---------------------------------------------------------------------------
// Compact, XSS-safe markdown: code blocks are pulled out, everything else is
// HTML-escaped before any inline formatting is applied, and links are limited
// to http(s). Enough for chat (code, lists, headings, bold/italic, links).
function renderLatex(tex, displayMode = false) {
  try {
    if (window.katex) return window.katex.renderToString(tex, { displayMode, throwOnError: false, strict: "ignore" });
  } catch {}
  return `<span class="latex-fallback ${displayMode ? "display" : ""}">${escapeHtml(tex)}</span>`;
}

function renderMarkdown(md) {
  if (!md) return "";
  const blocks = [];
  const math = [];
  let src = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    blocks.push(code);
    return `@@CB${blocks.length - 1}@@`;
  });
  src = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => { math.push({ tex, display: true }); return `@@MATH${math.length - 1}@@`; })
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => { math.push({ tex, display: true }); return `@@MATH${math.length - 1}@@`; })
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => { math.push({ tex, display: false }); return `@@MATH${math.length - 1}@@`; })
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, tex) => { math.push({ tex, display: false }); return `${pre}@@MATH${math.length - 1}@@`; });
  src = escapeHtml(src)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  const lines = src.split(/\n/);
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const line of lines) {
    if (/^@@CB\d+@@$/.test(line.trim())) { closeList(); html += line.trim(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length}>${h[2]}</h${h[1].length}>`; }
    else if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); html += `<p>${line}</p>`; }
  }
  closeList();
  return html
    .replace(/@@CB(\d+)@@/g, (_, i) =>
      `<pre class="code"><button class="copy" type="button">copy</button><code>${escapeHtml(blocks[+i])}</code></pre>`)
    .replace(/@@MATH(\d+)@@/g, (_, i) => renderLatex(math[+i]?.tex || "", !!math[+i]?.display));
}

function thinkingDotsHtml(label = "") {
  return `${label ? `<span class="thinking-dots-label">${escapeHtml(label)}</span>` : ""}<span class="thinking-dots" aria-label="Thinking"><i></i><i></i><i></i></span>`;
}

function renderCurrentAssistant() {
  if (assistantRenderPending) return;
  assistantRenderPending = true;
  requestAnimationFrame(() => {
    assistantRenderPending = false;
    if (!currentAssistant) { currentAssistant = addMessage("assistant", ""); currentAssistant.classList.add("markdown"); }
    currentAssistant.classList.remove("assistant-loading");
    currentAssistant.innerHTML = renderMarkdown(currentAssistantRaw);
    scrollDown();
  });
}

// Collapsible "Thinking" disclosure shown above the assistant answer.
function renderThinking() {
  if (!currentThinkingEl) {
    currentThinkingEl = document.createElement("details");
    currentThinkingEl.className = "thinking";
    const sum = document.createElement("summary");
    sum.textContent = "Thinking";
    const body = document.createElement("div");
    body.className = "thinking-body";
    currentThinkingEl.append(sum, body);
    if (currentAssistant && currentAssistant.parentNode === messages) messages.insertBefore(currentThinkingEl, currentAssistant);
    else messages.appendChild(currentThinkingEl);
  }
  currentThinkingEl.querySelector(".thinking-body").textContent = currentThinkingRaw;
  scrollDown();
  saveHistorySoon();
}

function addAssistantMarkdown(text) {
  const el = addMessage("assistant", "");
  el.classList.add("markdown");
  el.innerHTML = renderMarkdown(text);
  return el;
}

// Raw image content blocks from a tool result (e.g. a generated chart/screenshot).
function renderToolImages(result, toolName = "tool") {
  const content = result?.content;
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (item?.type !== "image" || typeof item.data !== "string") continue;
    const src = item.data.startsWith("data:") ? item.data : `data:${item.mimeType || "image/png"};base64,${item.data}`;
    const card = document.createElement("section");
    card.className = "viz-card";
    card.id = `msg-${++messageCounter}`;
    const head = document.createElement("div");
    head.className = "viz-title";
    head.textContent = `Image · ${toolName}`;
    const body = document.createElement("div");
    body.className = "viz-body";
    const img = document.createElement("img");
    img.src = src;
    img.alt = `image from ${toolName}`;
    img.style.cssText = "max-width:100%;height:auto;border-radius:10px;border:1px solid var(--border)";
    body.appendChild(img);
    card.append(head, body);
    messages.appendChild(card);
    scrollDown();
    saveHistorySoon();
  }
}

function showEmptyState() {
  if (messages.children.length) return;
  const es = document.createElement("div");
  es.className = "empty-state";
  es.innerHTML = `<img src="/pi-logo.svg" alt="Pi logo" class="empty-logo" />
    <h2>Design-forward Pi chat</h2>
    <p>A focused agent workspace with restrained contrast, clear hierarchy, and interactive visuals. Try one of these:</p>
    <div class="examples"></div>
    <p class="muted">No-LLM demos: <code>/demo-visualize</code> · <code>/demo-chart</code> · <code>/demo-network</code> · <code>/demo-sequence</code> · <code>/demo-ui</code></p>`;
  const examples = es.querySelector(".examples");
  for (const text of ["Summarize what this repo does and list the main files.", "Query some data and visualize the result."]) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", () => { input.value = text; input.focus(); });
    examples.appendChild(b);
  }
  messages.appendChild(es);
}

function maybeClearEmptyState() {
  const es = messages.querySelector(".empty-state");
  if (es && messages.children.length > 1) es.remove();
}

function onlyEmptyState() {
  return !messages.children.length ||
    (messages.children.length === 1 && messages.firstElementChild?.classList.contains("empty-state"));
}

// ---------------------------------------------------------------------------
// file attachments (read into chat from the working directory)
// ---------------------------------------------------------------------------
function addFileAttachment(filePath, content, truncated, meta = {}) {
  pendingAttachments.push({ path: filePath, content, ...meta });
  renderAttachmentsBar();
  const card = document.createElement("details");
  card.className = "file-card";
  card.id = `msg-${++messageCounter}`;
  card.innerHTML = `<summary><span class="fc-name"></span><span class="fc-meta"></span></summary><pre class="fc-body"></pre>`;
  const isImage = String(meta.mime || "").startsWith("image/");
  card.querySelector(".fc-name").textContent = `${isImage ? "🖼️" : content ? "📄" : "📦"} ${filePath}`;
  card.querySelector(".fc-meta").textContent = `${meta.mime || "text/plain"} · ${formatBytes(meta.size || (content || "").length)}${truncated ? " · text truncated" : ""} · attached to next message`;
  card.querySelector(".fc-body").textContent = content || `Binary/non-text upload. It will be saved server-side and the saved path will be sent to ChatGPT 5.5.`;
  messages.appendChild(card);
  scrollDown();
  saveHistorySoon();
}

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function renderAttachmentsBar() {
  if (!attachmentsBar) return;
  attachmentsBar.innerHTML = "";
  if (!pendingAttachments.length) { attachmentsBar.classList.add("hidden"); return; }
  attachmentsBar.classList.remove("hidden");
  const label = document.createElement("span");
  label.className = "att-label";
  label.textContent = `📎 ${pendingAttachments.length} attached`;
  attachmentsBar.appendChild(label);
  pendingAttachments.forEach((a, i) => {
    const chip = document.createElement("span");
    chip.className = "att-chip";
    const name = document.createElement("span");
    name.className = "att-name";
    name.textContent = a.path;
    name.title = a.path;
    const size = document.createElement("span");
    size.className = "att-size";
    size.textContent = formatBytes(a.size || (a.content || "").length);
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "Remove attachment";
    x.addEventListener("click", () => { pendingAttachments.splice(i, 1); renderAttachmentsBar(); });
    chip.append(name, size, x);
    attachmentsBar.appendChild(chip);
  });
}

// Likely-binary detection so we don't attach garbled bytes as "text".
function looksBinary(sample) {
  if (sample.indexOf(String.fromCharCode(0)) !== -1) return true;
  const n = Math.min(sample.length, 2000);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd || c < 9 || (c > 13 && c < 32)) bad++;
  }
  return n > 0 && bad / n > 0.1;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isLikelyTextFile(file) {
  const mime = (file.type || "").toLowerCase();
  return mime.startsWith("text/") || ["application/json", "application/xml", "application/javascript", "application/x-yaml", "application/yaml"].includes(mime) || /\.(txt|md|csv|json|xml|ya?ml|js|ts|tsx|jsx|py|html|css|sql|log)$/i.test(file.name);
}

// Read files chosen via the picker or dropped onto the chat. Any file type is
// accepted. Text gets included in the prompt; binary files are uploaded to the
// server and exposed to ChatGPT 5.5 as a saved path. Images are also sent as
// image inputs when the selected model supports vision.
async function attachFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (file.size > MAX_UPLOAD_BYTES) {
      addMessage("error", `Can't attach “${file.name}” — max upload is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const dataBase64 = arrayBufferToBase64(buffer);
      let content = "";
      let truncated = false;
      if (isLikelyTextFile(file)) {
        content = await file.text();
        if (looksBinary(content.slice(0, 4000))) content = "";
        if (content.length > MAX_ATTACH_BYTES) { content = content.slice(0, MAX_ATTACH_BYTES); truncated = true; }
      }
      addActivity(`Attached upload: ${file.name} · ${file.type || "application/octet-stream"} · ${formatBytes(file.size)}${content ? " · text included" : " · binary/path mode"}`, "tool");
      addFileAttachment(file.name, content, truncated, {
        mime: file.type || "application/octet-stream",
        size: file.size,
        dataBase64,
      });
    } catch (error) {
      addMessage("error", `Failed to read “${file.name}”: ${error.message || error}`);
    }
  }
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
  // Report content height so the host can size this frame to fit (no fixed height).
  function reportSize() { send('resize', { height: Math.ceil(document.documentElement.scrollHeight) }); }
  window.addEventListener('load', reportSize);
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.documentElement);
  setTimeout(reportSize, 50);
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
  // Use srcdoc (not a blob: URL): the HTML is inline, so the frame re-renders
  // after a localStorage history restore, with no object-URL lifetime to manage.
  iframe.srcdoc = html;
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
  // No allow-same-origin: MCP UI HTML is third-party code; it talks to us only
  // via postMessage, so it must not reach the parent origin/DOM.
  iframe.sandbox = "allow-scripts allow-forms allow-popups allow-modals";
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
  addArtifactCard(card);
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

// Tools the host may run directly on a widget's behalf — pure viz renderers.
// Mirrors isHostExecutableViz on the server (which re-validates and errors out).
function isHostViz(name) {
  return name === "visualize" || name === "viz_visualize" || /^(?:viz_)?render_/.test(name);
}

function handleMcpUiAction(action, source) {
  if (!action || typeof action !== "object") return;
  const payload = action.payload || {};
  if (action.type === "prompt" && payload.prompt) {
    send({ type: "prompt", message: String(payload.prompt), streamingBehavior: status === "running" ? "followUp" : undefined });
    postIframeAck(source, action);
  } else if (action.type === "tool") {
    // Run allowlisted viz tools directly (no model, no injection); refuse the rest.
    const toolName = String(payload.toolName || "");
    if (isHostViz(toolName)) {
      send({ type: "viz_tool", name: toolName, params: payload.params || {} });
    } else {
      addMessage("system", `Widget requested tool "${toolName || "(unnamed)"}" — not auto-run for safety. Ask Pi to run it if you want it executed.`);
    }
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
    send({ type: "viz_tool", name: "visualize", params: { data: payload, hint: { kind: "bar", title: payload.title } } });
    postIframeAck(source, action);
  } else if (action.type === "network") {
    send({ type: "viz_tool", name: "visualize", params: { data: payload, hint: { kind: "network", title: payload.title } } });
    postIframeAck(source, action);
  } else if (action.type === "sequence") {
    send({ type: "viz_tool", name: "visualize", params: { data: payload, hint: { kind: "sequence", title: payload.title } } });
    postIframeAck(source, action);
  }
}

window.addEventListener("message", (event) => {
  // MCP-UI adapters commonly post { type, payload }, { detail: { type, payload } },
  // or { event: '...', data: ... }. Normalize the common shapes.
  const raw = event.data?.detail || event.data;
  const data = raw?.type ? raw : raw?.action ? { type: raw.action, payload: raw.payload || raw.data, messageId: raw.messageId } : raw?.event ? { type: raw.event, payload: raw.payload || raw.data, messageId: raw.messageId } : raw;
  if (data?.type === "resize" && Number.isFinite(Number(data.payload?.height))) {
    resizeMcpFrame(event.source, Number(data.payload.height));
    return;
  }
  if (["tool", "prompt", "intent", "notify", "link", "chart", "network", "sequence"].includes(data?.type)) {
    handleMcpUiAction(data, event.source);
  }
});

function resizeMcpFrame(source, height) {
  const h = Math.max(80, Math.min(2000, Math.round(height)));
  for (const frame of document.querySelectorAll("iframe.mcp-frame, iframe.viz-frame")) {
    if (frame.contentWindow === source) {
      frame.style.height = h + "px";
      break;
    }
  }
}

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

// Auto-render fenced viz blocks from assistant/user text, routed through the
// server viz path so they render as interactive iframes (one renderer).
function renderVisualizationBlocks(text) {
  const blockPattern = /```(chart-json|bar-chart|line-json|pie-json|network-json|network|sequence-json|sequence|table-json|kpi-json)\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = blockPattern.exec(text))) {
    const kind = match[1].toLowerCase();
    const json = match[2].trim();
    const key = `${kind}:${hashText(json)}`;
    if (renderedVizKeys.has(key)) continue;
    renderedVizKeys.add(key);
    let data;
    try { data = JSON.parse(json); } catch (error) { addMessage("error", `Could not parse ${kind}: ${error.message}`); continue; }
    const hintKind = kind.includes("network") ? "network"
      : kind.includes("sequence") ? "sequence"
      : kind.includes("line") ? "line"
      : kind.includes("pie") ? "pie"
      : kind.includes("table") ? "table"
      : kind.includes("kpi") ? "kpi"
      : "bar";
    send({ type: "viz_tool", name: "visualize", params: { data, hint: { kind: hintKind } } });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function renderDemoChart() {
  send({
    type: "demo_viz",
    data: {
      title: "Sample LNG train throughput",
      data: [
        { label: "Jan", value: 84 }, { label: "Feb", value: 91 }, { label: "Mar", value: 76 },
        { label: "Apr", value: 103 }, { label: "May", value: 117 }, { label: "Jun", value: 98 },
      ],
    },
  });
}

function renderDemoSequence() {
  send({
    type: "demo_viz",
    data: {
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
        { from: "Web Chat", to: "User", label: "render text, charts, MCP UI", type: "response" },
      ],
    },
  });
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
  send({
    type: "demo_viz",
    data: {
      title: "Sample graph-db asset network",
      nodes: [
        { id: "tank", label: "Tank", group: "storage" },
        { id: "pump", label: "Pump", group: "equipment" },
        { id: "valve", label: "Valve", group: "equipment" },
        { id: "train", label: "Train", group: "process" },
        { id: "meter", label: "Meter", group: "instrument" },
      ],
      edges: [
        { source: "tank", target: "pump", label: "feeds" },
        { source: "pump", target: "valve", label: "pressurizes" },
        { source: "valve", target: "train", label: "controls" },
        { source: "meter", target: "valve", label: "measures" },
        { source: "meter", target: "train", label: "reports" },
      ],
    },
  });
}

function renderDemoNetworkRecords() {
  send({
    type: "demo_viz",
    data: {
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
    ],
    },
  });
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
        <button style="padding:10px 14px;border-radius:10px;border:0;background:#50B848;color:white;font-weight:700" onclick="parent.postMessage({type:'tool',payload:{toolName:'visualize',params:{data:[{label:'Q1',value:120},{label:'Q2',value:180},{label:'Q3',value:150}],hint:{title:'Rendered via host viz tool'}}}},'*')">Render a chart (host tool)</button>
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
      if (text) addAssistantMarkdown(text);
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  autoFollow = true; // jump back to the latest when the user sends
  currentAssistant = null;
  if (message === "/demo-ui") {
    renderDemoMcpUi();
    return;
  }
  if (message === "/demo-input-required") {
    renderQuestion({ id: `demo-q-${Date.now()}`, type: "multiple_choice", question: "Which UI pattern should we use for user-required input?", choices: [
      { id: "A", text: "Inline card in the transcript" },
      { id: "B", text: "Modal above the composer" },
      { id: "C", text: "Browser alert" }
    ] });
    return;
  }
  if (message === "/demo-input-tabs") {
    renderQuestion({ id: `demo-q1-${Date.now()}`, type: "multiple_choice", question: "Pick a chart type for production data.", choices: [
      { id: "A", text: "Bar chart" }, { id: "B", text: "Network graph" }, { id: "C", text: "Sequence diagram" }
    ] });
    renderQuestion({ id: `demo-q2-${Date.now()}`, type: "short_answer", question: "What extra context should Pi consider?" });
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
  if (message === "/demo-visualize" || message === "/demo-viz") {
    addActivity("Requesting server-rendered viz (orchestrator)", "tool");
    send({ type: "demo_viz" });
    return;
  }
  if (message === "/demo-network-records" || message === "/demo-network-alt") {
    renderDemoNetworkRecords();
    return;
  }
  renderVisualizationBlocks(message);
  const attachments = pendingAttachments.slice();
  addPromptTurn(message, attachments);
  send({
    type: "prompt",
    message,
    approvalPolicy: approvalPolicyText(),
    attachments: attachments.length ? attachments : undefined,
    streamingBehavior: status === "running" ? "followUp" : undefined,
  });
  pendingAttachments.length = 0;
  renderAttachmentsBar();
});

const COMMANDS = [
  { id: "focus", title: "Focus composer", hint: "Jump back to input", run: () => input?.focus() },
  { id: "search", title: "Search transcript", hint: "Find text in the current chat", run: () => openTranscriptSearch() },
  { id: "copy", title: "Copy transcript", hint: "Copy visible chat text", run: () => copyTranscript() },
  { id: "export", title: "Export transcript", hint: "Download chat as Markdown", run: () => exportTranscript() },
  { id: "latest", title: "Jump to latest", hint: "Resume auto-scroll", run: () => jumpToLatest() },
  { id: "abort", title: "Abort run", hint: "Stop the current response", run: () => send({ type: "abort" }) },
  { id: "new", title: "New conversation", hint: "Clear chat and start fresh", run: () => newSessionButton?.click() },
  { id: "theme", title: "Toggle theme", hint: "Light/dark mode", run: () => themeBtn?.click() },
  { id: "clearTimeline", title: "Clear timeline", hint: "Clear runtime log panel", run: () => { if (tools) tools.innerHTML = ""; } },
  { id: "demoInputs", title: "Demo: input tabs", hint: "Show batched user input modal", run: () => { input.value = "/demo-input-tabs"; form.requestSubmit(); } },
  { id: "demoNetwork", title: "Demo: network UI", hint: "Show draggable network component", run: () => { input.value = "/demo-network"; form.requestSubmit(); } },
  { id: "learningStudy", title: "Optimal Learning: study", hint: "Start Study Mode for the selected topic", run: () => { if (learningMode) learningMode.value = "study"; submitSystemPrompt(buildOptimalLearningPrompt("start"), "Optimal Learning study mode"); } },
  { id: "learningTest", title: "Optimal Learning: test", hint: "Start Test Mode retrieval practice", run: () => { if (learningMode) learningMode.value = "test"; submitSystemPrompt(buildOptimalLearningPrompt("start"), "Optimal Learning test mode"); } },
  { id: "learningPretest", title: "Optimal Learning: pre-test", hint: "Generate batched calibrated pre-test questions", run: () => submitSystemPrompt(buildOptimalLearningPrompt("pretest"), "Optimal Learning pre-test") },
];

function transcriptText() {
  return Array.from(messages.querySelectorAll(".message, .viz-title, .mcp-title, .tool-chip summary"))
    .map((el) => el.textContent?.trim())
    .filter(Boolean)
    .join("\n\n");
}
async function copyTranscript() {
  await navigator.clipboard?.writeText(transcriptText());
  addActivity("Transcript copied", "session");
}
function exportTranscript() {
  const blob = new Blob([transcriptText()], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `process-ai-harness-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  addActivity("Transcript exported", "session");
}

function submitSystemPrompt(message, label = "Prompt") {
  addPromptTurn(message, []);
  addActivity(label, "session");
  autoFollow = true;
  send({
    type: "prompt",
    message,
    approvalPolicy: approvalPolicyText(),
    streamingBehavior: status === "running" ? "followUp" : undefined,
  });
}

function buildOptimalLearningPrompt(kind = "start") {
  const mode = learningMode?.value || "study";
  const topic = (learningTopic?.value || "").trim() || "the selected material";
  const depth = learningDepth?.value || "Strategic + Tactical";
  const vault = (learningVault?.value || cwdInput?.value || "").trim() || "the current workspace folder";
  localStorage.setItem("optimal-learning-topic", topic);
  localStorage.setItem("optimal-learning-depth", depth);
  localStorage.setItem("optimal-learning-vault", vault);
  localStorage.setItem("optimal-learning-mode", mode);
  const action = kind === "pretest" ? "Generate the calibrated pre-test now" : mode === "study" ? "Start Study Mode" : "Start Test Mode";
  return `Use the optimal-learning skill workflow.\n\nAction: ${action}\nMode: ${mode === "study" ? "Study Mode" : "Test Mode"}\nTopic: ${topic}\nOperating depth: ${depth}\nVault / notes folder: ${vault}\n\nFollow these rules:\n- Use Strategic / Tactical / Technical concept tagging.\n- If the operating depth is Strategic + Tactical, actively teach/test Strategic and Tactical; keep Technical reference-only unless essential.\n- For Study Mode: discover vault conventions, read related existing notes/trackers, then create a pre-test before giving feedback or study notes.\n- For Test Mode: read or create _knowledge-tracker/[topic]-tracker.md, run diagnostic retrieval practice, update gaps/mastery, and recommend next spacing.\n- Use ask_question for all user inputs, pre-test questions, diagnostic questions, confidence checks, and approvals so the UI modal captures answers.\n- When asking multiple pre-test questions, call ask_question multiple times in one turn; the UI will batch answers before feedback.\n- Do not give answer feedback until all pre-test answers have been submitted.\n- Save outputs into the vault where appropriate: study notes, pre-test, post-study quiz, NotebookLM prompts, and tracker files.\n\nBegin now. If required information is missing, ask concise questions using ask_question.`;
}

function syncLearningUi() {
  const mode = learningMode?.value || "study";
  const depth = learningDepth?.value || "Strategic + Tactical";
  document.querySelectorAll("[data-learning-mode]").forEach((b) => b.classList.toggle("active", b.dataset.learningMode === mode));
  document.querySelectorAll("[data-depth]").forEach((b) => b.classList.toggle("active", b.dataset.depth === depth));
  if (learningStatus) learningStatus.textContent = mode === "study" ? "Study" : "Test";
  if (learningHint) learningHint.textContent = mode === "study"
    ? "Study mode: calibrate depth, pre-test first, then generate vault notes, podcast prompts and a post-study quiz."
    : "Test mode: read the knowledge tracker, find your edge, update gaps, and schedule the next retrieval session.";
}

function restoreLearningPrefs() {
  if (learningTopic) learningTopic.value = localStorage.getItem("optimal-learning-topic") || "";
  if (learningDepth) learningDepth.value = localStorage.getItem("optimal-learning-depth") || learningDepth.value;
  if (learningVault) learningVault.value = localStorage.getItem("optimal-learning-vault") || "";
  if (learningMode) learningMode.value = localStorage.getItem("optimal-learning-mode") || learningMode.value;
  syncLearningUi();
}

function openCommandPalette() {
  const modal = document.createElement("div");
  modal.className = "command-modal";
  modal.innerHTML = `<div class="command-shell" role="dialog" aria-label="Command palette">
    <div class="command-head"><strong>Process AI Harness commands</strong><span>⌘K / Ctrl+K</span></div>
    <input class="command-input" placeholder="Search commands…" autocomplete="off" />
    <div class="command-list"></div>
  </div>`;
  document.body.appendChild(modal);
  const q = modal.querySelector(".command-input");
  const list = modal.querySelector(".command-list");
  const close = () => modal.remove();
  const render = () => {
    const needle = q.value.trim().toLowerCase();
    const matches = COMMANDS.filter((c) => !needle || `${c.title} ${c.hint}`.toLowerCase().includes(needle));
    list.innerHTML = matches.map((c, i) => `<button type="button" class="command-item ${i === 0 ? "active" : ""}" data-command="${escapeHtml(c.id)}"><strong>${escapeHtml(c.title)}</strong><span>${escapeHtml(c.hint)}</span></button>`).join("");
  };
  q.addEventListener("input", render);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
    const item = event.target.closest?.(".command-item");
    if (item) { const cmd = COMMANDS.find((c) => c.id === item.dataset.command); close(); cmd?.run(); }
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Enter") { const item = modal.querySelector(".command-item.active") || modal.querySelector(".command-item"); if (item) item.click(); }
  });
  render();
  setTimeout(() => q.focus(), 0);
}

function openTranscriptSearch() {
  const query = prompt("Search transcript");
  if (!query) return;
  const nodes = Array.from(messages.querySelectorAll(".message"));
  const hit = nodes.find((el) => el.textContent.toLowerCase().includes(query.toLowerCase()));
  if (!hit) { addActivity(`No transcript match for: ${query}`, "info"); return; }
  autoFollow = false;
  hit.classList.add("search-hit");
  hit.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => hit.classList.remove("search-hit"), 2200);
}

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === "k") { event.preventDefault(); openCommandPalette(); }
  if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); openTranscriptSearch(); }
  if (event.key === "Escape" && status === "running") send({ type: "abort" });
});

abortButton.addEventListener("click", () => send({ type: "abort" }));
newSessionButton.addEventListener("click", () => {
  if (tools) tools.innerHTML = "";
  if (artifacts) artifacts.innerHTML = "";
  if (promptTurns) promptTurns.innerHTML = "";
  showInspectorPanel();
  startNewConversation();
});

// Workspace controls: set working directory + read a file into chat.
function setCwd() {
  const v = (cwdInput?.value || "").trim();
  if (v) { send({ type: "set_cwd", cwd: v }); addActivity(`Setting working directory: ${v}`, "session"); }
}
function readFileIntoChat() {
  const v = (fileInput?.value || "").trim();
  if (v) { send({ type: "read_file", path: v }); fileInput.value = ""; }
}
function workspaceFolders() {
  try { return JSON.parse(localStorage.getItem("process-ai-folders") || "[]"); } catch { return []; }
}
function saveWorkspaceFolders(folders) {
  localStorage.setItem("process-ai-folders", JSON.stringify([...new Set(folders.filter(Boolean))].slice(0, 20)));
}
function renderWorkspaceFolders(active = cwdInput?.value || "") {
  if (!folderList) return;
  const folders = workspaceFolders();
  folderList.innerHTML = folders.length ? folders.map((f) => `<button type="button" class="folder-item ${f === active ? "active" : ""}" data-folder="${escapeHtml(f)}"><span>${escapeHtml(f)}</span><b data-remove-folder="${escapeHtml(f)}">×</b></button>`).join("") : `<div class="folder-empty">No folders added yet.</div>`;
}
function addWorkspaceFolder(folder) {
  const folders = workspaceFolders();
  saveWorkspaceFolders([folder, ...folders.filter((f) => f !== folder)]);
  renderWorkspaceFolders(folder);
}
cwdSetBtn?.addEventListener("click", () => { const v = (cwdInput?.value || "").trim(); if (v) addWorkspaceFolder(v); setCwd(); });
cwdInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = (cwdInput?.value || "").trim(); if (v) addWorkspaceFolder(v); setCwd(); } });
folderList?.addEventListener("click", (event) => {
  const remove = event.target.closest?.("[data-remove-folder]");
  if (remove) {
    const folder = remove.dataset.removeFolder;
    saveWorkspaceFolders(workspaceFolders().filter((f) => f !== folder));
    renderWorkspaceFolders(cwdInput?.value || "");
    return;
  }
  const item = event.target.closest?.(".folder-item");
  if (item?.dataset.folder) { cwdInput.value = item.dataset.folder; setCwd(); renderWorkspaceFolders(item.dataset.folder); }
});
renderWorkspaceFolders();
fileReadBtn?.addEventListener("click", readFileIntoChat);
fileInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); readFileIntoChat(); } });
restoreLearningPrefs();
document.querySelectorAll("[data-learning-mode]").forEach((btn) => btn.addEventListener("click", () => {
  if (learningMode) learningMode.value = btn.dataset.learningMode;
  buildOptimalLearningPrompt("prefs");
  syncLearningUi();
}));
document.querySelectorAll("[data-depth]").forEach((btn) => btn.addEventListener("click", () => {
  if (learningDepth) learningDepth.value = btn.dataset.depth;
  buildOptimalLearningPrompt("prefs");
  syncLearningUi();
}));
useWorkspaceVaultBtn?.addEventListener("click", () => {
  if (learningVault) learningVault.value = cwdInput?.value || "";
  buildOptimalLearningPrompt("prefs");
});
startLearningBtn?.addEventListener("click", () => submitSystemPrompt(buildOptimalLearningPrompt("start"), `Optimal Learning ${learningMode?.value || "study"} mode`));
pretestLearningBtn?.addEventListener("click", () => submitSystemPrompt(buildOptimalLearningPrompt("pretest"), "Optimal Learning pre-test"));
for (const el of [learningMode, learningDepth]) el?.addEventListener("change", () => { buildOptimalLearningPrompt("prefs"); syncLearningUi(); });
for (const el of [learningTopic, learningVault]) el?.addEventListener("blur", () => buildOptimalLearningPrompt("prefs"));

// Upload files from the computer (picker).
attachBtn?.addEventListener("click", () => fileUpload?.click());
fileUpload?.addEventListener("change", () => { attachFiles(fileUpload.files); fileUpload.value = ""; });

// Drag-and-drop files. Window-level + relatedTarget-null detection (no fragile
// enter/leave depth counter): show while files are dragged over the page, hide
// only when the drag leaves the window, drops, or ends.
if (dropzone) {
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const showDrop = () => dropzone.classList.remove("hidden");
  const hideDrop = () => dropzone.classList.add("hidden");
  window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { e.preventDefault(); showDrop(); } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", (e) => { if (e.relatedTarget === null) hideDrop(); }); // left the window
  window.addEventListener("dragend", hideDrop);
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hideDrop();
    if (e.dataTransfer?.files?.length) attachFiles(e.dataTransfer.files);
  });
}

// Delegated clicks on rendered content (survives localStorage restore):
// code-copy buttons + interactive question cards.
messages.addEventListener("click", (event) => {
  const copyBtn = event.target.closest?.(".copy");
  if (copyBtn) {
    const code = copyBtn.parentElement?.querySelector("code");
    if (code && navigator.clipboard) {
      navigator.clipboard.writeText(code.textContent).then(() => {
        copyBtn.textContent = "copied";
        setTimeout(() => { copyBtn.textContent = "copy"; }, 1200);
      }).catch(() => {});
    }
    return;
  }
});

document.addEventListener("click", (event) => {
  const tab = event.target.closest?.(".q-tab");
  if (tab) {
    const q = currentOpenQuestion();
    const ta = questionModal?.querySelector(".q-input");
    if (q && ta) q.answer = ta.value;
    activeQuestionIndex = Number(tab.dataset.qtab || 0);
    renderQuestionModal();
    return;
  }
  const choice = event.target.closest?.("#questionModal .q-choice");
  if (choice && !choice.disabled) {
    questionModal.querySelectorAll(".q-choice").forEach((b) => b.classList.remove("selected"));
    choice.classList.add("selected");
    const q = currentOpenQuestion();
    if (q) {
      q.answerValue = choice.dataset.choice;
      q.answer = `${choice.dataset.choice}. ${choice.querySelector(".q-choice-text")?.textContent || ""}`.trim();
    }
    // Multiple choice is a complete answer on click; advance to the next tab.
    setTimeout(() => goToNextQuestionIfAny(), 120);
    return;
  }
  const next = event.target.closest?.("#questionModal .q-next");
  if (next && !next.disabled) {
    saveVisibleQuestionDraft();
    const q = currentOpenQuestion();
    if (q && !collectQuestionAnswer(q, false)) { setQResultInModal(q.type === "multiple_choice" ? "Select an option first." : "Type an answer first.", "hint"); return; }
    goToNextQuestionIfAny();
    return;
  }
  const submit = event.target.closest?.("#questionModal .q-submit");
  if (submit && !submit.disabled) {
    submitQuestionFromModal();
    return;
  }
});

document.addEventListener("input", (event) => {
  const ta = event.target.closest?.("#questionModal .q-input");
  if (!ta) return;
  const q = currentOpenQuestion();
  if (q) q.answer = ta.value;
});

new MutationObserver(() => { maybeClearEmptyState(); scrollDown(); }).observe(messages, { childList: true, subtree: true, characterData: true });
initConversation();
connect();
