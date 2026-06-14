import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

type ClientMessage =
  | { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "get_state" };

type Json = Record<string, unknown>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.static(path.join(__dirname, "..", "public")));

function send(ws: WebSocket, payload: Json) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
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

async function createSession() {
  const cwd = process.env.PI_CHAT_CWD || process.cwd();
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  return createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    sessionManager: process.env.PI_CHAT_PERSIST === "1"
      ? SessionManager.create(cwd)
      : SessionManager.inMemory(cwd),
  });
}

wss.on("connection", async (ws) => {
  let sessionResult: Awaited<ReturnType<typeof createSession>> | undefined;
  let unsubscribe: (() => void) | undefined;

  async function closeSession() {
    unsubscribe?.();
    unsubscribe = undefined;
    sessionResult?.session.dispose();
    sessionResult = undefined;
  }

  async function startSession() {
    await closeSession();
    send(ws, { type: "status", status: "starting" });
    sessionResult = await createSession();
    const { session, modelFallbackMessage } = sessionResult;

    unsubscribe = session.subscribe((event: any) => {
      const textDelta = assistantTextFromEvent(event);
      if (textDelta) send(ws, { type: "assistant_delta", delta: textDelta });

      const thinkingDelta = thinkingTextFromEvent(event);
      if (thinkingDelta) send(ws, { type: "thinking_delta", delta: thinkingDelta });

      switch (event.type) {
        case "agent_start":
          send(ws, { type: "status", status: "running" });
          break;
        case "agent_end":
          send(ws, { type: "status", status: "idle" });
          send(ws, { type: "messages", messages: session.messages });
          break;
        case "tool_execution_start":
          send(ws, { type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
          break;
        case "tool_execution_update":
          send(ws, { type: "tool_update", toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult });
          break;
        case "tool_execution_end":
          send(ws, { type: "tool_end", toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
          break;
        case "queue_update":
          send(ws, { type: "queue", steering: event.steering, followUp: event.followUp });
          break;
        case "extension_error":
          send(ws, { type: "error", error: event.error });
          break;
      }
    });

    send(ws, {
      type: "ready",
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      modelFallbackMessage,
      messages: session.messages,
    });
  }

  try {
    await startSession();
  } catch (error) {
    send(ws, { type: "error", error: getErrorMessage(error) });
  }

  ws.on("message", async (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", error: "Invalid JSON message" });
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
        send(ws, { type: "user", text });
        send(ws, { type: "assistant_start" });
        await session!.prompt(text, {
          streamingBehavior: session!.isStreaming ? (message.streamingBehavior || "followUp") : undefined,
          source: "api" as any,
        });
      } else if (message.type === "abort") {
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
      send(ws, { type: "error", error: getErrorMessage(error) });
      send(ws, { type: "status", status: "idle" });
    }
  });

  ws.on("close", () => {
    void closeSession();
  });
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => {
  console.log(`Pi Web Chat running at http://localhost:${port}`);
  console.log(`Working directory for Pi tools: ${process.env.PI_CHAT_CWD || process.cwd()}`);
});
