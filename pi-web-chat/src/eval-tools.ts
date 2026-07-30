/**
 * Evaluation sets — reproducible test suites for the harness, with two case
 * kinds sharing one dashboard:
 *
 *   kind "questions": a question bank (MCQ / short answer). A run poses every
 *     question to the HUMAN through the existing ask_question UI; answers save
 *     via the assessment machinery and sync into the run (auto-mark for MCQ,
 *     model marks short answers via mark_answer).
 *
 *   kind "prompts": prompt → expected-output cases run against the MODEL. The
 *     run sends each case's prompt; the model answers, self-grades against the
 *     server-held expected/rubric, and records via record_eval_result — the
 *     save is deterministic (tool write), never dependent on prose.
 *
 * Storage (per working directory) under .pi-web-chat-evals/:
 *   sets.json    { [setId]: EvalSet }
 *   runs.json    { [runId]: EvalRun }
 *   events.jsonl append-only audit trail
 */
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

export type EvalSetKind = "questions" | "prompts";

export interface EvalQuestionCase {
  id: string;
  type: "multiple_choice" | "short_answer";
  question: string;
  choices?: string[];
  correct?: string;
  expected?: string;
  points?: number;
}

export interface EvalPromptCase {
  id: string;
  prompt: string;
  expected?: string;
  rubric?: string;
}

export interface EvalSet {
  id: string;
  name: string;
  description?: string;
  kind: EvalSetKind;
  cases: Array<EvalQuestionCase | EvalPromptCase>;
  /** The skill this set evaluates (binds runs to skill versions for regression tracking). */
  skillId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Snapshot of the harness configuration a run executed under — a score change
 *  means nothing if a config change can't be ruled out as the cause. */
export interface EvalConfigSnapshot {
  model?: string;
  systemPromptHash?: string;
  systemPromptChars?: number;
  hooks?: number;
}

export interface EvalResult {
  caseId: string;
  answer?: string;
  score?: number;      // 0..1
  pass?: boolean;
  reasoning?: string;
  gradedBy?: "auto" | "llm" | "human";
  recordedAt: string;
}

export interface EvalRun {
  runId: string;
  setId: string;
  setName: string;
  kind: EvalSetKind;
  total: number;
  status: "running" | "complete";
  results: EvalResult[];
  startedAt: string;
  completedAt?: string;
  /** Skill binding at run start — which skill (and exact version) this run scored. */
  skillId?: string;
  skillVersion?: string;
  /** Harness config the run executed under. */
  configSnapshot?: EvalConfigSnapshot;
  /** Trials per case (single-shot = 1). Reserved now so repeat-trial support needs no migration. */
  trials?: number;
  /** Baseline run for its set: later runs compare against this, not just the previous run. */
  baseline?: boolean;
}

// --- persistence -------------------------------------------------------------
function dir(cwd: string): string {
  const d = path.join(cwd, ".pi-web-chat-evals");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const setsFile = (cwd: string) => path.join(dir(cwd), "sets.json");
const runsFile = (cwd: string) => path.join(dir(cwd), "runs.json");

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}
function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function appendLog(cwd: string, entry: unknown): void {
  try { fs.appendFileSync(path.join(dir(cwd), "events.jsonl"), JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
}
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

export function listEvalSets(cwd: string): EvalSet[] {
  return Object.values(readJson<Record<string, EvalSet>>(setsFile(cwd), {}));
}
export function getEvalSet(cwd: string, id: string): EvalSet | undefined {
  return readJson<Record<string, EvalSet>>(setsFile(cwd), {})[id];
}
export function listEvalRuns(cwd: string): EvalRun[] {
  return Object.values(readJson<Record<string, EvalRun>>(runsFile(cwd), {}))
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}
export function getEvalRun(cwd: string, runId: string): EvalRun | undefined {
  return readJson<Record<string, EvalRun>>(runsFile(cwd), {})[runId];
}

function normalizeCases(kind: EvalSetKind, cases: unknown[]): Array<EvalQuestionCase | EvalPromptCase> {
  const out: Array<EvalQuestionCase | EvalPromptCase> = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as Record<string, unknown>;
    if (!c || typeof c !== "object") continue;
    const id = String(c.id || `case-${i + 1}`);
    if (kind === "questions") {
      if (!c.question) continue;
      out.push({
        id,
        type: String(c.type || "").toLowerCase().startsWith("multi") || Array.isArray(c.choices) ? "multiple_choice" : "short_answer",
        question: String(c.question),
        choices: Array.isArray(c.choices) ? c.choices.map(String) : undefined,
        correct: c.correct != null ? String(c.correct) : undefined,
        expected: c.expected != null ? String(c.expected) : undefined,
        points: typeof c.points === "number" ? c.points : undefined,
      });
    } else {
      if (!c.prompt) continue;
      out.push({
        id,
        prompt: String(c.prompt),
        expected: c.expected != null ? String(c.expected) : undefined,
        rubric: c.rubric != null ? String(c.rubric) : undefined,
      });
    }
  }
  return out;
}

export function saveEvalSet(cwd: string, input: { id?: string; name: string; description?: string; kind: EvalSetKind; cases: unknown[]; skillId?: string }): EvalSet {
  const store = readJson<Record<string, EvalSet>>(setsFile(cwd), {});
  const id = input.id || uid("set");
  const kind: EvalSetKind = input.kind === "prompts" ? "prompts" : "questions";
  const cases = normalizeCases(kind, input.cases || []);
  if (!cases.length) throw new Error("Evaluation set has no valid cases");
  const now = new Date().toISOString();
  const set: EvalSet = {
    id,
    name: String(input.name || id),
    description: input.description ? String(input.description) : undefined,
    kind,
    cases,
    skillId: input.skillId ? String(input.skillId) : store[id]?.skillId,
    createdAt: store[id]?.createdAt || now,
    updatedAt: now,
  };
  store[id] = set;
  writeJson(setsFile(cwd), store);
  appendLog(cwd, { event: "set_saved", id, name: set.name, kind, cases: cases.length });
  return set;
}

export function deleteEvalSet(cwd: string, id: string): boolean {
  const store = readJson<Record<string, EvalSet>>(setsFile(cwd), {});
  if (!store[id]) return false;
  delete store[id];
  writeJson(setsFile(cwd), store);
  appendLog(cwd, { event: "set_deleted", id });
  return true;
}

export function createEvalRun(cwd: string, set: EvalSet, opts?: { skillId?: string; skillVersion?: string; configSnapshot?: EvalConfigSnapshot; trials?: number }): EvalRun {
  const runs = readJson<Record<string, EvalRun>>(runsFile(cwd), {});
  const run: EvalRun = {
    runId: uid("run"),
    setId: set.id,
    setName: set.name,
    kind: set.kind,
    total: set.cases.length,
    status: "running",
    results: [],
    startedAt: new Date().toISOString(),
    skillId: opts?.skillId || set.skillId,
    skillVersion: opts?.skillVersion,
    configSnapshot: opts?.configSnapshot,
    trials: opts?.trials || 1,
  };
  runs[run.runId] = run;
  writeJson(runsFile(cwd), runs);
  appendLog(cwd, { event: "run_started", runId: run.runId, setId: set.id, skillId: run.skillId, skillVersion: run.skillVersion });
  return run;
}

/** Mark one run as its set's baseline (clears the flag on the set's other runs). */
export function setBaselineRun(cwd: string, runId: string): EvalRun {
  const runs = readJson<Record<string, EvalRun>>(runsFile(cwd), {});
  const run = runs[runId];
  if (!run) throw new Error(`Unknown eval run: ${runId}`);
  for (const r of Object.values(runs)) {
    if (r.setId === run.setId) r.baseline = r.runId === runId;
  }
  writeJson(runsFile(cwd), runs);
  appendLog(cwd, { event: "baseline_set", runId, setId: run.setId });
  return run;
}

/** Deterministic save of one case result. Upserts by caseId; marks the run
 *  complete when every case has a result. */
export function recordEvalResult(cwd: string, runId: string, result: Omit<EvalResult, "recordedAt">): EvalRun {
  const runs = readJson<Record<string, EvalRun>>(runsFile(cwd), {});
  const run = runs[runId];
  if (!run) throw new Error(`Unknown eval run: ${runId}`);
  const rec: EvalResult = { ...result, recordedAt: new Date().toISOString() };
  if (typeof rec.score === "number") rec.score = Math.max(0, Math.min(1, rec.score));
  if (rec.pass == null && typeof rec.score === "number") rec.pass = rec.score >= 0.5;
  const i = run.results.findIndex((r) => r.caseId === rec.caseId);
  if (i >= 0) run.results[i] = { ...run.results[i], ...rec };
  else run.results.push(rec);
  if (run.results.length >= run.total && run.status !== "complete") {
    run.status = "complete";
    run.completedAt = new Date().toISOString();
  }
  writeJson(runsFile(cwd), runs);
  appendLog(cwd, { event: "result", runId, ...rec });
  return run;
}

export function runSummary(run: EvalRun) {
  const scored = run.results.filter((r) => typeof r.score === "number" || r.pass != null);
  const passed = run.results.filter((r) => r.pass === true).length;
  const failed = run.results.filter((r) => r.pass === false).length;
  const avg = scored.length
    ? scored.reduce((s, r) => s + (typeof r.score === "number" ? r.score : r.pass ? 1 : 0), 0) / scored.length
    : undefined;
  return {
    runId: run.runId, setName: run.setName, kind: run.kind, status: run.status,
    total: run.total, recorded: run.results.length, passed, failed, avgScore: avg,
    skillId: run.skillId, skillVersion: run.skillVersion, baseline: run.baseline === true,
    startedAt: run.startedAt, trials: run.trials || 1,
  };
}

// --- trends + regression detection -------------------------------------------
// Pure reads over the run history. A "flip" is a case whose outcome changed
// between two runs of the same set — surfaced case-by-case because aggregates
// hide a fix and a regression canceling out.

export interface EvalCaseFlip {
  caseId: string;
  from: boolean | null;
  to: boolean | null;
}

export interface EvalRunComparison {
  againstRunId: string;
  regressed: EvalCaseFlip[]; // pass -> fail
  fixed: EvalCaseFlip[];     // fail -> pass
}

function passMap(run: EvalRun): Map<string, boolean | null> {
  const m = new Map<string, boolean | null>();
  for (const r of run.results) m.set(r.caseId, r.pass === true ? true : r.pass === false ? false : null);
  return m;
}

export function compareRuns(prev: EvalRun, curr: EvalRun): EvalRunComparison {
  const before = passMap(prev);
  const after = passMap(curr);
  const regressed: EvalCaseFlip[] = [];
  const fixed: EvalCaseFlip[] = [];
  for (const [caseId, to] of after) {
    const from = before.has(caseId) ? before.get(caseId)! : null;
    if (from === true && to === false) regressed.push({ caseId, from, to });
    if (from === false && to === true) fixed.push({ caseId, from, to });
  }
  return { againstRunId: prev.runId, regressed, fixed };
}

export interface EvalTrendPoint {
  runId: string;
  startedAt: string;
  status: EvalRun["status"];
  avgScore?: number;
  passed: number;
  failed: number;
  recorded: number;
  total: number;
  skillVersion?: string;
  baseline: boolean;
}

/** Per-set run history plus, for each run, flips vs the previous run of the
 *  same set and vs the set's baseline (when one is pinned). */
export function evalAnalytics(cwd: string): {
  trends: Record<string, EvalTrendPoint[]>;
  comparisons: Record<string, { previous?: EvalRunComparison; baseline?: EvalRunComparison }>;
} {
  const runs = listEvalRuns(cwd); // already sorted by startedAt
  const bySet = new Map<string, EvalRun[]>();
  for (const run of runs) {
    if (!bySet.has(run.setId)) bySet.set(run.setId, []);
    bySet.get(run.setId)!.push(run);
  }
  const trends: Record<string, EvalTrendPoint[]> = {};
  const comparisons: Record<string, { previous?: EvalRunComparison; baseline?: EvalRunComparison }> = {};
  for (const [setId, setRuns] of bySet) {
    trends[setId] = setRuns.map((run) => {
      const s = runSummary(run);
      return {
        runId: run.runId, startedAt: run.startedAt, status: run.status,
        avgScore: s.avgScore, passed: s.passed, failed: s.failed,
        recorded: s.recorded, total: run.total,
        skillVersion: run.skillVersion, baseline: run.baseline === true,
      };
    });
    const baseline = setRuns.find((r) => r.baseline === true);
    for (let i = 0; i < setRuns.length; i++) {
      const curr = setRuns[i];
      const entry: { previous?: EvalRunComparison; baseline?: EvalRunComparison } = {};
      if (i > 0) entry.previous = compareRuns(setRuns[i - 1], curr);
      if (baseline && baseline.runId !== curr.runId) entry.baseline = compareRuns(baseline, curr);
      comparisons[curr.runId] = entry;
    }
  }
  return { trends, comparisons };
}

/** Question ids used during a run are prefixed so the assessment flow can sync
 *  answers/marks back into the eval run. */
export const evalQuestionId = (runId: string, caseId: string) => `ev.${runId}.${caseId}`;
export function parseEvalQuestionId(questionId: string): { runId: string; caseId: string } | null {
  const m = /^ev\.(run-[^.]+)\.(.+)$/.exec(String(questionId || ""));
  return m ? { runId: m[1], caseId: m[2] } : null;
}

/** The framing prompt that drives a model-graded "prompts" run. */
export function promptRunFraming(run: EvalRun, set: EvalSet): string {
  const cases = set.cases as EvalPromptCase[];
  const body = cases.map((c, i) =>
    `Case ${i + 1}/${cases.length} — id: ${c.id}\nPrompt: ${c.prompt}` +
    (c.expected ? `\nExpected: ${c.expected}` : "") +
    (c.rubric ? `\nRubric: ${c.rubric}` : "")
  ).join("\n---\n");
  return (
    `[Evaluation run ${run.runId} — set "${set.name}", ${cases.length} case${cases.length === 1 ? "" : "s"}]\n\n` +
    body +
    `\n\nFor EACH case, in order:\n` +
    `1. Produce your best answer to the prompt (use tools if needed).\n` +
    `2. Grade your answer against the Expected/Rubric: score 0..1 and pass true/false. Be strict — grade the answer you produced, not the answer you intended.\n` +
    `3. Call record_eval_result(runId="${run.runId}", caseId, answer, score, pass, reasoning) BEFORE moving to the next case.\n` +
    `After all cases are recorded, give a one-paragraph summary of the run (pass rate, notable failures). ` +
    `Do not skip record_eval_result for any case — the run only completes when every case is recorded.`
  );
}

// --- tools -------------------------------------------------------------------
export function buildEvalTools(cwd: string): ToolDefinition[] {
  return [
    defineTool({
      name: "record_eval_result",
      label: "Record eval result",
      description:
        "Record the graded result of one evaluation case during an eval run. The save is deterministic and idempotent per caseId. " +
        "Call once per case with your answer, a strict self-grade (score 0..1, pass true/false) and one-line reasoning.",
      parameters: Type.Object({
        runId: Type.String({ description: "The eval run id (given in the run framing prompt)." }),
        caseId: Type.String({ description: "The case id being recorded." }),
        answer: Type.Optional(Type.String({ description: "The answer you produced for the case." })),
        score: Type.Optional(Type.Number({ description: "Grade 0..1 against the expected output / rubric." })),
        pass: Type.Optional(Type.Boolean({ description: "Whether the case passes." })),
        reasoning: Type.Optional(Type.String({ description: "One-line grading rationale." })),
      }),
      async execute(_id, params) {
        const run = recordEvalResult(cwd, String(params.runId), {
          caseId: String(params.caseId),
          answer: params.answer ? String(params.answer).slice(0, 8000) : undefined,
          score: typeof params.score === "number" ? params.score : undefined,
          pass: typeof params.pass === "boolean" ? params.pass : undefined,
          reasoning: params.reasoning ? String(params.reasoning).slice(0, 2000) : undefined,
          gradedBy: "llm",
        });
        const s = runSummary(run);
        return {
          content: [{ type: "text" as const, text: `Recorded ${params.caseId} (${s.recorded}/${s.total} done${s.status === "complete" ? " — run complete" : ""}).` }],
          details: { evalRun: run },
        };
      },
    }),

    defineTool({
      name: "save_eval_set",
      label: "Save an evaluation set",
      description:
        "Create or update a reusable evaluation set. kind 'questions' = a question bank posed to the human " +
        "(cases: {id?, type, question, choices?, correct?, expected?, points?}); kind 'prompts' = model-graded cases " +
        "(cases: {id?, prompt, expected?, rubric?}). Use this to turn documents or feedback into regression suites. " +
        "Pass skillId to bind the set to the skill it evaluates — bound runs track scores per skill version.",
      parameters: Type.Object({
        name: Type.String({ description: "Human-readable set name." }),
        kind: Type.String({ description: "'questions' or 'prompts'." }),
        cases: Type.Array(Type.Any(), { description: "The case objects (see description for shapes)." }),
        id: Type.Optional(Type.String({ description: "Stable set id to update an existing set." })),
        description: Type.Optional(Type.String({ description: "What this set evaluates." })),
        skillId: Type.Optional(Type.String({ description: "Skill id this set evaluates (binds runs to skill versions)." })),
      }),
      async execute(_id, params) {
        const set = saveEvalSet(cwd, {
          id: params.id ? String(params.id) : undefined,
          name: String(params.name),
          description: params.description ? String(params.description) : undefined,
          kind: String(params.kind) === "prompts" ? "prompts" : "questions",
          cases: params.cases as unknown[],
          skillId: params.skillId ? String(params.skillId) : undefined,
        });
        return {
          content: [{ type: "text" as const, text: `Saved eval set "${set.name}" [${set.id}] — ${set.cases.length} ${set.kind} case(s). The user can run it from the Evals panel.` }],
          details: { evalSet: set },
        };
      },
    }),

    defineTool({
      name: "list_eval_data",
      label: "List eval sets and runs",
      description: "Read back all evaluation sets and runs with score summaries. Use to review coverage, pass rates and regressions between runs.",
      parameters: Type.Object({
        runId: Type.Optional(Type.String({ description: "Return full detail for one run." })),
      }),
      async execute(_id, params) {
        if (params.runId) {
          const run = getEvalRun(cwd, String(params.runId));
          if (!run) return { content: [{ type: "text" as const, text: `Unknown run ${params.runId}.` }], details: {} };
          return { content: [{ type: "text" as const, text: JSON.stringify({ ...runSummary(run), results: run.results }, null, 2) }], details: {} };
        }
        const payload = {
          sets: listEvalSets(cwd).map((s) => ({ id: s.id, name: s.name, kind: s.kind, cases: s.cases.length, description: s.description, skillId: s.skillId })),
          runs: listEvalRuns(cwd).map(runSummary),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], details: {} };
      },
    }),
  ];
}
