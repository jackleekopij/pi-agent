/**
 * pi chat widget — runs inside the host's sandboxed iframe.
 *
 * Uses the official MCP Apps guest API (@modelcontextprotocol/ext-apps `App`)
 * to talk to the host over JSON-RPC postMessage. The host forwards our
 * `callServerTool` calls to the MCP server, which drives the real pi agent.
 *
 * Streaming model: pi_send fires the prompt, then we poll pi_events({ since })
 * and re-render assistant bubbles from each event's message snapshot until the
 * agent reports idle.
 */
import { App, applyDocumentTheme, getDocumentTheme } from "@modelcontextprotocol/ext-apps";

// ---------------------------------------------------------------------------
// host bridge
// ---------------------------------------------------------------------------
const app = new App({ name: "pi-chat", version: "0.1.0" }, {}, { autoResize: true });

async function callTool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await app.callServerTool({ name, arguments: args });
  const textItem = res?.content?.find((c: any) => c?.type === "text");
  if (textItem?.text) {
    try {
      return JSON.parse(textItem.text) as T;
    } catch {
      return textItem.text as T;
    }
  }
  return (res?.structuredContent ?? {}) as T;
}

const POLL_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const messagesEl = $("messages");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("send");
const stopBtn = $<HTMLButtonElement>("stop");
const statusEl = $("status");
const modelSel = $<HTMLSelectElement>("model");

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setRunning(running: boolean) {
  sendBtn.disabled = running;
  stopBtn.hidden = !running;
  inputEl.disabled = running;
  statusEl.textContent = running ? "pi is working…" : "ready";
  statusEl.dataset.state = running ? "busy" : "idle";
}

function setError(msg: string) {
  statusEl.textContent = msg;
  statusEl.dataset.state = "error";
}

// ---------------------------------------------------------------------------
// message rendering
// ---------------------------------------------------------------------------
function bubble(role: "user" | "assistant", text: string): HTMLElement {
  const wrap = el("div", `msg ${role}`);
  wrap.appendChild(el("div", "role", role === "user" ? "you" : "pi"));
  const body = el("div", "body");
  body.textContent = text;
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function toolCard(toolName: string, args: unknown): HTMLElement {
  const card = el("div", "tool");
  const head = el("div", "tool-head");
  head.appendChild(el("span", "tool-name", `⚙ ${toolName}`));
  head.appendChild(el("span", "tool-state", "running"));
  card.appendChild(head);
  const argLine = summarizeArgs(args);
  if (argLine) card.appendChild(el("div", "tool-args", argLine));
  const out = el("pre", "tool-out");
  card.appendChild(out);
  messagesEl.appendChild(card);
  scrollToBottom();
  return card;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (typeof a.command === "string") return a.command;
  if (typeof a.path === "string") return a.path;
  if (typeof a.file_path === "string") return a.file_path;
  try {
    return JSON.stringify(a).slice(0, 200);
  } catch {
    return "";
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p && p.type === "text")
      .map((p: any) => p.text)
      .join("");
  }
  return "";
}

function resultText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result.content)) return contentText(result.content);
  return "";
}

// ---------------------------------------------------------------------------
// streaming turn state
// ---------------------------------------------------------------------------
let assistantBody: HTMLElement | null = null;
const toolCards = new Map<string, HTMLElement>();

function resetTurn() {
  assistantBody = null;
  toolCards.clear();
}

function ensureAssistantBubble(): HTMLElement {
  if (!assistantBody) {
    const wrap = bubble("assistant", "");
    assistantBody = wrap.querySelector(".body") as HTMLElement;
  }
  return assistantBody;
}

function handleEvent(ev: any) {
  switch (ev.type) {
    case "message_start": {
      if (ev.message?.role === "assistant") assistantBody = null; // start a fresh bubble
      break;
    }
    case "message_update": {
      const body = ensureAssistantBubble();
      const text = contentText(ev.message?.content);
      if (text) body.textContent = text;
      scrollToBottom();
      break;
    }
    case "message_end": {
      if (ev.message?.role === "assistant") {
        const body = ensureAssistantBubble();
        const text = contentText(ev.message?.content);
        if (text) body.textContent = text;
        assistantBody = null;
      }
      break;
    }
    case "tool_execution_start": {
      toolCards.set(ev.toolCallId, toolCard(ev.toolName, ev.args));
      assistantBody = null; // any further text starts a new bubble after the tool
      break;
    }
    case "tool_execution_update": {
      const card = toolCards.get(ev.toolCallId);
      if (card) (card.querySelector(".tool-out") as HTMLElement).textContent = resultText(ev.partialResult);
      break;
    }
    case "tool_execution_end": {
      const card = toolCards.get(ev.toolCallId);
      if (card) {
        (card.querySelector(".tool-out") as HTMLElement).textContent = resultText(ev.result);
        const state = card.querySelector(".tool-state") as HTMLElement;
        state.textContent = ev.isError ? "error" : "done";
        card.classList.toggle("error", !!ev.isError);
      }
      break;
    }
    case "auto_retry_start":
      statusEl.textContent = `retrying (${ev.attempt}/${ev.maxAttempts})…`;
      break;
    case "compaction_start":
      statusEl.textContent = "compacting context…";
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// send / poll loop
// ---------------------------------------------------------------------------
let polling = false;

async function send() {
  const text = inputEl.value.trim();
  if (!text || polling) return;
  inputEl.value = "";
  bubble("user", text);
  resetTurn();
  setRunning(true);
  polling = true;
  try {
    const res = await callTool<{ cursor: number; error?: string }>("pi_send", { message: text });
    if (res.error) throw new Error(res.error);
    let cursor = res.cursor ?? 0;
    // Poll until pi goes idle.
    for (;;) {
      const page = await callTool<{ events: any[]; cursor: number; idle: boolean }>("pi_events", {
        since: cursor,
      });
      cursor = page.cursor ?? cursor;
      for (const ev of page.events ?? []) handleEvent(ev);
      if (page.idle) break;
      await sleep(POLL_MS);
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    polling = false;
    setRunning(false);
  }
}

async function stop() {
  try {
    await callTool("pi_abort", {});
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
async function loadHistory() {
  const { messages } = await callTool<{ messages: any[] }>("pi_history", {});
  for (const m of messages ?? []) {
    if (m.role === "user") {
      bubble("user", contentText(m.content));
    } else if (m.role === "assistant") {
      const t = contentText(m.content);
      if (t.trim()) bubble("assistant", t);
    } else if (m.role === "toolResult") {
      const card = toolCard(m.toolName ?? "tool", {});
      (card.querySelector(".tool-out") as HTMLElement).textContent = contentText(m.content);
      (card.querySelector(".tool-state") as HTMLElement).textContent = m.isError ? "error" : "done";
    } else if (m.role === "bashExecution") {
      const card = toolCard("bash", { command: m.command });
      (card.querySelector(".tool-out") as HTMLElement).textContent = m.output ?? "";
      (card.querySelector(".tool-state") as HTMLElement).textContent = "done";
    }
  }
}

async function loadModels() {
  try {
    const [{ models }, state] = await Promise.all([
      callTool<{ models: any[] }>("pi_models", {}),
      callTool<any>("pi_state", {}),
    ]);
    const current = state?.model?.id ?? state?.modelId;
    modelSel.innerHTML = "";
    for (const m of models ?? []) {
      const opt = document.createElement("option");
      opt.value = `${m.provider}::${m.id}`;
      opt.textContent = `${m.provider}/${m.id}`;
      if (m.id === current) opt.selected = true;
      modelSel.appendChild(opt);
    }
  } catch {
    modelSel.hidden = true;
  }
}

function wireInput() {
  sendBtn.addEventListener("click", send);
  stopBtn.addEventListener("click", stop);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  modelSel.addEventListener("change", async () => {
    const [provider, modelId] = modelSel.value.split("::");
    if (provider && modelId) await callTool("pi_set_model", { provider, modelId });
  });
}

async function main() {
  wireInput();
  setRunning(false);
  await app.connect();
  applyDocumentTheme(app.getHostContext()?.theme ?? getDocumentTheme());
  app.onhostcontextchanged = () => applyDocumentTheme(app.getHostContext()?.theme ?? "light");
  await loadModels();
  await loadHistory();
  inputEl.focus();
}

main().catch((err) => setError(err instanceof Error ? err.message : String(err)));
