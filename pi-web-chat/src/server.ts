import express from "express";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import crypto from "node:crypto";
import { renderData, runVizTool } from "./viz-tools.js";
import { buildMcpUiVizTools } from "./mcp-ui-tools.js";
import { buildQuestionTools, saveAnswer, registerQuestion, type AnswerRecord } from "./question-tools.js";
import { listSkills, recordSkillLaunch, getSkillLaunches, listSkillVersions, getSkillVersionContent } from "./skills-tools.js";
import { buildFeedbackTools, saveFeedback, feedbackSummary, feedbackAnalytics, resolveFeedback, listFeedback, isActionableOpen } from "./feedback-tools.js";
import {
  buildEvalTools, listEvalSets, listEvalRuns, getEvalSet, saveEvalSet, deleteEvalSet,
  createEvalRun, recordEvalResult, runSummary, promptRunFraming, evalQuestionId, parseEvalQuestionId,
  setBaselineRun, evalAnalytics,
  type EvalQuestionCase, type EvalConfigSnapshot,
} from "./eval-tools.js";

type Attachment = {
  path: string;
  content?: string;
  mime?: string;
  size?: number;
  dataBase64?: string;
};

type ClientMessage =
  | { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp"; attachments?: Attachment[]; approvalPolicy?: string; systemPrompt?: string; hooksBefore?: string; hooksAfter?: string; skill?: { id: string; name?: string; version?: string } }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "get_state" }
  | { type: "set_cwd"; cwd: string }
  | { type: "read_file"; path: string }
  | { type: "demo_viz"; data?: unknown; hint?: { kind?: string; title?: string } }
  | { type: "viz_tool"; name: string; params?: Record<string, unknown> }
  | { type: "answer"; questionId: string; value: string | string[]; text?: string }
  | { type: "answer_batch"; answers: Array<{ questionId: string; value: string | string[]; text?: string }> }
  | { type: "list_skills" }
  | { type: "feedback"; record: Record<string, unknown> }
  | { type: "eval_state" }
  | { type: "eval_save_set"; set: { id?: string; name: string; description?: string; kind: string; cases: unknown[]; skillId?: string } }
  | { type: "eval_delete_set"; setId: string }
  | { type: "eval_run"; setId: string }
  | { type: "eval_set_baseline"; runId: string }
  | { type: "feedback_state" }
  | { type: "feedback_resolve"; feedbackId: string; status?: "open" | "addressed" }
  | { type: "skill_versions"; skillId: string }
  | { type: "skill_version_content"; skillId: string; hash: string }
  | { type: "get_config" }
  | { type: "set_config"; config: { systemPrompt?: string; hooks?: unknown[] } };

// --- per-workspace harness config (system prompt + hooks) --------------------
// Stored under <cwd>/.pi-web-chat-config/config.json so it follows the project,
// not the browser.
type HarnessConfig = { systemPrompt?: string; hooks?: unknown[] };
function harnessConfigFile(cwd: string): string {
  const d = path.join(cwd, ".pi-web-chat-config");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return path.join(d, "config.json");
}
function readHarnessConfig(cwd: string): HarnessConfig {
  try { return JSON.parse(fs.readFileSync(harnessConfigFile(cwd), "utf8")) as HarnessConfig; } catch { return {}; }
}
function writeHarnessConfig(cwd: string, patch: HarnessConfig): HarnessConfig {
  const next: HarnessConfig = { ...readHarnessConfig(cwd) };
  if ("systemPrompt" in patch) next.systemPrompt = String(patch.systemPrompt ?? "").slice(0, 16000);
  if ("hooks" in patch) next.hooks = Array.isArray(patch.hooks) ? patch.hooks.slice(0, 50) : [];
  fs.writeFileSync(harnessConfigFile(cwd), JSON.stringify(next, null, 2));
  return next;
}

// --- skill health + run config snapshot --------------------------------------
/** The harness config an eval run executes under, captured at run start so a
 *  score change can't be silently confounded by a config change. */
function configSnapshotFor(cwd: string, model?: string): EvalConfigSnapshot {
  const config = readHarnessConfig(cwd);
  const sys = (config.systemPrompt || "").trim();
  const hooks = Array.isArray(config.hooks)
    ? config.hooks.filter((h) => (h as Record<string, unknown>)?.enabled !== false).length
    : 0;
  return {
    model,
    systemPromptHash: sys ? crypto.createHash("sha1").update(sys, "utf8").digest("hex").slice(0, 8) : undefined,
    systemPromptChars: sys.length || undefined,
    hooks: hooks || undefined,
  };
}

export interface SkillHealth {
  launches: number;
  lastLaunchedAt?: string;
  feedback: { count: number; up: number; down: number; openCorrections: number; open: number };
  latestEval?: { runId: string; setId: string; setName: string; avgScore?: number; delta?: number; skillVersion?: string; startedAt: string };
}

/** One glance per skill: usage, feedback ratio, latest bound-eval score with
 *  delta vs the previous bound run. Pure read over the three stores. */
function buildSkillHealth(cwd: string): Record<string, SkillHealth> {
  const health: Record<string, SkillHealth> = {};
  const entry = (skillId: string): SkillHealth =>
    (health[skillId] ||= { launches: 0, feedback: { count: 0, up: 0, down: 0, openCorrections: 0, open: 0 } });

  const launches = getSkillLaunches(cwd);
  for (const [skillId, stats] of Object.entries(launches)) {
    const h = entry(skillId);
    h.launches = stats.count;
    h.lastLaunchedAt = stats.lastAt;
  }
  for (const f of listFeedback(cwd)) {
    if (!f.skillId) continue;
    const h = entry(f.skillId).feedback;
    h.count++;
    if (f.rating === "up") h.up++;
    if (f.rating === "down") h.down++;
    if (isActionableOpen(f)) {
      h.open++;
      if (f.correction) h.openCorrections++;
    }
  }
  // Latest complete bound run per skill, with delta vs the previous one.
  const allRuns = listEvalRuns(cwd);
  const bySkill = new Map<string, typeof allRuns>();
  for (const run of allRuns) {
    if (!run.skillId || run.status !== "complete") continue;
    if (!bySkill.has(run.skillId)) bySkill.set(run.skillId, []);
    bySkill.get(run.skillId)!.push(run);
  }
  for (const [skillId, runs] of bySkill) {
    const latest = runSummary(runs[runs.length - 1]);
    const previous = runs.length > 1 ? runSummary(runs[runs.length - 2]) : undefined;
    entry(skillId).latestEval = {
      runId: latest.runId,
      setId: runs[runs.length - 1].setId,
      setName: latest.setName,
      avgScore: latest.avgScore,
      delta: typeof latest.avgScore === "number" && typeof previous?.avgScore === "number"
        ? latest.avgScore - previous.avgScore
        : undefined,
      skillVersion: latest.skillVersion,
      startedAt: latest.startedAt,
    };
  }
  return health;
}

const MAX_FILE_BYTES = 200 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function safeName(name: string): string {
  return path.basename(name || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "upload.bin";
}

function uploadDirFor(cwd: string): string {
  const preferred = path.join(cwd, ".pi-web-chat-uploads");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), "pi-web-chat-uploads");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function isTextMime(mime = "", filePath = ""): boolean {
  const m = mime.toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  return m.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript", "application/x-yaml", "application/yaml"].includes(m) ||
    [".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".js", ".ts", ".tsx", ".jsx", ".py", ".html", ".css", ".sql", ".log"].includes(ext);
}

const DEMO_VIZ_DATA = {
  title: "Sample graph-db asset network",
  records: [
    { asset: { assetId: "well-07", displayName: "Well 07", class: "source" }, relationship: { name: "flows_to" }, connectsTo: { assetId: "manifold-a", displayName: "Manifold A", class: "gathering" } },
    { asset: { assetId: "well-12", displayName: "Well 12", class: "source" }, relationship: { name: "flows_to" }, connectsTo: { assetId: "manifold-a", displayName: "Manifold A", class: "gathering" } },
    { asset: { assetId: "manifold-a", displayName: "Manifold A", class: "gathering" }, relationship: { name: "feeds" }, connectsTo: { assetId: "separator-2", displayName: "Separator 2", class: "process" } },
    { asset: { assetId: "separator-2", displayName: "Separator 2", class: "process" }, relationship: { name: "exports_gas" }, connectsTo: { assetId: "compressor-k101", displayName: "K-101", class: "equipment" } },
  ],
};

type Json = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLogLevel = (process.env.PI_WEB_CHAT_LOG_LEVEL as LogLevel) || "info";
const logLevel = LOG_LEVELS[configuredLogLevel] ? configuredLogLevel : "info";
const debugDir = path.join(process.cwd(), ".pi-web-chat-debug");
const logFile = path.join(debugDir, "server.log");
try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}

function safeLogValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 1200 ? `${value.slice(0, 1200)}…[truncated ${value.length} chars]` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeLogValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = /base64|data|blob|content/i.test(key) ? "[redacted/truncated]" : safeLogValue(val);
    }
    return out;
  }
  return value;
}

function log(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>) {
  if (LOG_LEVELS[level] < LOG_LEVELS[logLevel]) return;
  const entry = { ts: new Date().toISOString(), level, service, message, ...(meta ? { meta: safeLogValue(meta) } : {}) };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  try { fs.appendFileSync(logFile, line + "\n"); } catch {}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.static(path.join(__dirname, "..", "public")));

function send(ws: WebSocket, payload: Json) {
  if (ws.readyState === WebSocket.OPEN) {
    const type = String(payload.type || "unknown");
    if (!["assistant_delta", "thinking_delta"].includes(type)) log("debug", "websocket", `send:${type}`, payload);
    ws.send(JSON.stringify(payload));
  }
}

function sendLog(ws: WebSocket, level: LogLevel, service: string, message: string, meta?: Record<string, unknown>) {
  log(level, service, message, meta);
  send(ws, { type: "log", level, service, message, meta: safeLogValue(meta || {}) });
}

function assistantTextFromEvent(event: any): string | undefined {
  const update = event?.assistantMessageEvent;
  if (event?.type === "message_update" && update?.type === "text_delta") return update.delta;
  return undefined;
}

function thinkingTextFromEvent(event: any): string | undefined {
  const update = event?.assistantMessageEvent;
  if (event?.type === "message_update" && update?.type === "thinking_delta") return update.delta;
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createSession(cwd: string, onMcpLog?: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const customTools = [
    ...buildMcpUiVizTools({ cwd, logger: (level, message, meta) => onMcpLog?.(level, message, meta) }),
    ...buildQuestionTools(cwd),
    ...buildFeedbackTools(cwd),
    ...buildEvalTools(cwd),
  ];

  const result = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    customTools,
    sessionManager: process.env.PI_CHAT_PERSIST === "1"
      ? SessionManager.create(cwd)
      : SessionManager.inMemory(cwd),
  });
  return { ...result, customToolNames: customTools.map((t) => t.name) };
}

let connectionSeq = 0;

wss.on("connection", async (ws) => {
  const connectionId = `ws-${++connectionSeq}`;
  sendLog(ws, "info", "websocket", "Client connected", { connectionId });
  let sessionResult: Awaited<ReturnType<typeof createSession>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let cwd = process.env.PI_CHAT_CWD || process.cwd();
  // The skill (and exact version) most recently launched on this connection —
  // stamped onto feedback so improvement data attributes to skill versions.
  let activeSkill: { id: string; name?: string; version?: string } | undefined;

  const sendEvalState = () => {
    const analytics = evalAnalytics(cwd);
    send(ws, {
      type: "eval_state",
      sets: listEvalSets(cwd),
      runs: listEvalRuns(cwd).map((r) => ({ ...r, summary: runSummary(r) })),
      trends: analytics.trends,
      comparisons: analytics.comparisons,
    });
  };

  const sendSkills = () => send(ws, { type: "skills", skills: listSkills(cwd), health: buildSkillHealth(cwd) });

  const sendFeedbackState = () => {
    const analytics = feedbackAnalytics(cwd);
    send(ws, {
      type: "feedback_state",
      summary: analytics.summary,
      byTargetType: analytics.byTargetType,
      bySkill: analytics.bySkill,
      openQueue: analytics.openQueue.slice(0, 200),
      records: listFeedback(cwd).slice(-200),
    });
  };

  async function closeSession() {
    log("debug", "session", "Closing session", { connectionId, cwd });
    unsubscribe?.();
    unsubscribe = undefined;
    sessionResult?.session.dispose();
    sessionResult = undefined;
  }

  async function startSession() {
    await closeSession();
    activeSkill = undefined;
    sendLog(ws, "info", "session", "Starting Pi session", { connectionId, cwd });
    send(ws, { type: "status", status: "starting" });
    sessionResult = await createSession(cwd, (level, message, meta) => sendLog(ws, level, "mcp-ui", message, { connectionId, ...(meta || {}) }));
    const { session, modelFallbackMessage } = sessionResult;

    unsubscribe = session.subscribe((event: any) => {
      const textDelta = assistantTextFromEvent(event);
      if (textDelta) send(ws, { type: "assistant_delta", delta: textDelta });

      const thinkingDelta = thinkingTextFromEvent(event);
      if (thinkingDelta) send(ws, { type: "thinking_delta", delta: thinkingDelta });

      if (!["message_update"].includes(event.type)) log("debug", "pi-sdk", `event:${event.type}`, { connectionId, toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError });

      switch (event.type) {
        case "agent_start":
          send(ws, { type: "status", status: "running" });
          break;
        case "agent_end": {
          send(ws, { type: "status", status: "idle" });
          send(ws, { type: "messages", messages: session.messages });
          // Real token usage from the SDK (last assistant message of the turn).
          const lastAssistant: any = [...session.messages].reverse().find((m: any) => m?.role === "assistant" && m?.usage);
          if (lastAssistant?.usage) send(ws, { type: "usage", usage: lastAssistant.usage });
          break;
        }
        case "tool_execution_start":
          sendLog(ws, "info", "tool", `Started ${event.toolName}`, { connectionId, toolCallId: event.toolCallId, args: event.args });
          send(ws, { type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
          break;
        case "tool_execution_update":
          send(ws, { type: "tool_update", toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult });
          break;
        case "tool_execution_end": {
          sendLog(ws, event.isError ? "error" : "info", "tool", `Finished ${event.toolName}${event.isError ? " with error" : ""}`, { connectionId, toolCallId: event.toolCallId, result: event.result });
          send(ws, { type: "tool_end", toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
          if (event.result?.details?.mcpResult) {
            send(ws, { type: "tool_end", toolCallId: `${event.toolCallId}:mcp-ui`, toolName: event.result.details.mcpTool || event.toolName, result: event.result.details.mcpResult, isError: event.result.details.mcpResult.isError });
          }
          // Tools attach renderable payloads in details (not sent to the model).
          const details = event.result?.details;
          if (Array.isArray(details?.viz) && details.viz.length) {
            send(ws, { type: "viz", toolCallId: event.toolCallId, toolName: event.toolName, viz: details.viz });
          }
          if (details?.question) {
            send(ws, { type: "question", question: details.question });
          }
          if (details?.questionMarked) {
            send(ws, { type: "question_marked", ...details.questionMarked });
            // A mark on an eval-run question syncs into the run's results.
            const evRef = parseEvalQuestionId(details.questionMarked.questionId || "");
            if (evRef) {
              try {
                const mark = details.questionMarked.mark || {};
                recordEvalResult(cwd, evRef.runId, {
                  caseId: evRef.caseId,
                  score: typeof mark.score === "number" ? mark.score : mark.correct === true ? 1 : mark.correct === false ? 0 : undefined,
                  pass: typeof mark.correct === "boolean" ? mark.correct : undefined,
                  reasoning: mark.feedback ? String(mark.feedback) : undefined,
                  gradedBy: "llm",
                });
                sendEvalState();
              } catch (error) {
                log("warn", "evals", "Eval sync from mark failed", { error: getErrorMessage(error) });
              }
            }
          }
          if (details?.evalRun) {
            send(ws, { type: "eval_run_update", run: details.evalRun, summary: runSummary(details.evalRun) });
          }
          if (details?.evalSet) sendEvalState();
          break;
        }
        case "queue_update":
          send(ws, { type: "queue", steering: event.steering, followUp: event.followUp });
          break;
        case "extension_error":
          sendLog(ws, "error", "pi-sdk", "Extension error", { connectionId, error: event.error });
          send(ws, { type: "error", error: event.error });
          break;
      }
    });

    sendLog(ws, "info", "session", "Pi session ready", { connectionId, sessionId: session.sessionId, model: session.model, thinkingLevel: session.thinkingLevel, cwd });
    // Tool names for the telemetry panel: prefer the session's full tool list
    // when the SDK exposes one, else the custom tools this harness registered.
    const sessionTools = (session as any).tools;
    const toolNames: string[] = Array.isArray(sessionTools)
      ? sessionTools.map((t: any) => t?.name ?? t?.definition?.name).filter(Boolean)
      : sessionResult!.customToolNames;
    send(ws, {
      type: "ready",
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      modelFallbackMessage,
      messages: session.messages,
      cwd,
      tools: toolNames,
      customTools: sessionResult!.customToolNames,
    });
    // Push discovery-backed state so the sidebar is populated without a round-trip.
    try { sendSkills(); } catch (error) { log("warn", "skills", "Skill discovery failed", { error: getErrorMessage(error) }); }
    try { sendEvalState(); } catch (error) { log("warn", "evals", "Eval state failed", { error: getErrorMessage(error) }); }
    try { sendFeedbackState(); } catch (error) { log("warn", "feedback", "Feedback state failed", { error: getErrorMessage(error) }); }
    try { send(ws, { type: "config", config: readHarnessConfig(cwd) }); } catch (error) { log("warn", "config", "Config read failed", { error: getErrorMessage(error) }); }
  }

  try {
    await startSession();
  } catch (error) {
    sendLog(ws, "error", "session", "Failed to start Pi session", { connectionId, error: getErrorMessage(error) });
    send(ws, { type: "error", error: getErrorMessage(error) });
  }

  ws.on("message", async (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
      log("debug", "websocket", `recv:${message.type}`, { connectionId, message });
    } catch {
      sendLog(ws, "warn", "websocket", "Invalid JSON message", { connectionId });
      send(ws, { type: "error", error: "Invalid JSON message" });
      return;
    }

    // Render-only paths: no agent/session needed, no tokens spent.
    if (message.type === "demo_viz") {
      try {
        sendLog(ws, "info", "viz", "Rendering demo visualization", { connectionId });
        send(ws, { type: "viz", toolName: "demo", viz: renderData(message.data ?? DEMO_VIZ_DATA, message.hint) });
      } catch (error) {
        sendLog(ws, "error", "viz", "Demo visualization failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: getErrorMessage(error) });
      }
      return;
    }
    // A widget asked the host to run an (allowlisted) viz tool — execute it
    // directly and stream back the result. No model, no prompt injection.
    if (message.type === "viz_tool") {
      try {
        sendLog(ws, "info", "viz", "Running browser-requested viz tool", { connectionId, name: message.name, params: message.params });
        send(ws, { type: "viz", toolName: message.name, viz: runVizTool(message.name, message.params ?? {}) });
      } catch (error) {
        sendLog(ws, "error", "viz", "Viz tool failed", { connectionId, name: message.name, error: getErrorMessage(error) });
        send(ws, { type: "error", error: getErrorMessage(error) });
      }
      return;
    }

    // Set the working directory pi operates in, then restart the session there.
    if (message.type === "set_cwd") {
      try {
        const next = path.resolve(expandHome(String(message.cwd || "").trim()));
        if (!fs.statSync(next).isDirectory()) throw new Error("Not a directory");
        cwd = next;
        sendLog(ws, "info", "workspace", "Working directory changed", { connectionId, cwd });
        send(ws, { type: "cwd", cwd });
        await startSession();
      } catch (error) {
        sendLog(ws, "error", "workspace", "Set working directory failed", { connectionId, cwd: message.cwd, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Set working directory: ${getErrorMessage(error)}` });
      }
      return;
    }

    // Read a file (within the working directory) and return it to the client to
    // attach to the next prompt. No session/tokens needed.
    if (message.type === "read_file") {
      try {
        const rel = String(message.path || "").trim();
        if (!rel) throw new Error("No path given");
        const base = path.resolve(cwd);
        const abs = path.resolve(base, expandHome(rel));
        if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error("Path is outside the working directory");
        if (!fs.statSync(abs).isFile()) throw new Error("Not a file");
        let content = fs.readFileSync(abs, "utf8");
        const truncated = content.length > MAX_FILE_BYTES;
        if (truncated) content = content.slice(0, MAX_FILE_BYTES);
        sendLog(ws, "info", "workspace", "Read file", { connectionId, path: path.relative(base, abs) || path.basename(abs), truncated });
        send(ws, { type: "file", path: path.relative(base, abs) || path.basename(abs), content, truncated });
      } catch (error) {
        sendLog(ws, "error", "workspace", "Read file failed", { connectionId, path: message.path, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Read file: ${getErrorMessage(error)}` });
      }
      return;
    }

    // Workspace harness config (system prompt + hooks) — deterministic saves.
    if (message.type === "get_config") {
      send(ws, { type: "config", config: readHarnessConfig(cwd) });
      return;
    }
    if (message.type === "set_config") {
      try {
        const config = writeHarnessConfig(cwd, message.config || {});
        sendLog(ws, "info", "config", "Harness config saved", { connectionId, systemPromptChars: (config.systemPrompt || "").length, hooks: (config.hooks || []).length });
        send(ws, { type: "config", config });
      } catch (error) {
        sendLog(ws, "error", "config", "Save config failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Save config: ${getErrorMessage(error)}` });
      }
      return;
    }

    // Skills: deterministic filesystem discovery — no session/tokens needed.
    if (message.type === "list_skills") {
      try {
        sendSkills();
      } catch (error) {
        sendLog(ws, "error", "skills", "Skill discovery failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Skills: ${getErrorMessage(error)}` });
      }
      return;
    }

    // Skill version history + snapshot content (for the diff view).
    if (message.type === "skill_versions") {
      try {
        send(ws, { type: "skill_versions", skillId: String(message.skillId || ""), versions: listSkillVersions(cwd, String(message.skillId || "")) });
      } catch (error) {
        send(ws, { type: "error", error: `Skill versions: ${getErrorMessage(error)}` });
      }
      return;
    }
    if (message.type === "skill_version_content") {
      try {
        const skillId = String(message.skillId || "");
        const hash = String(message.hash || "");
        send(ws, { type: "skill_version_content", skillId, hash, content: getSkillVersionContent(cwd, skillId, hash) ?? null });
      } catch (error) {
        send(ws, { type: "error", error: `Skill version content: ${getErrorMessage(error)}` });
      }
      return;
    }

    // Human feedback: SAVE deterministically (the dataset for recursive
    // improvement) and acknowledge. The model reads it later via list_feedback.
    if (message.type === "feedback") {
      try {
        // Server-side skill attribution: inherit the active skill unless the
        // client explicitly attributed the record itself.
        const raw = (message.record || {}) as Record<string, unknown>;
        if (activeSkill && !raw.skillId) {
          raw.skillId = activeSkill.id;
          raw.skillVersion = activeSkill.version;
        }
        const record = saveFeedback(cwd, raw);
        sendLog(ws, "info", "feedback", "Feedback saved", { connectionId, feedbackId: record.feedbackId, targetType: record.targetType, rating: record.rating, skillId: record.skillId });
        send(ws, { type: "feedback_saved", record, summary: feedbackSummary(cwd) });
        sendFeedbackState();
      } catch (error) {
        sendLog(ws, "error", "feedback", "Save feedback failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Save feedback: ${getErrorMessage(error)}` });
      }
      return;
    }
    if (message.type === "feedback_state") {
      sendFeedbackState();
      return;
    }
    if (message.type === "feedback_resolve") {
      try {
        const record = resolveFeedback(cwd, String(message.feedbackId || ""), message.status === "open" ? "open" : "addressed");
        sendLog(ws, "info", "feedback", "Feedback status changed", { connectionId, feedbackId: record.feedbackId, status: record.status });
        sendFeedbackState();
        sendSkills(); // open-corrections counts feed skill health
      } catch (error) {
        send(ws, { type: "error", error: `Feedback status: ${getErrorMessage(error)}` });
      }
      return;
    }

    // Evals: sets/runs state, set management, and starting runs.
    if (message.type === "eval_state") {
      sendEvalState();
      return;
    }
    if (message.type === "eval_save_set") {
      try {
        const set = saveEvalSet(cwd, {
          id: message.set?.id,
          name: String(message.set?.name || ""),
          description: message.set?.description,
          kind: message.set?.kind === "prompts" ? "prompts" : "questions",
          cases: message.set?.cases || [],
          skillId: message.set?.skillId,
        });
        sendLog(ws, "info", "evals", "Eval set saved", { connectionId, setId: set.id, name: set.name, cases: set.cases.length });
        sendEvalState();
      } catch (error) {
        sendLog(ws, "error", "evals", "Save eval set failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Save eval set: ${getErrorMessage(error)}` });
      }
      return;
    }
    if (message.type === "eval_delete_set") {
      deleteEvalSet(cwd, String(message.setId || ""));
      sendEvalState();
      return;
    }
    if (message.type === "eval_set_baseline") {
      try {
        const run = setBaselineRun(cwd, String(message.runId || ""));
        sendLog(ws, "info", "evals", "Baseline pinned", { connectionId, runId: run.runId, setId: run.setId });
        sendEvalState();
      } catch (error) {
        send(ws, { type: "error", error: `Set baseline: ${getErrorMessage(error)}` });
      }
      return;
    }
    if (message.type === "eval_run") {
      try {
        const set = getEvalSet(cwd, String(message.setId || ""));
        if (!set) throw new Error("Unknown eval set");
        // Bind the run to the tested skill's CURRENT version and snapshot the
        // harness config, so "did my edit help?" is answerable later.
        const boundSkill = set.skillId ? listSkills(cwd).find((s) => s.id === set.skillId) : undefined;
        const sessionModel = sessionResult?.session?.model as { id?: string; name?: string } | string | undefined;
        const modelId = sessionModel
          ? typeof sessionModel === "string" ? sessionModel : String(sessionModel.id ?? sessionModel.name ?? "")
          : undefined;
        const run = createEvalRun(cwd, set, {
          skillId: set.skillId,
          skillVersion: boundSkill?.version,
          configSnapshot: configSnapshotFor(cwd, modelId || undefined),
        });
        sendLog(ws, "info", "evals", "Eval run started", { connectionId, runId: run.runId, setId: set.id, kind: set.kind, cases: set.cases.length, skillId: run.skillId, skillVersion: run.skillVersion });
        send(ws, { type: "eval_run_started", run, summary: runSummary(run) });
        sendEvalState();
        if (set.kind === "questions") {
          // Human-answered run: pose every question through the standard
          // question modal; answers/marks sync back into the run.
          for (const c of set.cases as EvalQuestionCase[]) {
            const { pub } = registerQuestion(cwd, {
              id: evalQuestionId(run.runId, c.id),
              type: c.type,
              question: c.question,
              choices: c.choices,
              correct: c.correct,
              expected: c.expected,
              points: c.points,
            });
            send(ws, { type: "question", question: pub });
          }
        } else {
          // Model-graded run: one framing prompt drives answer + strict
          // self-grade + deterministic record_eval_result per case.
          const session = sessionResult?.session;
          if (!session) throw new Error("Session is not ready");
          send(ws, { type: "assistant_start" });
          const framing = promptRunFraming(run, set);
          send(ws, { type: "prompt_payload", label: `Eval run — ${set.name}`, composed: framing });
          await session.prompt(framing, {
            streamingBehavior: session.isStreaming ? "followUp" : undefined,
            source: "api" as any,
          });
        }
      } catch (error) {
        sendLog(ws, "error", "evals", "Eval run failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Eval run: ${getErrorMessage(error)}` });
        send(ws, { type: "status", status: "idle" });
      }
      return;
    }

    // Assessment answers: SAVE deterministically first (every answer is kept,
    // regardless of the model), then hand the full batch to the LLM to mark.
    if (message.type === "answer" || message.type === "answer_batch") {
      let records: AnswerRecord[];
      try {
        const answers = message.type === "answer"
          ? [{ questionId: message.questionId, value: message.value, text: message.text }]
          : message.answers;
        records = answers.map((a) => saveAnswer(cwd, { questionId: a.questionId, value: a.value, text: a.text }));
      } catch (error) {
        sendLog(ws, "error", "assessment", "Save answer failed", { connectionId, error: getErrorMessage(error) });
        send(ws, { type: "error", error: `Save answer: ${getErrorMessage(error)}` });
        return;
      }
      sendLog(ws, "info", "assessment", "Answers saved", { connectionId, count: records.length, questionIds: records.map((r) => r.questionId) });
      for (const rec of records) send(ws, { type: "answer_saved", record: rec });
      send(ws, { type: "answers_saved", records });
      // Answers to eval-run questions sync into the run (MCQ auto-mark grades
      // immediately; short answers record now and pick up the LLM mark later).
      let evalTouched = false;
      for (const rec of records) {
        const evRef = parseEvalQuestionId(rec.questionId);
        if (!evRef) continue;
        try {
          recordEvalResult(cwd, evRef.runId, {
            caseId: evRef.caseId,
            answer: rec.answerText,
            score: rec.autoMark ? (rec.autoMark.correct ? 1 : 0) : undefined,
            pass: rec.autoMark ? rec.autoMark.correct : undefined,
            gradedBy: rec.autoMark ? "auto" : "human",
          });
          evalTouched = true;
        } catch (error) {
          sendLog(ws, "warn", "evals", "Eval sync from answer failed", { connectionId, error: getErrorMessage(error) });
        }
      }
      if (evalTouched) sendEvalState();
      const session = sessionResult?.session;
      if (session) {
        try {
          send(ws, { type: "assistant_start" });
          const body = records.map((rec, i) =>
            `Answer ${i + 1}/${records.length}\n` +
            `Question ID: ${rec.questionId}\n` +
            (rec.question ? `Question: ${rec.question}\n` : "") +
            `User answer: ${rec.answerText}\n` +
            (rec.autoMark ? `Auto-check (MCQ): ${rec.autoMark.correct ? "correct" : "incorrect"}; correct option = ${rec.autoMark.correctChoice}.\n` : "")
          ).join("\n---\n");
          const framing =
            `[Assessment] The user submitted ${records.length} answer${records.length === 1 ? "" : "s"}.\n\n` +
            body +
            `\nMark every submitted answer first. Call mark_answer once for each questionId before giving any user-facing feedback. After all mark_answer calls are complete, provide one combined feedback/score summary. The raw answers are already saved.`;
          send(ws, { type: "prompt_payload", label: "Assessment marking", composed: framing });
          await session.prompt(framing, {
            streamingBehavior: session.isStreaming ? "followUp" : undefined,
            source: "api" as any,
          });
        } catch (error) {
          sendLog(ws, "error", "assessment", "Marking prompt failed", { connectionId, error: getErrorMessage(error) });
          send(ws, { type: "error", error: getErrorMessage(error) });
          send(ws, { type: "status", status: "idle" });
        }
      }
      return;
    }

    const session = sessionResult?.session;
    if (!session && message.type !== "new_session") {
      send(ws, { type: "error", error: "Session is not ready" });
      return;
    }

    try {
      if (message.type === "prompt") {
        const text = message.message.trim();
        if (!text) return;
        // Skill launch attribution: remember the active skill for this
        // connection and record the launch deterministically.
        if (message.skill?.id) {
          activeSkill = { id: String(message.skill.id), name: message.skill.name, version: message.skill.version };
          try {
            recordSkillLaunch(cwd, activeSkill.id, activeSkill.version);
            sendSkills();
          } catch (error) {
            log("warn", "skills", "Record skill launch failed", { error: getErrorMessage(error) });
          }
        }
        sendLog(ws, "info", "prompt", "User prompt received", { connectionId, chars: text.length, attachments: message.attachments?.length || 0, streamingBehavior: message.streamingBehavior, skillId: message.skill?.id });
        send(ws, { type: "user", text }); // echo only the typed text, not attachment bodies
        send(ws, { type: "assistant_start" });
        const attachments = message.attachments ?? [];
        const imageInputs: any[] = [];
        const attachedParts: string[] = [];
        for (const a of attachments) {
          const mime = a.mime || "application/octet-stream";
          const name = safeName(a.path || "upload.bin");
          let savedPath: string | undefined;
          let content = a.content;

          if (a.dataBase64) {
            const bytes = Buffer.from(a.dataBase64, "base64");
            if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`${name} is too large; max upload is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
            const dir = uploadDirFor(cwd);
            savedPath = path.join(dir, `${Date.now()}-${name}`);
            fs.writeFileSync(savedPath, bytes);
            if (!content && isTextMime(mime, name)) content = bytes.toString("utf8").slice(0, MAX_FILE_BYTES);
            if (mime.startsWith("image/")) {
              imageInputs.push({ type: "image", source: { type: "base64", mediaType: mime, data: a.dataBase64 } });
            }
          }

          const size = a.size ? ` (${a.size} bytes)` : "";
          const saved = savedPath ? `\nSaved for tool access at: ${savedPath}` : "";
          if (content) {
            attachedParts.push(`Attached file ${a.path}${size}; MIME: ${mime}${saved}\n\`\`\`\n${content}\n\`\`\``);
          } else {
            attachedParts.push(`Attached file ${a.path}${size}; MIME: ${mime}.${saved}\nThis is a binary or non-text file. Use available tools to inspect the saved path if needed.`);
          }
        }
        const attached = attachedParts.join("\n\n");
        const approvalPolicy = typeof message.approvalPolicy === "string" && message.approvalPolicy.trim()
          ? message.approvalPolicy.trim()
          : "[Process AI Harness command approval mode: Smart approvals]\nAuto-run safe read-only inspection. Use ask_question for destructive, costly, privacy-sensitive, network, install, write, or ambiguous commands.";
        const userAndAttachments = attached ? `${attached}\n\n${text}` : text;
        const systemPrompt = typeof message.systemPrompt === "string" && message.systemPrompt.trim()
          ? `[Harness system prompt — set by the user; follow it for this whole conversation]\n${message.systemPrompt.trim().slice(0, 8000)}`
          : "";
        const hooksBefore = typeof message.hooksBefore === "string" && message.hooksBefore.trim()
          ? `[Harness hooks — applied before every message]\n${message.hooksBefore.trim().slice(0, 4000)}`
          : "";
        const hooksAfter = typeof message.hooksAfter === "string" && message.hooksAfter.trim()
          ? `[Harness hooks — applied after every message]\n${message.hooksAfter.trim().slice(0, 4000)}`
          : "";
        const composed = [systemPrompt, hooksBefore, approvalPolicy, userAndAttachments, hooksAfter].filter(Boolean).join("\n\n");
        // Telemetry: the exact payload handed to the model, verbatim.
        send(ws, { type: "prompt_payload", label: "User turn", composed });
        await session!.prompt(composed, {
          streamingBehavior: session!.isStreaming ? (message.streamingBehavior || "followUp") : undefined,
          source: "api" as any,
          images: imageInputs.length ? imageInputs : undefined,
        } as any);
      } else if (message.type === "abort") {
        sendLog(ws, "warn", "session", "Abort requested", { connectionId });
        await session!.abort();
        send(ws, { type: "status", status: "idle" });
      } else if (message.type === "new_session") {
        await startSession();
      } else if (message.type === "get_state") {
        send(ws, {
          type: "state",
          sessionId: session!.sessionId,
          sessionFile: session!.sessionFile,
          model: session!.model,
          thinkingLevel: session!.thinkingLevel,
          isStreaming: session!.isStreaming,
          messages: session!.messages,
        });
      }
    } catch (error) {
      sendLog(ws, "error", "server", "Message handling failed", { connectionId, type: message.type, error: getErrorMessage(error) });
      send(ws, { type: "error", error: getErrorMessage(error) });
      send(ws, { type: "status", status: "idle" });
    }
  });

  ws.on("close", () => {
    log("info", "websocket", "Client disconnected", { connectionId });
    void closeSession();
  });
});

const requestedPort = Number(process.env.PORT || 8787);

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

async function findPort(start: number): Promise<number> {
  if (process.env.PORT) {
    if (await canListen(start)) return start;
    throw new Error(`Port ${start} is already in use. Stop the existing server or run with PORT=${start + 1} npm run dev.`);
  }
  for (let port = start; port < start + 20; port++) {
    if (await canListen(port)) {
      if (port !== start) console.warn(`Port ${start} is in use; using ${port} instead.`);
      return port;
    }
  }
  throw new Error(`No available port found from ${start} to ${start + 19}.`);
}

wss.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") log("error", "websocket", "WebSocket server error", { error: getErrorMessage(error), code: error.code });
});

try {
  const port = await findPort(requestedPort);
  server.listen(port, () => {
    log("info", "server", "Pi Web Chat started", { port, cwd: process.env.PI_CHAT_CWD || process.cwd(), logFile, logLevel });
    console.log(`Pi Web Chat running at http://localhost:${port}`);
    console.log(`Working directory for Pi tools: ${process.env.PI_CHAT_CWD || process.cwd()}`);
    console.log(`Debug log: ${logFile} (PI_WEB_CHAT_LOG_LEVEL=${logLevel})`);
  });
} catch (error) {
  log("error", "server", "Startup failed", { error: getErrorMessage(error) });
  console.error(getErrorMessage(error));
  process.exit(1);
}
