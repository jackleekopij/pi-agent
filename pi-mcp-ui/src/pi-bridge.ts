/**
 * PiBridge — wraps pi's RpcClient (spawns `pi --mode rpc`) and turns its
 * push-based event stream into a pollable, cursor'd ring buffer.
 *
 * MCP tools are request/response, so the chat widget can't receive a push
 * stream directly. Instead: pi_send fires a prompt, pi streams AgentEvents
 * into this buffer, and the widget polls pi_events({ since }) until the agent
 * goes idle (agent_end). One PiBridge == one live pi session.
 */
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// pi's event/message types live in @earendil-works/pi-agent-core, which is only
// installed nested under pi-coding-agent. We treat events loosely (the widget
// switches on event.type), so a local shape avoids depending on it directly.
type AgentEvent = { type: string; [key: string]: unknown };

export interface PiBridgeOptions {
  /** Working directory the pi coding agent operates in (full read/bash/edit/write). */
  cwd?: string;
  /** Provider name (e.g. "anthropic"); falls back to pi's configured default. */
  provider?: string;
  /** Model id (e.g. "claude-opus-4-5"). */
  model?: string;
  /** Extra env merged over process.env when spawning pi. */
  env?: Record<string, string>;
  /** Max events to retain in the ring buffer. */
  maxEvents?: number;
}

export interface SeqEvent {
  seq: number;
  event: AgentEvent;
}

export interface EventsPage {
  events: Array<AgentEvent & { seq: number }>;
  cursor: number;
  idle: boolean;
}

/**
 * Resolve the bundled pi CLI entry so RpcClient spawns the version we depend on.
 * The package's `exports` map only declares the ESM "import" condition (no deep
 * subpaths, no "require"), so use the ESM resolver and derive cli.js next to the
 * resolved main entry (dist/index.js).
 */
function resolvePiCliPath(): string | undefined {
  try {
    const mainUrl = (import.meta as unknown as { resolve(s: string): string }).resolve(
      "@earendil-works/pi-coding-agent",
    );
    const cli = resolve(dirname(fileURLToPath(mainUrl)), "cli.js");
    if (existsSync(cli)) return cli;
  } catch {
    /* fall through */
  }
  return undefined;
}

export class PiBridge {
  private readonly client: RpcClient;
  private readonly buffer: SeqEvent[] = [];
  private readonly maxEvents: number;
  private seq = 0;
  private started = false;
  private starting?: Promise<void>;
  private idle = true;
  private unsubscribe?: () => void;

  constructor(private readonly opts: PiBridgeOptions = {}) {
    this.maxEvents = opts.maxEvents ?? 5000;
    this.client = new RpcClient({
      cliPath: resolvePiCliPath(),
      cwd: opts.cwd ?? process.cwd(),
      provider: opts.provider,
      model: opts.model,
      env: { ...process.env, ...(opts.env ?? {}) } as Record<string, string>,
    });
  }

  /** Idempotent, concurrency-safe start of the underlying pi process. */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      // Subscribe before start so no early events are lost.
      this.unsubscribe = this.client.onEvent((event: AgentEvent) => this.ingest(event));
      await this.client.start();
      this.started = true;
    })();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private ingest(event: AgentEvent): void {
    if (event.type === "agent_start") this.idle = false;
    if (event.type === "agent_end") this.idle = true;
    this.buffer.push({ seq: ++this.seq, event });
    if (this.buffer.length > this.maxEvents) {
      this.buffer.splice(0, this.buffer.length - this.maxEvents);
    }
  }

  /** Send a user message. Returns the cursor to poll pi_events from. */
  async prompt(message: string): Promise<{ cursor: number }> {
    await this.start();
    const cursor = this.seq;
    this.idle = false;
    await this.client.prompt(message);
    return { cursor };
  }

  /** Queue a steering message to redirect the agent mid-run. */
  async steer(message: string): Promise<void> {
    await this.start();
    await this.client.steer(message);
  }

  async abort(): Promise<void> {
    if (!this.started) return;
    await this.client.abort();
  }

  /** Return buffered events with seq > since, plus the new cursor and idle flag. */
  eventsSince(since: number): EventsPage {
    const events = this.buffer
      .filter((e) => e.seq > since)
      .map((e) => ({ seq: e.seq, ...e.event }));
    const cursor = this.buffer.length ? this.buffer[this.buffer.length - 1].seq : since;
    return { events, cursor, idle: this.idle };
  }

  get currentCursor(): number {
    return this.seq;
  }

  get isIdle(): boolean {
    return this.idle;
  }

  async state() {
    await this.start();
    return this.client.getState();
  }

  async history(): Promise<unknown[]> {
    await this.start();
    return this.client.getMessages();
  }

  async models() {
    await this.start();
    return this.client.getAvailableModels();
  }

  async setModel(provider: string, modelId: string) {
    await this.start();
    return this.client.setModel(provider, modelId);
  }

  /** stderr from the pi process — useful when start() fails (e.g. missing auth). */
  stderr(): string {
    return this.client.getStderr();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.started) {
      await this.client.stop();
      this.started = false;
    }
  }
}
