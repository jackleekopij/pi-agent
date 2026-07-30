/**
 * Human-in-the-loop feedback — every rendered output (assistant text, chart,
 * table, image, MCP UI component) can be rated, commented on, corrected inline,
 * or region-annotated (images). Feedback is saved DETERMINISTICALLY server-side
 * the moment it is submitted — never dependent on the model — building a
 * durable dataset for recursive improvement of the harness and context engine.
 *
 * Storage (per working directory) under .pi-web-chat-feedback/:
 *   feedback.json  FeedbackRecord[]  (every submission, append-only)
 *   events.jsonl   append-only audit trail
 *
 * The model reads it back through the `list_feedback` tool.
 */
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

export type FeedbackTargetType = "assistant" | "viz" | "table" | "image" | "mcp" | "question" | "other";

export interface FeedbackAnnotation {
  /** Normalized [0..1] rect on the image. */
  x: number; y: number; w: number; h: number;
  note: string;
}

export interface FeedbackRecord {
  feedbackId: string;
  targetType: FeedbackTargetType;
  /** DOM message id (msg-N) — ties feedback to a rendered artifact. */
  targetId?: string;
  /** e.g. tool name or viz title that produced the artifact. */
  targetLabel?: string;
  rating?: "up" | "down";
  comment?: string;
  /** Inline correction: what the output said vs. what it should have said. */
  correction?: { original: string; corrected: string };
  /** Image region annotations. */
  annotations?: FeedbackAnnotation[];
  /** Short excerpt of the artifact content for context. */
  excerpt?: string;
  /** Durable attribution — which skill (and version) was active, and where in
   *  which conversation the artifact appeared. targetId is only a DOM id and
   *  is meaningless across sessions; these keys are the cross-session join. */
  skillId?: string;
  skillVersion?: string;
  conversationId?: string;
  turnIndex?: number;
  /** Improvement-loop state: open feedback is unactioned; addressed feedback
   *  has been consumed by a fix. Prevents the same complaint driving repeated edits. */
  status?: "open" | "addressed";
  createdAt: string;
}

function dir(cwd: string): string {
  const d = path.join(cwd, ".pi-web-chat-feedback");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const fbFile = (cwd: string) => path.join(dir(cwd), "feedback.json");

function readAll(cwd: string): FeedbackRecord[] {
  try { return JSON.parse(fs.readFileSync(fbFile(cwd), "utf8")) as FeedbackRecord[]; } catch { return []; }
}
function appendLog(cwd: string, entry: unknown): void {
  try { fs.appendFileSync(path.join(dir(cwd), "events.jsonl"), JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
}
function uid(): string {
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const clamp01 = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

/** Deterministic save of one feedback submission. Returns the stored record. */
export function saveFeedback(cwd: string, input: Partial<FeedbackRecord>): FeedbackRecord {
  const rec: FeedbackRecord = {
    feedbackId: uid(),
    targetType: (input.targetType as FeedbackTargetType) || "other",
    targetId: input.targetId ? String(input.targetId) : undefined,
    targetLabel: input.targetLabel ? String(input.targetLabel).slice(0, 300) : undefined,
    rating: input.rating === "up" || input.rating === "down" ? input.rating : undefined,
    comment: input.comment ? String(input.comment).slice(0, 4000) : undefined,
    correction: input.correction && typeof input.correction === "object"
      ? {
          original: String(input.correction.original ?? "").slice(0, 20000),
          corrected: String(input.correction.corrected ?? "").slice(0, 20000),
        }
      : undefined,
    annotations: Array.isArray(input.annotations)
      ? input.annotations.slice(0, 50).map((a) => ({
          x: clamp01(a?.x), y: clamp01(a?.y), w: clamp01(a?.w), h: clamp01(a?.h),
          note: String(a?.note ?? "").slice(0, 1000),
        }))
      : undefined,
    excerpt: input.excerpt ? String(input.excerpt).slice(0, 1000) : undefined,
    skillId: input.skillId ? String(input.skillId).slice(0, 120) : undefined,
    skillVersion: input.skillVersion ? String(input.skillVersion).slice(0, 40) : undefined,
    conversationId: input.conversationId ? String(input.conversationId).slice(0, 120) : undefined,
    turnIndex: typeof input.turnIndex === "number" && Number.isFinite(input.turnIndex) ? Math.max(0, Math.floor(input.turnIndex)) : undefined,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const all = readAll(cwd);
  all.push(rec);
  fs.writeFileSync(fbFile(cwd), JSON.stringify(all, null, 2));
  appendLog(cwd, { event: "feedback", ...rec });
  return rec;
}

/** Deterministic status flip (open <-> addressed) on one feedback record. */
export function resolveFeedback(cwd: string, feedbackId: string, status: "open" | "addressed" = "addressed"): FeedbackRecord {
  const all = readAll(cwd);
  const rec = all.find((f) => f.feedbackId === feedbackId);
  if (!rec) throw new Error(`Unknown feedback: ${feedbackId}`);
  rec.status = status === "open" ? "open" : "addressed";
  fs.writeFileSync(fbFile(cwd), JSON.stringify(all, null, 2));
  appendLog(cwd, { event: "feedback_status", feedbackId, status: rec.status });
  return rec;
}

export function listFeedback(cwd: string, targetType?: string): FeedbackRecord[] {
  const all = readAll(cwd);
  return targetType ? all.filter((f) => f.targetType === targetType) : all;
}

/** "Open" means actionable and unaddressed — a 👍 never needs a fix, so it is
 *  excluded even though its status field stays "open". */
export function isActionableOpen(f: FeedbackRecord): boolean {
  return f.status !== "addressed" && Boolean(f.correction || f.comment || f.rating === "down" || f.annotations?.length);
}

export function feedbackSummary(cwd: string) {
  const all = readAll(cwd);
  const up = all.filter((f) => f.rating === "up").length;
  const down = all.filter((f) => f.rating === "down").length;
  return {
    count: all.length,
    up,
    down,
    corrections: all.filter((f) => f.correction).length,
    annotated: all.filter((f) => f.annotations?.length).length,
    open: all.filter(isActionableOpen).length,
  };
}

/** Aggregations for the feedback analytics view: breakdowns by target type and
 *  by skill, plus the unresolved queue that feeds the improvement loop. */
export function feedbackAnalytics(cwd: string) {
  const all = readAll(cwd);
  const bucket = () => ({ count: 0, up: 0, down: 0, corrections: 0, open: 0 });
  const byTargetType: Record<string, ReturnType<typeof bucket>> = {};
  const bySkill: Record<string, ReturnType<typeof bucket>> = {};
  const add = (map: Record<string, ReturnType<typeof bucket>>, key: string, f: FeedbackRecord) => {
    const b = (map[key] ||= bucket());
    b.count++;
    if (f.rating === "up") b.up++;
    if (f.rating === "down") b.down++;
    if (f.correction) b.corrections++;
    if (isActionableOpen(f)) b.open++;
  };
  for (const f of all) {
    add(byTargetType, f.targetType || "other", f);
    if (f.skillId) add(bySkill, f.skillId, f);
  }
  const openQueue = all
    .filter(isActionableOpen)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { summary: feedbackSummary(cwd), byTargetType, bySkill, openQueue };
}

export function buildFeedbackTools(cwd: string): ToolDefinition[] {
  return [
    defineTool({
      name: "list_feedback",
      label: "List human feedback",
      description:
        "Read back all human feedback recorded on previous outputs: 👍/👎 ratings, comments, inline corrections " +
        "(original vs. corrected text — treat corrected as ground truth), and image region annotations. " +
        "Records may carry skillId/skillVersion (which skill produced the output) and status open|addressed. " +
        "Use it to find recurring problems and improve future outputs — prioritize status 'open'.",
      parameters: Type.Object({
        targetType: Type.Optional(Type.String({ description: "Filter: assistant | viz | table | image | mcp | question." })),
        skillId: Type.Optional(Type.String({ description: "Only feedback attributed to this skill." })),
        status: Type.Optional(Type.String({ description: "Filter by improvement-loop state: open | addressed." })),
        limit: Type.Optional(Type.Number({ description: "Return only the most recent N records." })),
      }),
      async execute(_id, params) {
        let records = listFeedback(cwd, params.targetType ? String(params.targetType) : undefined);
        if (params.skillId) records = records.filter((f) => f.skillId === String(params.skillId));
        if (params.status === "open") records = records.filter((f) => f.status !== "addressed");
        if (params.status === "addressed") records = records.filter((f) => f.status === "addressed");
        const limit = typeof params.limit === "number" && params.limit > 0 ? Math.floor(params.limit) : undefined;
        if (limit) records = records.slice(-limit);
        const summary = { ...feedbackSummary(cwd), returned: records.length, records };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }], details: { feedback: records } };
      },
    }),
  ];
}
