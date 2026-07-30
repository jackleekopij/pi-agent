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
const statusPill = document.getElementById("statusPill");
const skillsList = document.getElementById("skillsList");
const skillsRefreshBtn = document.getElementById("skillsRefresh");
const evalSetsEl = document.getElementById("evalSets");
const evalRunsEl = document.getElementById("evalRuns");
const evalNewSetBtn = document.getElementById("evalNewSet");
const toastsEl = document.getElementById("toasts");
const tSearch = document.getElementById("transcriptSearch");
const tSearchInput = document.getElementById("transcriptSearchInput");
const tSearchCount = document.getElementById("transcriptSearchCount");

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
  if (themeBtn) {
    themeBtn.textContent = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
    themeBtn.title = t === "dark" ? "Use the light interface" : "Use the dark interface";
  }
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
let availableSkills = [];
let skillHealth = {};            // skillId -> {launches, lastLaunchedAt, feedback, latestEval}
let activeSkillMeta = null;      // {id, name, version} of the last skill launched this conversation
let feedbackState = null;        // {summary, byTargetType, bySkill, openQueue, records}
let evalState = { sets: [], runs: [], trends: {}, comparisons: {} };
const skillVersionContentWaiters = new Map(); // "skillId:hash" -> resolve(content)

// --- status pill (professional at-a-glance session state) -------------------
const STATUS_LABELS = { connecting: "Connecting", starting: "Starting", idle: "Ready", running: "Working", error: "Error" };
function setStatusPill(state) {
  if (statusPill) {
    statusPill.className = `status-pill ${state}`;
    const em = statusPill.querySelector("em");
    if (em) em.textContent = STATUS_LABELS[state] || state;
  }
  updateSendButton();
}
// With no sidebar Abort button, the Send button doubles as Stop while a run is
// active and the composer is empty (Esc still aborts too).
function updateSendButton() {
  if (!sendButton) return;
  const stopping = status === "running" && !input?.value.trim();
  sendButton.textContent = stopping ? "Stop" : "Send";
  sendButton.title = stopping ? "Stop the current response (Esc)" : "Send (Enter)";
  // Only disable while the session is starting — ready/idle/running must all
  // leave the button usable (running = Stop).
  sendButton.disabled = status === "starting" || status === "connecting";
}

// --- toasts (quiet confirmations that don't clutter the transcript) ---------
function toast(text, kind = "ok") {
  if (!toastsEl) return addActivity(text, "session");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  toastsEl.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2600);
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.addEventListener("open", () => { setMeta("Connected. Starting Pi…"); setStatusPill("starting"); addActivity("Connected to Pi server"); });
  ws.addEventListener("close", () => {
    setMeta("Disconnected. Reconnecting…");
    setStatusPill("connecting");
    addActivity("Disconnected. Reconnecting…", "error");
    addMessage("system", "Connection closed. Reconnecting…");
    setTimeout(connect, 1000);
  });
  ws.addEventListener("error", () => addMessage("error", "WebSocket error"));
  ws.addEventListener("message", (event) => handleServerMessage(JSON.parse(event.data)));
}

function setMeta(text) { if (meta) meta.textContent = text; }

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

// The inspector is a stack of collapsible sections (Session / Telemetry /
// Timeline / Outputs), each with a live count in its header.
const INSPECTOR_SECTION_BY_TAB = { prompts: "secTurns", timeline: "secTimeline", artifacts: "secArtifacts" };
function setInspectorTab(name) {
  const section = document.getElementById(INSPECTOR_SECTION_BY_TAB[name] || "secTurns");
  if (section) section.open = true;
}
function showInspectorPanel() { /* sections manage their own visibility */ }
function updateInspectorCounts() {
  // Only write when the value changed — writing unconditionally would retrigger
  // the MutationObserver that calls this and freeze the page in a loop.
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = n ? String(n) : "";
    if (el.textContent !== v) el.textContent = v;
  };
  set("turnsCount", promptTurns?.querySelectorAll(".prompt-turn").length || 0);
  set("timelineCount", tools?.querySelectorAll(".timeline-entry, .tool-chip").length || 0);
  set("artifactsCount", artifacts?.querySelectorAll(".artifact-row").length || 0);
}
if (inspector) new MutationObserver(updateInspectorCounts).observe(inspector, { childList: true, subtree: true });
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

// Telemetry: each turn shows exactly what the harness sends to the language
// model — system prompt, approval policy, attachments, then the user message —
// so the composed payload is never a black box.
function addPromptTurn(text, attachments = []) {
  if (!promptTurns) return;
  const sys = getSystemPrompt();
  const before = hooksText("before");
  const after = hooksText("after");
  const approval = approvalPolicyText();
  const attachChars = attachments.reduce((s, a) => s + (a.content || "").length, 0);
  const parts = [
    sys ? { label: "System prompt", text: sys } : null,
    before ? { label: "Hooks (before)", text: before } : null,
    { label: "Approval policy", text: approval },
    attachments.length
      ? {
          label: `Attachments (${attachments.length})`,
          text: attachments.map((a) => `${a.path || "attachment"} — ${a.content ? `${(a.content || "").length.toLocaleString()} chars inlined` : "binary, saved path only"}`).join("\n"),
        }
      : null,
    { label: "User message", text },
    after ? { label: "Hooks (after)", text: after } : null,
  ].filter(Boolean);
  const totalChars = (sys ? sys.length : 0) + before.length + after.length + approval.length + text.length + attachChars;

  const entry = document.createElement("details");
  entry.className = "prompt-turn";
  entry.open = true;
  const n = promptTurns.querySelectorAll(".prompt-turn").length + 1;
  entry.innerHTML =
    `<summary><span>Turn ${n}</span><em class="pt-size">≈ ${Math.round(totalChars / 4).toLocaleString()} tokens sent</em>` +
    `<time>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></summary><div class="pt-parts"></div>`;
  const partsEl = entry.querySelector(".pt-parts");
  for (const part of parts) {
    const seg = document.createElement("details");
    seg.className = "pt-part";
    seg.open = part.label === "User message";
    seg.innerHTML = `<summary><b></b><span></span></summary><pre></pre>`;
    seg.querySelector("b").textContent = part.label;
    seg.querySelector("summary span").textContent = `${part.text.length.toLocaleString()} chars`;
    seg.querySelector("pre").textContent = part.text;
    partsEl.appendChild(seg);
  }
  promptTurns.prepend(entry);
  lastPromptTurnEntry = entry;
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
  // they stay in conversational context. The MCP UI tab keeps an index of them.
  messages.appendChild(card);
  addTimelineEntry(`Rendered UI · ${card.querySelector(".mcp-title, .viz-title")?.textContent || "artifact"}`, "", "info");
  if (artifacts) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "artifact-row";
    row.innerHTML = `<span class="ar-title"></span><time></time>`;
    row.querySelector(".ar-title").textContent = card.querySelector(".mcp-title, .viz-title")?.textContent || "Artifact";
    row.querySelector("time").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.title = "Jump to this artifact in the conversation";
    row.addEventListener("click", () => {
      autoFollow = false;
      document.getElementById(card.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    artifacts.prepend(row);
  }
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
    const prev = store[currentConvoId] || {};
    store[currentConvoId] = {
      id: currentConvoId,
      title: prev.customTitle ? prev.title : convoTitle(),
      customTitle: !!prev.customTitle,
      updatedAt: Date.now(),
      html: messages.innerHTML,
    };
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
  activeSkillMeta = null; // skill attribution never crosses conversations
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
  if (!items.length) {
    historyList.innerHTML = `<div class="list-empty">No conversations yet.</div>`;
    return;
  }
  for (const c of items) {
    const btn = document.createElement("button");
    btn.className = "history-item convo" + (c.id === currentConvoId ? " active" : "");
    btn.title = `${c.title || "New chat"} · ${relTime(c.updatedAt || Date.now())} · double-click to rename`;
    const ic = document.createElement("span");
    ic.className = "convo-ic";
    ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z"/></svg>';
    const title = document.createElement("span");
    title.className = "convo-title";
    title.textContent = c.title || "New chat";
    title.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      beginConvoRename(c.id, btn, title);
    });
    const del = document.createElement("b");
    del.className = "convo-delete";
    del.textContent = "×";
    del.title = "Delete conversation";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const store = loadConvos();
      delete store[c.id];
      saveConvos(store);
      if (c.id === currentConvoId) startNewConversation();
      else renderConversationList();
      toast("Conversation deleted");
    });
    btn.append(ic, title, del);
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
      setStatusPill("idle");
      setMeta(`${modelLabel(msg.model)} · thinking ${msg.thinkingLevel} · ${msg.sessionId || "no session id"}`);
      addActivity(`Ready: ${modelLabel(msg.model)} · thinking ${msg.thinkingLevel}`);
      lastReadyInfo = msg;
      renderSessionContext();
      renderToolsList();
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
      setStatusPill(status === "starting" ? "starting" : status === "running" ? "running" : "idle");
      addActivity(`Status: ${msg.status}`);
      scrollDown();
      break;
    case "skills":
      availableSkills = msg.skills || [];
      if (msg.health) skillHealth = msg.health;
      renderSkillsList();
      renderSessionContext();
      renderToolsList();
      renderFeedbackPane(); // skill names in breakdowns/queue depend on the skill list
      break;
    case "feedback_state":
      feedbackState = msg;
      renderFeedbackPane();
      break;
    case "skill_versions":
      openSkillHistoryModal(msg.skillId, msg.versions || []);
      break;
    case "skill_version_content": {
      const key = `${msg.skillId}:${msg.hash}`;
      const resolve = skillVersionContentWaiters.get(key);
      if (resolve) { skillVersionContentWaiters.delete(key); resolve(msg.content); }
      break;
    }
    case "prompt_payload":
      attachPromptPayload(msg);
      break;
    case "config":
      applyHarnessConfig(msg.config);
      break;
    case "usage":
      applyUsage(msg.usage);
      break;
    case "feedback_saved": {
      const r = msg.record || {};
      toast(`Feedback saved${r.rating ? ` (${r.rating === "up" ? "👍" : "👎"})` : ""} · ${msg.summary?.count ?? "?"} total`);
      markFeedbackSaved(r);
      break;
    }
    case "eval_state":
      evalState = { sets: msg.sets || [], runs: msg.runs || [], trends: msg.trends || {}, comparisons: msg.comparisons || {} };
      renderEvalPanel();
      refreshOpenEvalDashboard();
      break;
    case "eval_run_started":
      toast(`Eval run started: ${msg.run?.setName || msg.run?.runId}`);
      addActivity(`Eval run started: ${msg.run?.runId} (${msg.run?.kind})`, "session");
      break;
    case "eval_run_update": {
      const run = msg.run;
      if (run) {
        upsertEvalRun(run);
        renderEvalPanel();
        refreshOpenEvalDashboard();
        if (run.status === "complete") toast(`Eval run complete: ${run.setName} · ${scorePercent(msg.summary)}`);
      }
      break;
    }
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
      attachFeedbackToLastAssistant();
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

    card.dataset.fbType = spec.kind === "table" ? "table" : "viz";
    card.dataset.fbLabel = head.textContent;
    attachFeedbackBar(card);
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
    card.dataset.fbType = "image";
    card.dataset.fbLabel = head.textContent;
    attachFeedbackBar(card);
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
    <h2>Process AI Harness</h2>
    <p>An agent workspace with interactive visuals, launchable <strong>skills</strong>, human-in-the-loop <strong>feedback</strong> on every output, and runnable <strong>evaluation sets</strong>. Try one of these:</p>
    <div class="examples"></div>
    <p class="muted">Skills, tools, hooks and evaluations live under <strong>Advanced</strong> in the left panel · rate, correct or annotate any output via its feedback bar</p>
    <p class="muted">No-LLM demos: <code>/demo-visualize</code> · <code>/demo-chart</code> · <code>/demo-network</code> · <code>/demo-sequence</code> · <code>/demo-ui</code></p>`;
  const examples = es.querySelector(".examples");
  for (const text of ["Summarize what this repo does and list the main files.", "Query some data and visualize the result.", "Review the human feedback collected so far and propose improvements."]) {
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
  card.dataset.fbType = "mcp";
  card.dataset.fbLabel = title.textContent;
  attachFeedbackBar(card);
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
  if (!message) {
    if (status === "running") {
      send({ type: "abort" });
      addActivity("Abort requested", "session");
    }
    return;
  }
  input.value = "";
  autoGrowInput();
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
    systemPrompt: getSystemPrompt() || undefined,
    hooksBefore: hooksText("before") || undefined,
    hooksAfter: hooksText("after") || undefined,
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
  { id: "skills", title: "Browse skills", hint: "Advanced → Skills", run: () => openAdvancedTab("skills") },
  { id: "toolsPanel", title: "Browse tools", hint: "Advanced → Tools", run: () => openAdvancedTab("tools") },
  { id: "hooksPanel", title: "Edit hooks", hint: "Advanced → Hooks", run: () => openAdvancedTab("hooks") },
  { id: "evalsPanel", title: "Open evaluations", hint: "Advanced → Evaluations", run: () => openAdvancedTab("evals") },
  { id: "feedbackPanel", title: "Feedback analytics", hint: "Advanced → Feedback (open queue + breakdowns)", run: () => openAdvancedTab("feedback") },
  { id: "refreshSkills", title: "Refresh skills", hint: "Rescan skill folders", run: () => { send({ type: "list_skills" }); toast("Rescanning skills…"); } },
  { id: "settingsPanel", title: "Open settings", hint: "System prompt, workspace, appearance", run: () => openStaticModal("settingsModal") },
  { id: "togglePanel", title: "Toggle telemetry panel", hint: "Show/hide the right panel", run: () => toggleInspector() },
  { id: "newEvalSet", title: "Evals: new set", hint: "Create or import an evaluation set", run: () => openEvalSetModal() },
  { id: "lastEvalRun", title: "Evals: latest run", hint: "Open the most recent run dashboard", run: () => { const r = evalState.runs[evalState.runs.length - 1]; if (r) openEvalDashboard(r.runId); else toast("No eval runs yet", "warn"); } },
  { id: "feedbackReview", title: "Feedback: ask Pi to review", hint: "Send saved human feedback to Pi for improvement proposals", run: () => submitSystemPrompt("Call list_feedback and review all recorded human feedback (ratings, comments, corrections, image annotations). Summarize recurring issues and propose concrete, prioritized improvements.", "Feedback review") },
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

function submitSystemPrompt(message, label = "Prompt", extra = {}) {
  addPromptTurn(message, []);
  addActivity(label, "session");
  autoFollow = true;
  send({
    type: "prompt",
    message,
    approvalPolicy: approvalPolicyText(),
    systemPrompt: getSystemPrompt() || undefined,
    hooksBefore: hooksText("before") || undefined,
    hooksAfter: hooksText("after") || undefined,
    streamingBehavior: status === "running" ? "followUp" : undefined,
    ...extra,
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

// Inline transcript search bar (replaces the old blocking prompt()).
let tSearchHits = [];
let tSearchIndex = -1;
function openTranscriptSearch() {
  if (!tSearch) return;
  tSearch.classList.remove("hidden");
  tSearchInput?.focus();
  tSearchInput?.select();
}
function closeTranscriptSearch() {
  tSearch?.classList.add("hidden");
  clearSearchHits();
  input?.focus();
}
function clearSearchHits() {
  for (const el of tSearchHits) el.classList.remove("search-hit", "search-hit-current");
  tSearchHits = [];
  tSearchIndex = -1;
  if (tSearchCount) tSearchCount.textContent = "";
}
function runTranscriptSearch() {
  clearSearchHits();
  const query = (tSearchInput?.value || "").trim().toLowerCase();
  if (!query) return;
  tSearchHits = Array.from(messages.querySelectorAll(".message, .viz-title, .mcp-title")).filter(
    (el) => el.textContent.toLowerCase().includes(query)
  );
  for (const el of tSearchHits) el.classList.add("search-hit");
  if (tSearchCount) tSearchCount.textContent = tSearchHits.length ? `${tSearchHits.length} match${tSearchHits.length === 1 ? "" : "es"}` : "No matches";
  if (tSearchHits.length) gotoSearchHit(0);
}
function gotoSearchHit(index) {
  if (!tSearchHits.length) return;
  tSearchHits[tSearchIndex]?.classList.remove("search-hit-current");
  tSearchIndex = ((index % tSearchHits.length) + tSearchHits.length) % tSearchHits.length;
  const hit = tSearchHits[tSearchIndex];
  hit.classList.add("search-hit-current");
  autoFollow = false;
  hit.scrollIntoView({ behavior: "smooth", block: "center" });
  if (tSearchCount) tSearchCount.textContent = `${tSearchIndex + 1}/${tSearchHits.length}`;
}
tSearchInput?.addEventListener("input", runTranscriptSearch);
tSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); gotoSearchHit(tSearchIndex + (e.shiftKey ? -1 : 1)); }
  if (e.key === "Escape") { e.preventDefault(); closeTranscriptSearch(); }
});
document.getElementById("transcriptSearchNext")?.addEventListener("click", () => gotoSearchHit(tSearchIndex + 1));
document.getElementById("transcriptSearchPrev")?.addEventListener("click", () => gotoSearchHit(tSearchIndex - 1));
document.getElementById("transcriptSearchClose")?.addEventListener("click", closeTranscriptSearch);

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
  if (event.key === "Escape") {
    const openStatic = document.querySelector(".static-modal:not(.hidden)");
    if (openStatic) { openStatic.classList.add("hidden"); return; }
    if (tSearch && !tSearch.classList.contains("hidden")) { closeTranscriptSearch(); return; }
    if (status === "running") send({ type: "abort" });
  }
});

abortButton?.addEventListener("click", () => send({ type: "abort" }));
newSessionButton?.addEventListener("click", () => {
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

// ===========================================================================
// Skills — discovery-backed picker (built-in registry + scanned SKILL.md files)
// ===========================================================================
function sourceBadge(source) {
  return source === "built-in" ? "core" : source === "global" ? "global" : "workspace";
}

function skillScoreLabel(latestEval) {
  if (!latestEval || typeof latestEval.avgScore !== "number") return null;
  const pct = Math.round(latestEval.avgScore * 100);
  let delta = "";
  let cls = "flat";
  if (typeof latestEval.delta === "number" && Math.round(Math.abs(latestEval.delta) * 100) >= 1) {
    const d = Math.round(latestEval.delta * 100);
    delta = ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
    cls = d > 0 ? "up" : "down";
  }
  return { text: `${pct}%${delta}`, cls, title: `Latest bound eval: ${latestEval.setName}${delta ? " · delta vs previous run" : ""}` };
}

function renderSkillsList() {
  if (!skillsList) return;
  if (!availableSkills.length) {
    skillsList.innerHTML = `<div class="list-empty">No skills found. Add SKILL.md files under .pi/skills/, skills/ or docs/.</div>`;
    return;
  }
  skillsList.innerHTML = "";
  for (const skill of availableSkills) {
    const item = document.createElement("div");
    item.className = "skill-item";
    item.title = skill.whenToUse ? `When to use: ${skill.whenToUse}` : skill.description;
    item.innerHTML = `
      <div class="skill-item-head">
        <span class="skill-name"></span>
        <span class="skill-version-chip" title="Skill version — revision · content hash"></span>
        <span class="skill-badge ${sourceBadge(skill.source)}"></span>
      </div>
      <span class="skill-desc"></span>
      <div class="skill-health"></div>
      <div class="skill-item-actions">
        <button type="button" class="text-btn" data-skill-act="history" title="Version history and diffs">History</button>
        <button type="button" class="text-btn" data-skill-act="run" title="Launch this skill">Run</button>
      </div>`;
    item.querySelector(".skill-name").textContent = skill.name;
    item.querySelector(".skill-badge").textContent = sourceBadge(skill.source);
    item.querySelector(".skill-desc").textContent = skill.description;
    const vchip = item.querySelector(".skill-version-chip");
    if (skill.version) vchip.textContent = `v${skill.revision ?? "?"} · ${skill.version}`;
    else vchip.remove();

    // Health line: launches · 👍/👎 · latest bound-eval score with delta · open items.
    const h = skillHealth[skill.id];
    const healthEl = item.querySelector(".skill-health");
    const bits = [];
    if (h?.launches) bits.push(`<span title="Times launched">${h.launches} launch${h.launches === 1 ? "" : "es"}</span>`);
    if (h?.feedback?.count) bits.push(`<span title="Feedback attributed to this skill">👍${h.feedback.up} 👎${h.feedback.down}</span>`);
    const score = skillScoreLabel(h?.latestEval);
    if (score) bits.push(`<span class="skill-eval-score ${score.cls}" title="${escapeHtml(score.title)}">${score.text}</span>`);
    if (h?.feedback?.open) bits.push(`<span class="skill-open-count" title="Open feedback items awaiting a fix">${h.feedback.open} open</span>`);
    if (bits.length) healthEl.innerHTML = bits.join(`<i class="dot"></i>`);
    else healthEl.innerHTML = `<span class="skill-health-none">no usage data yet</span>`;

    item.querySelector('[data-skill-act="run"]').addEventListener("click", () => openSkillRunModal(skill));
    item.querySelector('[data-skill-act="history"]').addEventListener("click", () => send({ type: "skill_versions", skillId: skill.id }));
    item.addEventListener("dblclick", () => openSkillRunModal(skill));
    skillsList.appendChild(item);
  }
}

// --- skill version history + diff -------------------------------------------
function requestSkillVersionContent(skillId, hash) {
  return new Promise((resolve) => {
    skillVersionContentWaiters.set(`${skillId}:${hash}`, resolve);
    send({ type: "skill_version_content", skillId, hash });
    setTimeout(() => {
      const key = `${skillId}:${hash}`;
      if (skillVersionContentWaiters.has(key)) { skillVersionContentWaiters.delete(key); resolve(null); }
    }, 5000);
  });
}

/** Simple line-level LCS diff — good enough for prose SKILL.md files. */
function diffLines(aText, bText) {
  const a = String(aText || "").split("\n");
  const b = String(bText || "").split("\n");
  const MAX = 600;
  if (a.length > MAX || b.length > MAX) {
    return [{ kind: "context", text: "(files too large for inline diff — showing both versions unchanged is omitted)" }];
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "context", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "removed", text: a[i] }); i++; }
    else { out.push({ kind: "added", text: b[j] }); j++; }
  }
  while (i < a.length) { out.push({ kind: "removed", text: a[i] }); i++; }
  while (j < b.length) { out.push({ kind: "added", text: b[j] }); j++; }
  return out;
}

function renderDiffHtml(lines) {
  return lines.map((l) =>
    `<div class="diff-line ${l.kind}">${l.kind === "added" ? "+" : l.kind === "removed" ? "−" : " "} ${escapeHtml(l.text)}</div>`
  ).join("");
}

function openSkillHistoryModal(skillId, versions) {
  const skill = availableSkills.find((s) => s.id === skillId);
  document.querySelector(".skill-history-modal")?.remove();
  const modal = openOverlay("skill-history-modal", `
    <div class="command-shell wide" role="dialog" aria-label="Skill version history">
      <div class="command-head"><strong></strong><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <p class="section-hint">Append-only version history for this skill. Each entry is a full snapshot of the SKILL.md / registry definition at that point — diff any version against the current one.</p>
        <div class="skill-version-list"></div>
        <div class="skill-diff-view hidden"><div class="skill-diff-head"><b></b><button type="button" class="text-btn" data-act="close-diff">Hide diff</button></div><div class="skill-diff-body mono"></div></div>
      </div>
    </div>`);
  modal.querySelector(".command-head strong").textContent = `${skill?.name || skillId} — version history`;
  const list = modal.querySelector(".skill-version-list");
  const diffView = modal.querySelector(".skill-diff-view");
  modal.querySelector('[data-act="close-diff"]').addEventListener("click", () => diffView.classList.add("hidden"));
  if (!versions.length) {
    list.innerHTML = `<div class="list-empty">No versions recorded yet — versions snapshot automatically when the skill's definition changes.</div>`;
    return;
  }
  const current = versions[versions.length - 1];
  for (const v of [...versions].reverse()) {
    const row = document.createElement("div");
    row.className = "skill-version-row";
    const isCurrent = v.hash === current.hash;
    row.innerHTML = `
      <span class="skill-version-chip"></span>
      <span class="skill-version-meta"></span>
      <span class="skill-version-note"></span>
      <span class="skill-version-actions"></span>`;
    row.querySelector(".skill-version-chip").textContent = `v${v.revision} · ${v.hash}`;
    row.querySelector(".skill-version-meta").textContent =
      `${relTime(new Date(v.savedAt).getTime())}${v.status === "candidate" ? " · candidate" : ""}${isCurrent ? " · current" : ""}`;
    row.querySelector(".skill-version-note").textContent = v.note || "";
    const actions = row.querySelector(".skill-version-actions");
    if (!isCurrent) {
      const diffBtn = document.createElement("button");
      diffBtn.type = "button";
      diffBtn.className = "text-btn";
      diffBtn.textContent = "Diff vs current";
      diffBtn.addEventListener("click", async () => {
        diffBtn.disabled = true;
        const [oldC, newC] = await Promise.all([
          requestSkillVersionContent(skillId, v.hash),
          requestSkillVersionContent(skillId, current.hash),
        ]);
        diffBtn.disabled = false;
        if (oldC == null || newC == null) { toast("Could not load version content", "warn"); return; }
        modal.querySelector(".skill-diff-head b").textContent = `v${v.revision} (${v.hash}) → v${current.revision} (${current.hash})`;
        modal.querySelector(".skill-diff-body").innerHTML = renderDiffHtml(diffLines(oldC, newC));
        diffView.classList.remove("hidden");
        diffView.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      actions.appendChild(diffBtn);
    }
    list.appendChild(row);
  }
}
skillsRefreshBtn?.addEventListener("click", () => { send({ type: "list_skills" }); toast("Rescanning skill folders…"); });

// Generic overlay modal (command-palette styling family). Esc / backdrop close.
function openOverlay(className, html) {
  const modal = document.createElement("div");
  modal.className = `command-modal harness-modal ${className}`;
  modal.innerHTML = html;
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", onKey, true);
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  modal.close = close;
  return modal;
}

function composeSkillPrompt(skill, context) {
  const ctx = (context || "").trim();
  return String(skill.prompt || "")
    .replace("{{context}}", ctx ? `Context from the user: ${ctx}\n` : "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function openSkillRunModal(skill) {
  const modal = openOverlay("skill-modal", `
    <div class="command-shell" role="dialog" aria-label="Run skill">
      <div class="command-head"><strong></strong><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <p class="skill-modal-desc"></p>
        <p class="skill-modal-when hidden"><b>When to use:</b> <span></span></p>
        <div class="skill-tools"></div>
        <label class="ws-label" for="skillContext">Context for this run (optional)</label>
        <textarea id="skillContext" class="modal-input" rows="3" placeholder="Topic, file, dataset, constraints…"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="insert">Insert into composer</button>
        <button type="button" class="primary" data-act="run">Run skill</button>
      </div>
    </div>`);
  modal.querySelector(".command-head strong").textContent = skill.name;
  modal.querySelector(".skill-modal-desc").textContent = skill.description;
  if (skill.whenToUse) {
    const p = modal.querySelector(".skill-modal-when");
    p.classList.remove("hidden");
    p.querySelector("span").textContent = skill.whenToUse;
  }
  const toolsEl = modal.querySelector(".skill-tools");
  for (const t of skill.tools || []) {
    const chip = document.createElement("code");
    chip.className = "skill-tool-chip";
    chip.textContent = t;
    toolsEl.appendChild(chip);
  }
  const run = () => {
    const prompt = composeSkillPrompt(skill, modal.querySelector("#skillContext")?.value);
    modal.close();
    activeSkillMeta = { id: skill.id, name: skill.name, version: skill.version };
    submitSystemPrompt(prompt, `Skill: ${skill.name}`, { skill: activeSkillMeta });
    toast(`Skill launched: ${skill.name}${skill.version ? ` (v${skill.revision ?? "?"} · ${skill.version})` : ""}`);
  };
  modal.querySelector('[data-act="run"]').addEventListener("click", run);
  modal.querySelector('[data-act="insert"]').addEventListener("click", () => {
    input.value = composeSkillPrompt(skill, modal.querySelector("#skillContext")?.value);
    modal.close();
    input.focus();
    autoGrowInput();
  });
  setTimeout(() => modal.querySelector("#skillContext")?.focus(), 0);
}

function openSkillsModal() {
  if (!availableSkills.length) { toast("No skills discovered yet", "warn"); send({ type: "list_skills" }); return; }
  const modal = openOverlay("skills-browser", `
    <div class="command-shell" role="dialog" aria-label="Skills">
      <div class="command-head"><strong>Available skills</strong><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="command-list skills-browser-list"></div>
    </div>`);
  const list = modal.querySelector(".skills-browser-list");
  for (const skill of availableSkills) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "command-item";
    item.innerHTML = `<strong></strong><span></span>`;
    item.querySelector("strong").textContent = `${skill.name} · ${sourceBadge(skill.source)}`;
    item.querySelector("span").textContent = skill.description;
    item.addEventListener("click", () => { modal.close(); openSkillRunModal(skill); });
    list.appendChild(item);
  }
}

// ===========================================================================
// Human-in-the-loop feedback — rate / comment / correct / annotate any output.
// Every submission is saved server-side under .pi-web-chat-feedback/.
// ===========================================================================
function attachFeedbackBar(card) {
  if (!card || card.querySelector(".fb-bar")) return;
  const type = card.dataset.fbType || "viz";
  const bar = document.createElement("div");
  bar.className = "fb-bar";
  const canCorrect = type === "assistant" || type === "table" || type === "mcp";
  const canAnnotate = type === "image" || !!card.querySelector("img");
  bar.innerHTML =
    `<span class="fb-label" title="Human feedback — saved to the improvement dataset">Feedback</span>` +
    `<button type="button" class="fb-btn" data-fb="up" title="Good output">👍</button>` +
    `<button type="button" class="fb-btn" data-fb="down" title="Needs work">👎</button>` +
    `<button type="button" class="fb-btn" data-fb="comment" title="Add a comment">💬</button>` +
    (canCorrect ? `<button type="button" class="fb-btn" data-fb="correct" title="Provide the corrected version (stored as ground truth)">✎ Correct</button>` : "") +
    (canAnnotate ? `<button type="button" class="fb-btn" data-fb="annotate" title="Draw regions on the image and describe what's wrong">⊞ Annotate</button>` : "") +
    `<span class="fb-status"></span>`;
  card.appendChild(bar);
}

function attachFeedbackToLastAssistant() {
  const els = messages.querySelectorAll(".message.assistant");
  const el = els[els.length - 1];
  if (!el || el.querySelector(".fb-bar") || !el.textContent.trim()) return;
  el.dataset.fbType = "assistant";
  el.dataset.fbLabel = "Assistant response";
  attachFeedbackBar(el);
  saveHistorySoon();
}

function feedbackExcerpt(card) {
  const clone = card.cloneNode(true);
  clone.querySelectorAll(".fb-bar, iframe, script, style").forEach((n) => n.remove());
  return clone.textContent.trim().replace(/\s+/g, " ").slice(0, 600);
}

function sendFeedback(card, extra) {
  const record = {
    targetType: card.dataset.fbType || "other",
    targetId: card.id || undefined,
    targetLabel: card.dataset.fbLabel || undefined,
    excerpt: feedbackExcerpt(card),
    // Durable attribution — targetId is a DOM id and dies with the session;
    // these keys survive: which conversation, which turn, which skill.
    conversationId: currentConvoId || undefined,
    turnIndex: messageCounter,
    skillId: activeSkillMeta?.id,
    skillVersion: activeSkillMeta?.version,
    ...extra,
  };
  send({ type: "feedback", record });
  const statusEl = card.querySelector(".fb-status");
  if (statusEl) statusEl.textContent = "Saving…";
  addActivity(`Feedback submitted (${record.targetType}${record.rating ? ` · ${record.rating}` : ""})`, "session");
  saveHistorySoon();
}

function markFeedbackSaved(record) {
  const card = record?.targetId ? document.getElementById(record.targetId) : null;
  const statusEl = card?.querySelector(".fb-status");
  if (statusEl) { statusEl.textContent = "Saved ✓"; setTimeout(() => { statusEl.textContent = ""; }, 2500); }
}

function toggleFeedbackComment(card, bar) {
  let row = bar.querySelector(".fb-comment-row");
  if (row) { row.remove(); return; }
  row = document.createElement("span");
  row.className = "fb-comment-row";
  row.innerHTML = `<input type="text" class="fb-comment-input" placeholder="What should improve?" /><button type="button" class="fb-comment-save">Save</button>`;
  bar.appendChild(row);
  const inputEl = row.querySelector(".fb-comment-input");
  const save = () => {
    const comment = inputEl.value.trim();
    if (!comment) { inputEl.focus(); return; }
    sendFeedback(card, { comment });
    row.remove();
  };
  row.querySelector(".fb-comment-save").addEventListener("click", save);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  inputEl.focus();
}

function openCorrectionModal(card) {
  const original = feedbackExcerpt(card) || "(no text content)";
  const modal = openOverlay("correction-modal", `
    <div class="command-shell wide" role="dialog" aria-label="Provide a correction">
      <div class="command-head"><strong>Correct this output</strong><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="modal-body correction-grid">
        <div>
          <label class="ws-label">Original (what Pi produced)</label>
          <pre class="correction-original"></pre>
        </div>
        <div>
          <label class="ws-label" for="correctionText">Corrected version (ground truth)</label>
          <textarea id="correctionText" class="modal-input" rows="10" placeholder="Type the corrected text / table content…"></textarea>
        </div>
      </div>
      <label class="ws-label" for="correctionNote">Why (optional)</label>
      <input id="correctionNote" class="fb-comment-input full" type="text" placeholder="e.g. wrong units, missing row, outdated figure…" />
      <div class="modal-actions">
        <button type="button" class="ghost" data-close>Cancel</button>
        <button type="button" class="primary" data-act="save">Save correction</button>
      </div>
    </div>`);
  modal.querySelector(".correction-original").textContent = original;
  const ta = modal.querySelector("#correctionText");
  ta.value = original;
  modal.querySelector('[data-act="save"]').addEventListener("click", () => {
    const corrected = ta.value.trim();
    if (!corrected) { ta.focus(); return; }
    sendFeedback(card, {
      correction: { original, corrected },
      comment: modal.querySelector("#correctionNote")?.value.trim() || undefined,
    });
    modal.close();
  });
  setTimeout(() => ta.focus(), 0);
}

// Image region annotation: draw normalized boxes over the image, one note each.
function openAnnotateModal(card) {
  const img = card.querySelector("img");
  if (!img?.src) { toast("No image found to annotate", "warn"); return; }
  const annotations = [];
  const modal = openOverlay("annotate-modal", `
    <div class="command-shell wide" role="dialog" aria-label="Annotate image">
      <div class="command-head"><strong>Annotate image</strong><span class="annotate-hint">Drag to draw a region, then describe the issue</span><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="annotate-stage"><img alt="Output being annotated" draggable="false" /><div class="annotate-layer"></div></div>
      <div class="annotate-list"></div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-close>Cancel</button>
        <button type="button" class="primary" data-act="save" disabled>Save 0 annotations</button>
      </div>
    </div>`);
  const stage = modal.querySelector(".annotate-stage");
  const stageImg = stage.querySelector("img");
  const layer = modal.querySelector(".annotate-layer");
  const listEl = modal.querySelector(".annotate-list");
  const saveBtn = modal.querySelector('[data-act="save"]');
  stageImg.src = img.src;

  function redraw() {
    layer.querySelectorAll(".annotate-box").forEach((b) => b.remove());
    listEl.innerHTML = "";
    annotations.forEach((a, i) => {
      const box = document.createElement("div");
      box.className = "annotate-box";
      box.style.left = `${a.x * 100}%`;
      box.style.top = `${a.y * 100}%`;
      box.style.width = `${a.w * 100}%`;
      box.style.height = `${a.h * 100}%`;
      box.innerHTML = `<b>${i + 1}</b>`;
      layer.appendChild(box);
      const row = document.createElement("div");
      row.className = "annotate-row";
      row.innerHTML = `<b>${i + 1}</b><input type="text" class="fb-comment-input" placeholder="What's wrong in this region?" /><button type="button" class="annotate-del" title="Remove">×</button>`;
      const noteInput = row.querySelector("input");
      noteInput.value = a.note || "";
      noteInput.addEventListener("input", () => { a.note = noteInput.value; });
      row.querySelector(".annotate-del").addEventListener("click", () => { annotations.splice(i, 1); redraw(); });
      listEl.appendChild(row);
    });
    saveBtn.disabled = !annotations.length;
    saveBtn.textContent = `Save ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`;
    if (annotations.length) listEl.querySelector(".annotate-row:last-child input")?.focus();
  }

  let draft = null;
  layer.addEventListener("pointerdown", (e) => {
    const rect = layer.getBoundingClientRect();
    draft = {
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      el: document.createElement("div"),
    };
    draft.el.className = "annotate-box drafting";
    layer.appendChild(draft.el);
    layer.setPointerCapture(e.pointerId);
  });
  layer.addEventListener("pointermove", (e) => {
    if (!draft) return;
    const rect = layer.getBoundingClientRect();
    const curX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const curY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    draft.x = Math.min(draft.startX, curX);
    draft.y = Math.min(draft.startY, curY);
    draft.w = Math.abs(curX - draft.startX);
    draft.h = Math.abs(curY - draft.startY);
    draft.el.style.left = `${draft.x * 100}%`;
    draft.el.style.top = `${draft.y * 100}%`;
    draft.el.style.width = `${draft.w * 100}%`;
    draft.el.style.height = `${draft.h * 100}%`;
  });
  layer.addEventListener("pointerup", () => {
    if (!draft) return;
    const { x, y, w, h } = draft;
    draft.el.remove();
    draft = null;
    if (w > 0.01 && h > 0.01) {
      annotations.push({ x, y, w, h, note: "" });
      redraw();
    }
  });

  saveBtn.addEventListener("click", () => {
    const complete = annotations.filter((a) => a.note?.trim());
    if (!complete.length) { toast("Add a note to at least one region", "warn"); return; }
    sendFeedback(card, { annotations: complete.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h, note: a.note.trim() })) });
    modal.close();
  });
}

// Delegated handlers so feedback bars keep working after a localStorage restore.
document.addEventListener("click", (event) => {
  const btn = event.target.closest?.(".fb-btn");
  if (!btn) return;
  const card = btn.closest("[data-fb-type]") || btn.closest(".message, .viz-card, .mcp-card");
  const bar = btn.closest(".fb-bar");
  if (!card || !bar) return;
  const action = btn.dataset.fb;
  if (action === "up" || action === "down") {
    bar.querySelectorAll('[data-fb="up"],[data-fb="down"]').forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sendFeedback(card, { rating: action });
  } else if (action === "comment") {
    toggleFeedbackComment(card, bar);
  } else if (action === "correct") {
    openCorrectionModal(card);
  } else if (action === "annotate") {
    openAnnotateModal(card);
  }
});

// ===========================================================================
// Feedback analytics — the captured feedback as an actionable improvement
// backlog: KPIs, per-skill / per-type breakdowns, and the open queue.
// ===========================================================================
function renderFeedbackBreakdown(el, map, nameFor) {
  if (!el) return;
  const entries = Object.entries(map || {}).sort((a, b) => b[1].count - a[1].count);
  if (!entries.length) return; // keep the pane's default empty-state
  el.innerHTML = "";
  for (const [key, b] of entries) {
    const row = document.createElement("div");
    row.className = "fb-breakdown-row";
    row.innerHTML = `<span class="fb-bd-name"></span><span class="fb-bd-stats"></span>`;
    row.querySelector(".fb-bd-name").textContent = nameFor(key);
    row.querySelector(".fb-bd-stats").innerHTML =
      `<span title="Total feedback">${b.count}</span><i class="dot"></i>` +
      `<span>👍${b.up} 👎${b.down}</span><i class="dot"></i>` +
      `<span title="Corrections">${b.corrections} corr.</span><i class="dot"></i>` +
      `<span class="${b.open ? "fb-open" : ""}" title="Awaiting a fix">${b.open} open</span>`;
    el.appendChild(row);
  }
}

function feedbackQueueLabel(f) {
  if (f.correction) return "correction";
  if (f.annotations?.length) return "annotation";
  if (f.comment) return "comment";
  if (f.rating === "down") return "👎";
  return f.targetType || "feedback";
}

function renderFeedbackPane() {
  const summaryEl = document.getElementById("fbSummary");
  if (!summaryEl || !feedbackState) return;
  const s = feedbackState.summary || {};
  summaryEl.innerHTML = `
    <div class="eval-kpi"><b>${s.count ?? 0}</b><span>total</span></div>
    <div class="eval-kpi pass"><b>${s.up ?? 0}</b><span>👍</span></div>
    <div class="eval-kpi fail"><b>${s.down ?? 0}</b><span>👎</span></div>
    <div class="eval-kpi"><b>${s.corrections ?? 0}</b><span>corrections</span></div>
    <div class="eval-kpi ${s.open ? "fail" : ""}"><b>${s.open ?? 0}</b><span>open</span></div>`;
  renderFeedbackBreakdown(
    document.getElementById("fbBySkill"),
    feedbackState.bySkill,
    (id) => availableSkills.find((x) => x.id === id)?.name || id
  );
  renderFeedbackBreakdown(
    document.getElementById("fbByType"),
    feedbackState.byTargetType,
    (t) => t
  );
  const queueEl = document.getElementById("fbQueue");
  if (!queueEl) return;
  const queue = feedbackState.openQueue || [];
  if (!queue.length) {
    queueEl.innerHTML = `<div class="list-empty">Nothing open — the loop is clean.</div>`;
    return;
  }
  queueEl.innerHTML = "";
  for (const f of queue) {
    const row = document.createElement("details");
    row.className = "fb-queue-row";
    const skillName = f.skillId ? (availableSkills.find((x) => x.id === f.skillId)?.name || f.skillId) : null;
    row.innerHTML = `
      <summary>
        <span class="fb-queue-kind"></span>
        <span class="fb-queue-label"></span>
        <span class="fb-queue-meta"></span>
        <button type="button" class="text-btn fb-resolve" title="Mark addressed — a fix for this has landed">Resolve</button>
      </summary>
      <div class="fb-queue-detail"></div>`;
    row.querySelector(".fb-queue-kind").textContent = feedbackQueueLabel(f);
    row.querySelector(".fb-queue-label").textContent = f.targetLabel || f.excerpt?.slice(0, 80) || f.targetType;
    row.querySelector(".fb-queue-meta").textContent =
      `${skillName ? `${skillName} · ` : ""}${relTime(new Date(f.createdAt).getTime())}`;
    const detail = row.querySelector(".fb-queue-detail");
    const parts = [];
    if (f.comment) parts.push(`Comment: ${f.comment}`);
    if (f.correction) parts.push(`Original: ${f.correction.original}\n\nCorrected (ground truth): ${f.correction.corrected}`);
    if (f.annotations?.length) parts.push(`Annotations: ${f.annotations.map((a) => a.note).filter(Boolean).join(" · ")}`);
    if (f.excerpt) parts.push(`Output excerpt: ${f.excerpt}`);
    detail.textContent = parts.join("\n\n") || "No detail.";
    row.querySelector(".fb-resolve").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      send({ type: "feedback_resolve", feedbackId: f.feedbackId });
      toast("Marked addressed");
    });
    queueEl.appendChild(row);
  }
}

document.getElementById("fbAskFix")?.addEventListener("click", () => {
  submitSystemPrompt(
    `Call list_feedback(status="open") and review every open feedback item (comments, corrections, annotations, 👎 ratings). ` +
    `Group recurring problems, then propose concrete prioritized fixes — prompt changes, skill edits, tool or context changes. ` +
    `Where feedback is attributed to a skill (skillId), state exactly what should change in that skill's SKILL.md so the mistake cannot recur.`,
    "Open feedback review"
  );
  toast("Asked Pi to propose fixes for the open queue");
});

// ===========================================================================
// Evaluations — sets (question banks + model-graded prompt suites) and runs.
// ===========================================================================
function scorePercent(summary) {
  if (!summary) return "—";
  if (typeof summary.avgScore === "number") return `${Math.round(summary.avgScore * 100)}%`;
  if (summary.recorded) return `${summary.passed}/${summary.recorded}`;
  return "—";
}

function summarizeRun(run) {
  if (run.summary) return run.summary;
  const scored = (run.results || []).filter((r) => typeof r.score === "number" || r.pass != null);
  const passed = (run.results || []).filter((r) => r.pass === true).length;
  const failed = (run.results || []).filter((r) => r.pass === false).length;
  const avg = scored.length ? scored.reduce((s, r) => s + (typeof r.score === "number" ? r.score : r.pass ? 1 : 0), 0) / scored.length : undefined;
  return { total: run.total, recorded: (run.results || []).length, passed, failed, avgScore: avg, status: run.status };
}

function upsertEvalRun(run) {
  const i = evalState.runs.findIndex((r) => r.runId === run.runId);
  if (i >= 0) evalState.runs[i] = { ...evalState.runs[i], ...run };
  else evalState.runs.push(run);
}

function renderEvalPanel() {
  if (evalSetsEl) {
    evalSetsEl.innerHTML = "";
    if (!evalState.sets.length) {
      evalSetsEl.innerHTML = `<div class="list-empty">No sets yet — click “＋ New set”, or ask Pi to <code>save_eval_set</code> one from a document.</div>`;
    }
    for (const set of evalState.sets) {
      const item = document.createElement("div");
      item.className = "eval-set-item";
      item.innerHTML = `
        <div class="eval-set-main">
          <span class="eval-set-name"></span>
          <span class="eval-kind-badge"></span>
          <span class="eval-skill-badge hidden" title="Runs of this set are scored against this skill's current version"></span>
          <span class="eval-set-count"></span>
        </div>
        <div class="eval-set-actions">
          <button type="button" class="eval-run-btn" title="Run this evaluation set">▶ Run</button>
          <button type="button" class="eval-del-btn" title="Delete set">×</button>
        </div>`;
      item.querySelector(".eval-set-name").textContent = set.name;
      item.querySelector(".eval-set-name").title = set.description || set.name;
      item.querySelector(".eval-kind-badge").textContent = set.kind === "prompts" ? "model-graded" : "question bank";
      item.querySelector(".eval-kind-badge").className = `eval-kind-badge ${set.kind}`;
      if (set.skillId) {
        const skillBadge = item.querySelector(".eval-skill-badge");
        skillBadge.classList.remove("hidden");
        skillBadge.textContent = `⚙ ${availableSkills.find((s) => s.id === set.skillId)?.name || set.skillId}`;
      }
      item.querySelector(".eval-set-count").textContent = `${set.cases.length} case${set.cases.length === 1 ? "" : "s"}`;
      item.querySelector(".eval-run-btn").addEventListener("click", () => {
        send({ type: "eval_run", setId: set.id });
        toast(`Starting eval run: ${set.name}`);
      });
      item.querySelector(".eval-del-btn").addEventListener("click", () => {
        if (confirm(`Delete evaluation set "${set.name}"? Past runs are kept.`)) send({ type: "eval_delete_set", setId: set.id });
      });
      evalSetsEl.appendChild(item);
    }
  }
  if (evalRunsEl) {
    evalRunsEl.innerHTML = "";
    const runs = [...evalState.runs].reverse().slice(0, 8);
    if (!runs.length) evalRunsEl.innerHTML = `<div class="list-empty">No runs yet.</div>`;
    for (const run of runs) {
      const s = summarizeRun(run);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "eval-run-item";
      item.title = "Open run dashboard";
      item.innerHTML = `
        <span class="eval-run-name"></span>
        <span class="eval-run-meta"></span>
        <span class="eval-run-score"></span>`;
      item.querySelector(".eval-run-name").textContent = run.setName;
      item.querySelector(".eval-run-meta").textContent = `${s.recorded}/${s.total} · ${relTime(new Date(run.startedAt).getTime())}`;
      const scoreEl = item.querySelector(".eval-run-score");
      scoreEl.textContent = run.status === "running" ? "running…" : scorePercent(s);
      scoreEl.className = `eval-run-score ${run.status}`;
      item.addEventListener("click", () => openEvalDashboard(run.runId));
      evalRunsEl.appendChild(item);
    }
  }
}

const EVAL_TEMPLATES = {
  questions: JSON.stringify([
    { id: "q1", type: "multiple_choice", question: "Which component separates gas from liquids?", choices: ["Compressor", "Separator", "Manifold", "Meter"], correct: "B", points: 1 },
    { id: "q2", type: "short_answer", question: "In one sentence, what does a manifold do?", expected: "Combines flow from multiple wells into shared piping.", points: 1 },
  ], null, 2),
  prompts: JSON.stringify([
    { id: "c1", prompt: "List the three files that define the web chat server.", expected: "server.ts, question-tools.ts, viz-tools.ts (mcp-ui-tools.ts also acceptable)" },
    { id: "c2", prompt: "Render a bar chart of Q1=10, Q2=20.", rubric: "Pass if the visualize/render_bar tool was called with both values." },
  ], null, 2),
};

function openEvalSetModal() {
  const modal = openOverlay("eval-set-modal", `
    <div class="command-shell wide" role="dialog" aria-label="New evaluation set">
      <div class="command-head"><strong>New evaluation set</strong><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <div class="eval-form-row">
          <div class="eval-form-col">
            <label class="ws-label" for="evalSetName">Name</label>
            <input id="evalSetName" type="text" class="fb-comment-input full" placeholder="e.g. P&ID knowledge check" />
          </div>
          <div class="eval-form-col narrow">
            <label class="ws-label" for="evalSetKind">Kind</label>
            <select id="evalSetKind" class="eval-kind-select">
              <option value="questions">Question bank (human answers)</option>
              <option value="prompts">Prompt suite (model-graded)</option>
            </select>
          </div>
          <div class="eval-form-col narrow">
            <label class="ws-label" for="evalSetSkill">Tests skill</label>
            <select id="evalSetSkill" class="eval-kind-select" title="Bind this set to the skill it evaluates — runs then track scores per skill version">
              <option value="">None</option>
            </select>
          </div>
        </div>
        <label class="ws-label" for="evalSetDesc">Description (optional)</label>
        <input id="evalSetDesc" type="text" class="fb-comment-input full" placeholder="What this set evaluates" />
        <div class="eval-json-head">
          <label class="ws-label" for="evalSetCases">Cases (JSON array)</label>
          <button type="button" class="ghost small" data-act="template">Insert template</button>
        </div>
        <textarea id="evalSetCases" class="modal-input mono" rows="12" spellcheck="false"></textarea>
        <div class="eval-form-error hidden"></div>
        <p class="section-hint">Tip: you can also ask Pi to build a set for you — e.g. “Create an eval set from this document using save_eval_set”.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-close>Cancel</button>
        <button type="button" class="primary" data-act="save">Save set</button>
      </div>
    </div>`);
  const kindSel = modal.querySelector("#evalSetKind");
  const casesTa = modal.querySelector("#evalSetCases");
  const errEl = modal.querySelector(".eval-form-error");
  const skillSel = modal.querySelector("#evalSetSkill");
  for (const s of availableSkills) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    skillSel.appendChild(opt);
  }
  const fillTemplate = () => { casesTa.value = EVAL_TEMPLATES[kindSel.value] || "[]"; };
  fillTemplate();
  modal.querySelector('[data-act="template"]').addEventListener("click", fillTemplate);
  kindSel.addEventListener("change", () => { if (!casesTa.value.trim() || confirm("Replace cases with the template for this kind?")) fillTemplate(); });
  modal.querySelector('[data-act="save"]').addEventListener("click", () => {
    errEl.classList.add("hidden");
    const name = modal.querySelector("#evalSetName").value.trim();
    if (!name) { errEl.textContent = "Give the set a name."; errEl.classList.remove("hidden"); return; }
    let cases;
    try {
      cases = JSON.parse(casesTa.value);
      if (!Array.isArray(cases) || !cases.length) throw new Error("Cases must be a non-empty JSON array");
    } catch (error) {
      errEl.textContent = `Invalid JSON: ${error.message}`;
      errEl.classList.remove("hidden");
      return;
    }
    send({
      type: "eval_save_set",
      set: { name, kind: kindSel.value, description: modal.querySelector("#evalSetDesc").value.trim() || undefined, cases, skillId: skillSel.value || undefined },
    });
    modal.close();
    toast(`Eval set saved: ${name}`);
  });
  setTimeout(() => modal.querySelector("#evalSetName")?.focus(), 0);
}
evalNewSetBtn?.addEventListener("click", openEvalSetModal);

// --- run dashboard ----------------------------------------------------------
let openDashboardRunId = null;

function refreshOpenEvalDashboard() {
  if (!openDashboardRunId) return;
  const existing = document.querySelector(".eval-dashboard-modal");
  if (!existing) { openDashboardRunId = null; return; }
  const run = evalState.runs.find((r) => r.runId === openDashboardRunId);
  if (run) renderEvalDashboardInto(existing, run);
}

function openEvalDashboard(runId) {
  const run = evalState.runs.find((r) => r.runId === runId);
  if (!run) { toast("Run not found", "warn"); return; }
  document.querySelector(".eval-dashboard-modal")?.remove();
  const modal = openOverlay("eval-dashboard-modal", `
    <div class="command-shell wide" role="dialog" aria-label="Evaluation run">
      <div class="command-head"><strong class="eval-dash-title"></strong><button type="button" class="modal-x" data-close aria-label="Close">×</button></div>
      <div class="eval-dash-body"></div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="ask">Ask Pi about this run</button>
        <button type="button" class="primary" data-close>Close</button>
      </div>
    </div>`);
  openDashboardRunId = runId;
  const origClose = modal.close;
  modal.close = () => { openDashboardRunId = null; origClose(); };
  modal.querySelector('[data-act="ask"]').addEventListener("click", () => {
    modal.close();
    submitSystemPrompt(
      `Call list_eval_data(runId="${runId}") and analyze the evaluation run: summarize pass rate, diagnose the failing cases, and propose specific fixes (prompt, tooling or context changes) that would make them pass.`,
      "Eval run analysis"
    );
  });
  renderEvalDashboardInto(modal, run);
}

function caseLabelFor(set, caseId) {
  const c = (set?.cases || []).find((x) => x.id === caseId);
  return c?.question || c?.prompt || caseId;
}

function renderEvalTrendStrip(run) {
  const points = evalState.trends?.[run.setId] || [];
  if (points.length < 2) return "";
  const bars = points.map((p) => {
    const pct = typeof p.avgScore === "number" ? Math.round(p.avgScore * 100) : 0;
    const cls = [
      "trend-bar",
      p.runId === run.runId ? "current" : "",
      p.baseline ? "baseline" : "",
      p.status !== "complete" ? "running" : "",
    ].filter(Boolean).join(" ");
    const title = `${new Date(p.startedAt).toLocaleString()} · ${typeof p.avgScore === "number" ? `${pct}%` : "unscored"}` +
      `${p.skillVersion ? ` · skill ${p.skillVersion}` : ""}${p.baseline ? " · baseline" : ""}`;
    return `<span class="${cls}" data-trend-run="${escapeHtml(p.runId)}" title="${escapeHtml(title)}"><i style="height:${Math.max(4, pct)}%"></i></span>`;
  }).join("");
  return `
    <div class="eval-trend">
      <div class="eval-trend-head"><b>Score across runs</b><span class="section-hint">${points.length} runs of this set — click a bar to open that run</span></div>
      <div class="eval-trend-bars">${bars}</div>
    </div>`;
}

function renderFlipStrip(run) {
  const set = evalState.sets.find((x) => x.id === run.setId);
  const comp = evalState.comparisons?.[run.runId];
  if (!comp || (!comp.previous && !comp.baseline)) return "";
  const section = (label, c) => {
    if (!c) return "";
    const fixed = c.fixed.map((f) => `<span class="flip fixed" title="${escapeHtml(caseLabelFor(set, f.caseId))}">✔ ${escapeHtml(f.caseId)}</span>`).join("");
    const regressed = c.regressed.map((f) => `<span class="flip regressed" title="${escapeHtml(caseLabelFor(set, f.caseId))}">✘ ${escapeHtml(f.caseId)}</span>`).join("");
    const none = !c.fixed.length && !c.regressed.length ? `<span class="flip none">no case flips</span>` : "";
    return `<div class="flip-row"><b>${label}</b>${fixed}${regressed}${none}</div>`;
  };
  return `
    <div class="eval-flips">
      ${section("Since previous run", comp.previous)}
      ${section("Vs baseline", comp.baseline)}
    </div>`;
}

function renderEvalDashboardInto(modal, run) {
  const s = summarizeRun(run);
  modal.querySelector(".eval-dash-title").textContent = `${run.setName} — ${run.status === "complete" ? "complete" : "running"}`;
  const set = evalState.sets.find((x) => x.id === run.setId);
  const caseById = new Map((set?.cases || []).map((c) => [c.id, c]));
  const rows = (run.results || []).map((r) => {
    const c = caseById.get(r.caseId);
    const label = c?.question || c?.prompt || r.caseId;
    const pct = typeof r.score === "number" ? Math.round(r.score * 100) : r.pass === true ? 100 : r.pass === false ? 0 : null;
    return { r, label, pct };
  });
  const pending = (set?.cases || []).filter((c) => !(run.results || []).some((r) => r.caseId === c.id));
  // Run context: skill binding + config snapshot — what exactly was scored.
  const skillName = run.skillId ? (availableSkills.find((x) => x.id === run.skillId)?.name || run.skillId) : null;
  const cfg = run.configSnapshot || {};
  const contextBits = [];
  if (skillName) contextBits.push(`skill: ${skillName}${run.skillVersion ? ` @ ${run.skillVersion}` : ""}`);
  if (cfg.model) contextBits.push(`model: ${cfg.model}`);
  if (cfg.systemPromptHash) contextBits.push(`system prompt: ${cfg.systemPromptHash} (${cfg.systemPromptChars} chars)`);
  if (cfg.hooks) contextBits.push(`${cfg.hooks} hook${cfg.hooks === 1 ? "" : "s"}`);
  const baselineControl = run.baseline
    ? `<span class="eval-baseline-chip" title="Later runs of this set compare against this run">baseline</span>`
    : `<button type="button" class="text-btn" data-act="pin-baseline" title="Compare later runs of this set against this one">Pin as baseline</button>`;
  const body = modal.querySelector(".eval-dash-body");
  body.innerHTML = `
    <div class="eval-run-context">
      <span class="eval-run-context-bits">${contextBits.length ? escapeHtml(contextBits.join(" · ")) : "no skill/config binding recorded for this run"}</span>
      ${baselineControl}
    </div>
    <div class="eval-kpis">
      <div class="eval-kpi"><b>${s.recorded}/${s.total}</b><span>recorded</span></div>
      <div class="eval-kpi pass"><b>${s.passed}</b><span>passed</span></div>
      <div class="eval-kpi fail"><b>${s.failed}</b><span>failed</span></div>
      <div class="eval-kpi"><b>${scorePercent(s)}</b><span>avg score</span></div>
    </div>
    ${renderEvalTrendStrip(run)}
    ${renderFlipStrip(run)}
    <div class="eval-case-list"></div>`;
  body.querySelector('[data-act="pin-baseline"]')?.addEventListener("click", () => {
    send({ type: "eval_set_baseline", runId: run.runId });
    toast("Baseline pinned — later runs compare against this one");
  });
  body.querySelectorAll("[data-trend-run]").forEach((bar) => bar.addEventListener("click", () => {
    const target = bar.dataset.trendRun;
    if (target && target !== run.runId) openEvalDashboard(target);
  }));
  const list = body.querySelector(".eval-case-list");
  for (const { r, label, pct } of rows) {
    const row = document.createElement("details");
    row.className = `eval-case ${r.pass === true ? "pass" : r.pass === false ? "fail" : "ungraded"}`;
    row.innerHTML = `
      <summary>
        <span class="eval-case-chip"></span>
        <span class="eval-case-label"></span>
        <span class="eval-case-bar"><i></i></span>
        <span class="eval-case-pct"></span>
      </summary>
      <div class="eval-case-detail"></div>`;
    row.querySelector(".eval-case-chip").textContent = r.pass === true ? "PASS" : r.pass === false ? "FAIL" : "…";
    row.querySelector(".eval-case-label").textContent = label;
    row.querySelector(".eval-case-label").title = label;
    row.querySelector(".eval-case-bar i").style.width = `${pct ?? 0}%`;
    row.querySelector(".eval-case-pct").textContent = pct == null ? "—" : `${pct}%`;
    const detail = row.querySelector(".eval-case-detail");
    const parts = [];
    if (r.answer) parts.push(`Answer: ${r.answer}`);
    if (r.reasoning) parts.push(`Grading: ${r.reasoning}`);
    if (r.gradedBy) parts.push(`Graded by: ${r.gradedBy}`);
    detail.textContent = parts.join("\n\n") || "No detail recorded.";
    list.appendChild(row);
  }
  for (const c of pending) {
    const row = document.createElement("div");
    row.className = "eval-case pending-case";
    row.innerHTML = `<span class="eval-case-chip">PENDING</span><span class="eval-case-label"></span>`;
    row.querySelector(".eval-case-label").textContent = c.question || c.prompt || c.id;
    list.appendChild(row);
  }
}

// ===========================================================================
// Composer polish — auto-grow + send-state management.
// ===========================================================================
function autoGrowInput() {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(220, Math.max(52, input.scrollHeight))}px`;
}
input?.addEventListener("input", () => { autoGrowInput(); updateSendButton(); });
autoGrowInput();

// ===========================================================================
// Panel modals — Skills / Evaluations / Settings open from the sidebar nav.
// ===========================================================================
function openStaticModal(id) {
  document.querySelectorAll(".static-modal").forEach((m) => m.classList.toggle("hidden", m.id !== id));
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === "advancedModal") {
    if (!availableSkills.length) send({ type: "list_skills" });
    send({ type: "eval_state" });
    renderToolsList();
    renderHooksList();
  }
  if (id === "settingsModal" && approvalModeMirror && approvalMode) approvalModeMirror.value = approvalMode.value;
  setTimeout(() => modal.querySelector("button, input, select")?.focus(), 0);
}
document.addEventListener("click", (event) => {
  const opener = event.target.closest?.("[data-open-modal]");
  if (opener) { openStaticModal(opener.dataset.openModal); return; }
  if (event.target.closest?.("[data-close-modal]")) {
    event.target.closest(".static-modal")?.classList.add("hidden");
    return;
  }
  if (event.target.classList?.contains("static-modal")) event.target.classList.add("hidden");
});

// Settings ↔ composer approval mode stay in sync.
const approvalModeMirror = document.getElementById("approvalModeMirror");
if (approvalModeMirror && approvalMode) {
  approvalModeMirror.value = approvalMode.value;
  approvalModeMirror.addEventListener("change", () => {
    approvalMode.value = approvalModeMirror.value;
    approvalMode.dispatchEvent(new Event("change"));
  });
  approvalMode.addEventListener("change", () => { approvalModeMirror.value = approvalMode.value; });
}

// ===========================================================================
// System prompt (Settings) + session-context telemetry.
// ===========================================================================
// System prompt + hooks live in the WORKSPACE (.pi-web-chat-config/config.json,
// synced over the socket) so they follow the project, not this browser.
const SYSTEM_PROMPT_KEY = "process-ai-system-prompt"; // legacy — migrated on first load
let harnessConfig = { systemPrompt: "", hooks: [] };
function getSystemPrompt() {
  return (harnessConfig.systemPrompt || "").trim();
}
let configSaveTimer;
function scheduleConfigSave() {
  clearTimeout(configSaveTimer);
  configSaveTimer = setTimeout(() => {
    send({ type: "set_config", config: { systemPrompt: harnessConfig.systemPrompt || "", hooks: harnessConfig.hooks || [] } });
  }, 400);
}
function applyHarnessConfig(config) {
  harnessConfig = {
    systemPrompt: typeof config?.systemPrompt === "string" ? config.systemPrompt : "",
    hooks: Array.isArray(config?.hooks) ? config.hooks : [],
  };
  // One-time migration of pre-existing browser-stored values into the workspace.
  if (!harnessConfig.systemPrompt && !harnessConfig.hooks.length) {
    try {
      const legacySys = (localStorage.getItem(SYSTEM_PROMPT_KEY) || "").trim();
      const legacyHooks = JSON.parse(localStorage.getItem("process-ai-hooks") || "[]");
      if (legacySys || (Array.isArray(legacyHooks) && legacyHooks.length)) {
        harnessConfig = { systemPrompt: legacySys, hooks: Array.isArray(legacyHooks) ? legacyHooks : [] };
        scheduleConfigSave();
        localStorage.removeItem(SYSTEM_PROMPT_KEY);
        localStorage.removeItem("process-ai-hooks");
      }
    } catch (e) {}
  }
  if (systemPromptInput && document.activeElement !== systemPromptInput) systemPromptInput.value = harnessConfig.systemPrompt;
  syncSystemPromptUi();
  renderHooksList();
  renderSessionContext();
}
const systemPromptInput = document.getElementById("systemPromptInput");
const systemPromptCount = document.getElementById("systemPromptCount");
const systemPromptClear = document.getElementById("systemPromptClear");
function syncSystemPromptUi() {
  if (systemPromptCount) {
    const n = (systemPromptInput?.value || "").trim().length;
    systemPromptCount.textContent = n ? `${n.toLocaleString()} chars · ≈ ${Math.round(n / 4).toLocaleString()} tokens per message` : "Empty — nothing extra is sent.";
  }
}
if (systemPromptInput) {
  syncSystemPromptUi();
  systemPromptInput.addEventListener("input", () => {
    harnessConfig.systemPrompt = systemPromptInput.value;
    scheduleConfigSave();
    syncSystemPromptUi();
    renderSessionContext();
  });
}
systemPromptClear?.addEventListener("click", () => {
  if (systemPromptInput) systemPromptInput.value = "";
  harnessConfig.systemPrompt = "";
  scheduleConfigSave();
  syncSystemPromptUi();
  renderSessionContext();
  toast("System prompt cleared");
});

// What the model receives at session level: model, thinking, tools, skills,
// plus whether a user system prompt is active. Rendered above the Telemetry tab.
let lastReadyInfo = null;
const sessionContextEl = document.getElementById("sessionContext");
function renderSessionContext() {
  if (!sessionContextEl) return;
  const info = lastReadyInfo;
  if (!info) { sessionContextEl.innerHTML = ""; return; }
  const tools = info.tools || info.customTools || [];
  const sys = getSystemPrompt();
  sessionContextEl.innerHTML = `
    <div class="sc-row"><b>Model</b><span class="sc-value"></span></div>
    <div class="sc-row"><b>Thinking</b><span class="sc-value sc-thinking"></span></div>
    <div class="sc-row"><b>System prompt</b><span class="sc-value sc-sys"></span></div>
    <div class="sc-row"><b>Hooks</b><span class="sc-value sc-hooks"></span></div>
    <div class="sc-row"><b>Token usage</b><span class="sc-value sc-usage"></span></div>
    <div class="sc-row"><b>Skills</b><span class="sc-value sc-skills"></span></div>
    <details class="sc-tools"><summary><b>Tools</b><span class="sc-value sc-tools-count"></span></summary><div class="sc-tool-chips"></div></details>
    <p class="sc-note">Each message is composed as: system prompt → hooks (before) → approval policy → attachments → your text → hooks (after). Expand a turn below for the exact payload, including “Full message — exactly as sent”.</p>`;
  sessionContextEl.querySelector(".sc-value").textContent = modelLabel(info.model);
  sessionContextEl.querySelector(".sc-thinking").textContent = String(info.thinkingLevel ?? "default");
  sessionContextEl.querySelector(".sc-sys").textContent = sys ? `active · ${sys.length.toLocaleString()} chars (edit in Settings)` : "none (set one in Settings)";
  const activeHooks = loadHooks().filter((h) => h.enabled !== false && (h.instruction || "").trim());
  sessionContextEl.querySelector(".sc-hooks").textContent = activeHooks.length
    ? `${activeHooks.length} active (edit under Advanced → Hooks)`
    : "none (add under Advanced → Hooks)";
  const usageEl = sessionContextEl.querySelector(".sc-usage");
  if (usageEl) {
    if (lastUsage) {
      const cost = lastUsage.cost ? ` · $${lastUsage.cost.toFixed(4)}` : "";
      usageEl.textContent = `last turn: ${lastUsage.input.toLocaleString()} in · ${lastUsage.output.toLocaleString()} out${cost}`;
    } else {
      usageEl.textContent = "reported by the SDK after the first turn";
    }
  }
  sessionContextEl.querySelector(".sc-skills").textContent = availableSkills.length
    ? `${availableSkills.length} available — sent only when you launch one`
    : "none discovered";
  sessionContextEl.querySelector(".sc-tools-count").textContent = tools.length
    ? `${tools.length} callable by the model`
    : "list unavailable";
  const chips = sessionContextEl.querySelector(".sc-tool-chips");
  for (const t of tools) {
    const chip = document.createElement("code");
    chip.textContent = t;
    chips.appendChild(chip);
  }
}

// ===========================================================================
// Advanced modal — tabbed Skills / Tools / Hooks / Evaluations.
// ===========================================================================
// Advanced opens as a large settings-style modal: a left nav rail selects the
// section, the main container on the right shows it.
function openAdvancedTab(tab) {
  openStaticModal("advancedModal");
  setAdvancedTab(tab);
}
function setAdvancedTab(tab) {
  const modal = document.getElementById("advancedModal");
  if (!modal) return;
  modal.querySelectorAll("[data-adv-tab]").forEach((b) => b.classList.toggle("active", b.dataset.advTab === tab));
  modal.querySelectorAll("[data-adv-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.advPane !== tab));
}
document.addEventListener("click", (event) => {
  const tab = event.target.closest?.("[data-adv-tab]");
  if (tab) setAdvancedTab(tab.dataset.advTab);
});

// --- tools pane: everything the model can call this session -----------------
function renderToolsList() {
  const toolsListEl = document.getElementById("toolsList");
  if (!toolsListEl) return;
  const all = lastReadyInfo?.tools || [];
  const custom = new Set(lastReadyInfo?.customTools || []);
  if (!all.length) {
    toolsListEl.innerHTML = `<div class="list-empty">Tool list arrives when the session is ready.</div>`;
    return;
  }
  const sorted = [...all].sort((a, b) => (custom.has(b) ? 1 : 0) - (custom.has(a) ? 1 : 0) || String(a).localeCompare(String(b)));
  toolsListEl.innerHTML = "";
  for (const name of sorted) {
    const row = document.createElement("div");
    row.className = "tool-row";
    row.innerHTML = `<code></code><span class="tool-origin"></span>`;
    row.querySelector("code").textContent = name;
    row.querySelector(".tool-origin").textContent = custom.has(name) ? "harness" : "agent";
    row.querySelector(".tool-origin").className = `tool-origin ${custom.has(name) ? "harness" : "agent"}`;
    toolsListEl.appendChild(row);
  }
}

// --- hooks: standing instructions injected around every message -------------
function loadHooks() {
  return Array.isArray(harnessConfig.hooks) ? harnessConfig.hooks : [];
}
function saveHooks(hooks) {
  harnessConfig.hooks = hooks;
  scheduleConfigSave();
  renderSessionContext();
}
function hooksText(position) {
  return loadHooks()
    .filter((h) => h.enabled !== false && (h.position || "before") === position && (h.instruction || "").trim())
    .map((h) => `- ${h.instruction.trim()}`)
    .join("\n");
}
function renderHooksList() {
  const hooksListEl = document.getElementById("hooksList");
  if (!hooksListEl) return;
  const hooks = loadHooks();
  if (!hooks.length) {
    hooksListEl.innerHTML = `<div class="list-empty">No hooks yet. Add one — e.g. “Always state units” (before) or “End with one open question” (after).</div>`;
    return;
  }
  hooksListEl.innerHTML = "";
  hooks.forEach((hook, i) => {
    const row = document.createElement("div");
    row.className = "hook-row" + (hook.enabled === false ? " disabled" : "");
    row.innerHTML = `
      <label class="hook-enabled" title="Enable or disable this hook"><input type="checkbox" /><span>On</span></label>
      <select class="hook-position" title="Where the hook is injected">
        <option value="before">Before message</option>
        <option value="after">After message</option>
      </select>
      <textarea class="hook-instruction" rows="1" placeholder="Instruction sent with every message…"></textarea>
      <button type="button" class="hook-delete" title="Remove hook">Remove</button>`;
    const enabled = row.querySelector("input");
    enabled.checked = hook.enabled !== false;
    enabled.addEventListener("change", () => { hooks[i].enabled = enabled.checked; saveHooks(hooks); row.classList.toggle("disabled", !enabled.checked); });
    const pos = row.querySelector(".hook-position");
    pos.value = hook.position || "before";
    pos.addEventListener("change", () => { hooks[i].position = pos.value; saveHooks(hooks); });
    const ta = row.querySelector(".hook-instruction");
    ta.value = hook.instruction || "";
    ta.addEventListener("input", () => { hooks[i].instruction = ta.value; saveHooks(hooks); });
    row.querySelector(".hook-delete").addEventListener("click", () => { hooks.splice(i, 1); saveHooks(hooks); renderHooksList(); });
    hooksListEl.appendChild(row);
  });
}
document.getElementById("hookAdd")?.addEventListener("click", () => {
  const hooks = loadHooks();
  hooks.push({ position: "before", instruction: "", enabled: true });
  saveHooks(hooks);
  renderHooksList();
  const rows = document.querySelectorAll("#hooksList .hook-instruction");
  rows[rows.length - 1]?.focus();
});

// ===========================================================================
// Telemetry: the server echoes the EXACT composed payload it hands the model.
// ===========================================================================
let lastPromptTurnEntry = null;
function attachPromptPayload(msg) {
  if (!promptTurns) return;
  const composed = msg.composed || "";
  let entry = lastPromptTurnEntry && !lastPromptTurnEntry.dataset.payloadAttached ? lastPromptTurnEntry : null;
  if (!entry) {
    // Server-initiated prompt (eval run, assessment marking) — its own turn entry.
    entry = document.createElement("details");
    entry.className = "prompt-turn";
    const n = promptTurns.querySelectorAll(".prompt-turn").length + 1;
    entry.innerHTML =
      `<summary><span>Turn ${n} · ${escapeHtml(msg.label || "Harness prompt")}</span><em class="pt-size"></em>` +
      `<time>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></summary><div class="pt-parts"></div>`;
    promptTurns.prepend(entry);
  }
  entry.dataset.payloadAttached = "1";
  const size = entry.querySelector(".pt-size");
  if (size) size.textContent = `≈ ${Math.round(composed.length / 4).toLocaleString()} tokens sent`;
  const seg = document.createElement("details");
  seg.className = "pt-part pt-full";
  seg.innerHTML = `<summary><b>Full message — exactly as sent to the model</b><span></span></summary><pre></pre>`;
  seg.querySelector("summary span").textContent = `${composed.length.toLocaleString()} chars`;
  seg.querySelector("pre").textContent = composed;
  entry.querySelector(".pt-parts")?.appendChild(seg);
  lastPromptTurnEntry = null;
}

// ===========================================================================
// Collapsible right panel.
// ===========================================================================
const INSPECTOR_HIDDEN_KEY = "process-ai-inspector-hidden";
const inspectorShowBtn = document.getElementById("inspectorShow");
function applyInspectorHidden(hidden) {
  appEl?.classList.toggle("inspector-hidden", hidden);
  inspectorShowBtn?.classList.toggle("hidden", !hidden);
  try { localStorage.setItem(INSPECTOR_HIDDEN_KEY, hidden ? "1" : "0"); } catch (e) {}
}
function toggleInspector() {
  applyInspectorHidden(!appEl?.classList.contains("inspector-hidden"));
}
document.getElementById("inspectorToggle")?.addEventListener("click", () => applyInspectorHidden(true));
inspectorShowBtn?.addEventListener("click", () => applyInspectorHidden(false));
applyInspectorHidden(localStorage.getItem(INSPECTOR_HIDDEN_KEY) === "1");

// ===========================================================================
// Real token usage (SDK-reported) + conversation renaming.
// ===========================================================================
let lastUsage = null;
function applyUsage(usage) {
  if (!usage) return;
  const input = Number(usage.input ?? usage.inputTokens ?? 0) || 0;
  const output = Number(usage.output ?? usage.outputTokens ?? 0) || 0;
  const cost = Number(usage.cost?.total ?? 0) || 0;
  if (!input && !output) return;
  lastUsage = { input, output, cost };
  // Replace the newest turn's estimate with the SDK-reported numbers.
  const size = promptTurns?.querySelector(".prompt-turn .pt-size");
  if (size) size.textContent = `${input.toLocaleString()} in · ${output.toLocaleString()} out tokens${cost ? ` · $${cost.toFixed(4)}` : ""}`;
  renderSessionContext();
}

function beginConvoRename(id, btn, titleEl) {
  const store = loadConvos();
  const current = store[id]?.title || titleEl.textContent || "New chat";
  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "convo-rename";
  inputEl.value = current;
  inputEl.addEventListener("click", (e) => e.stopPropagation());
  inputEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const next = inputEl.value.trim();
    if (save && next && next !== current) {
      const s = loadConvos();
      if (s[id]) {
        s[id].title = next.slice(0, 120);
        s[id].customTitle = true;
        saveConvos(s);
        toast("Conversation renamed");
      }
    }
    renderConversationList();
  };
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    if (e.key === "Escape") { e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  inputEl.addEventListener("blur", () => commit(true));
  titleEl.replaceWith(inputEl);
  inputEl.focus();
  inputEl.select();
}
