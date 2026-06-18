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
import { renderData, runVizTool } from "./viz-tools.js";
import { buildMcpUiVizTools } from "./mcp-ui-tools.js";
import { buildQuestionTools, saveAnswer, type AnswerRecord } from "./question-tools.js";

type Attachment = {
  path: string;
  content?: string;
  mime?: string;
  size?: number;
  dataBase64?: string;
};

type ClientMessage =
  | { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp"; attachments?: Attachment[]; approvalPolicy?: string }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "get_state" }
  | { type: "set_cwd"; cwd: string }
  | { type: "read_file"; path: string }
  | { type: "demo_viz"; data?: unknown; hint?: { kind?: string; title?: string } }
  | { type: "viz_tool"; name: string; params?: Record<string, unknown> }
  | { type: "answer"; questionId: string; value: string | string[]; text?: string }
  | { type: "answer_batch"; answers: Array<{ questionId: string; value: string | string[]; text?: string }> };

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

  return createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    customTools: [...buildMcpUiVizTools({ cwd, logger: (level, message, meta) => onMcpLog?.(level, message, meta) }), ...buildQuestionTools(cwd)],
    sessionManager: process.env.PI_CHAT_PERSIST === "1"
      ? SessionManager.create(cwd)
      : SessionManager.inMemory(cwd),
  });
}

let connectionSeq = 0;

wss.on("connection", async (ws) => {
  const connectionId = `ws-${++connectionSeq}`;
  sendLog(ws, "info", "websocket", "Client connected", { connectionId });
  let sessionResult: Awaited<ReturnType<typeof createSession>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let cwd = process.env.PI_CHAT_CWD || process.cwd();

  async function closeSession() {
    log("debug", "session", "Closing session", { connectionId, cwd });
    unsubscribe?.();
    unsubscribe = undefined;
    sessionResult?.session.dispose();
    sessionResult = undefined;
  }

  async function startSession() {
    await closeSession();
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
        case "agent_end":
          send(ws, { type: "status", status: "idle" });
          send(ws, { type: "messages", messages: session.messages });
          break;
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
          }
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
    send(ws, {
      type: "ready",
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      modelFallbackMessage,
      messages: session.messages,
      cwd,
    });
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
        sendLog(ws, "info", "prompt", "User prompt received", { connectionId, chars: text.length, attachments: message.attachments?.length || 0, streamingBehavior: message.streamingBehavior });
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
        const composed = `${approvalPolicy}\n\n${userAndAttachments}`;
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
