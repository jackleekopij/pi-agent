/**
 * Skill discovery — merges a built-in registry with SKILL.md files scanned from
 * the workspace and the user's global Pi config, so the sidebar can show every
 * available skill and launch it with one click.
 *
 * Sources (deduped by id, first wins):
 *   1. Built-in registry (core harness skills defined below)
 *   2. <cwd>/.pi/skills/<name>/SKILL.md
 *   3. <cwd>/skills/<name>/SKILL.md
 *   4. <cwd>/docs/SKILL-<name>.md   (and <repo-root>/docs when cwd is a subfolder)
 *   5. ~/.pi/skills/<name>/SKILL.md
 *
 * A SKILL.md may start with YAML frontmatter (---) carrying `name`,
 * `description`, `when_to_use`, `tools`; otherwise the first heading / paragraph
 * is used. Discovery is deterministic and file-system only — no model involved.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  tools?: string[];
  source: "built-in" | "workspace" | "global";
  /** Absolute path of the SKILL.md, when file-backed. */
  path?: string;
  /** Prompt template. `{{context}}` is replaced with the user's extra context. */
  prompt: string;
  /** Content-hash version of the skill definition (short SHA of the SKILL.md / registry entry). */
  version?: string;
  /** Human-readable monotonic revision number within this workspace's version store. */
  revision?: number;
}

const BUILTIN_SKILLS: SkillInfo[] = [
  {
    id: "optimal-learning",
    name: "Optimal learning",
    description: "Research-backed study/test workflow: calibrate depth, pre-test, generate vault notes, then retrieval practice with gap tracking.",
    whenToUse: "Learning new material, exam prep, retrieval practice, knowledge tracking.",
    tools: ["ask_question", "mark_answer", "list_answers"],
    source: "built-in",
    prompt:
      "Use the optimal-learning skill workflow.\n{{context}}\n" +
      "Use ask_question for all user inputs, pre-test questions, diagnostic questions and confidence checks so the UI modal captures answers. " +
      "When asking multiple questions, call ask_question multiple times in one turn; the UI batches answers before feedback.",
  },
  {
    id: "assessment",
    name: "Assessment",
    description: "Pose interactive multiple-choice / short-answer questions, auto-save every answer server-side, then mark and score them.",
    whenToUse: "Quizzes, knowledge checks, surveys, structured intake.",
    tools: ["ask_question", "mark_answer", "list_answers"],
    source: "built-in",
    prompt:
      "Run an interactive assessment using the ask_question / mark_answer / list_answers tools.\n{{context}}\n" +
      "Default to 5 questions if no count is given. Ask all questions up front in one turn, wait for the batched answers, " +
      "mark every answer with mark_answer, then give one combined score summary via list_answers.",
  },
  {
    id: "visualize",
    name: "Data visualization",
    description: "Render data as interactive charts, tables, KPIs, network graphs and sequence diagrams via the visualize / render_* tools.",
    whenToUse: "Any time there is data worth showing rather than describing.",
    tools: ["visualize", "render_bar", "render_line", "render_table", "render_network", "render_sequence", "render_kpi"],
    source: "built-in",
    prompt:
      "{{context}}\n" +
      "When you have data to show, call the visualize tool (or a specific render_* tool) so the result renders as an interactive chart/table in the chat. " +
      "Prefer visuals over prose for numeric or relational data.",
  },
  {
    id: "eval-runner",
    name: "Evaluation runner",
    description: "Create and run evaluation sets (question banks or prompt→expected cases), record graded results, and review pass rates.",
    whenToUse: "Regression-testing the harness, grading model behaviour, building datasets.",
    tools: ["save_eval_set", "record_eval_result", "list_eval_data"],
    source: "built-in",
    prompt:
      "You are operating the evaluation workflow of this harness.\n{{context}}\n" +
      "Use save_eval_set to persist new evaluation sets, record_eval_result to log graded case results during a run, " +
      "and list_eval_data to review sets, runs and scores.",
  },
  {
    id: "feedback-review",
    name: "Feedback review",
    description: "Review the human feedback collected on model outputs (ratings, corrections, image annotations) and propose concrete improvements.",
    whenToUse: "Closing the loop: turning saved human feedback into harness/context improvements.",
    tools: ["list_feedback"],
    source: "built-in",
    prompt:
      "Call list_feedback to load all human feedback recorded on previous outputs (ratings, comments, inline corrections, image annotations).\n{{context}}\n" +
      "Summarize recurring issues, then propose concrete, prioritized improvements to prompts, tools or data. " +
      "Where a correction shows ground truth, state what should change so the mistake cannot recur.",
  },
];

// --- SKILL.md parsing --------------------------------------------------------
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  if (!text.startsWith("---")) return { meta, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { meta, body: text };
  const raw = text.slice(3, end);
  const body = text.slice(text.indexOf("\n", end + 1) + 1);
  let currentKey: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1].toLowerCase();
      meta[currentKey] = kv[2].replace(/^[>|][+-]?\s*$/, "").trim();
    } else if (currentKey && /^\s+\S/.test(line)) {
      meta[currentKey] = `${meta[currentKey]} ${line.trim()}`.trim();
    }
  }
  return { meta, body };
}

function firstMeaningfulLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("```")) continue;
    return t.length > 240 ? `${t.slice(0, 240)}…` : t;
  }
  return "";
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function skillFromFile(file: string, source: SkillInfo["source"]): SkillInfo | null {
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const { meta, body } = parseFrontmatter(text);
  const dirName = path.basename(path.dirname(file));
  const fileBase = path.basename(file, ".md");
  const fromFileName = fileBase.toLowerCase().startsWith("skill-") ? fileBase.slice(6) : dirName;
  const name = meta.name || fromFileName;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || fileBase;
  return {
    id,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    description: meta.description || firstMeaningfulLine(body) || "Skill definition file.",
    whenToUse: meta.when_to_use || meta.whentouse || undefined,
    tools: parseList(meta.tools),
    source,
    path: file,
    prompt:
      `Use the "${name}" skill. Read and follow the skill instructions in the file at ${file} before doing anything else.\n{{context}}\n` +
      "Apply the skill's protocol exactly, using its listed tools where specified.",
  };
}

function scanDir(dir: string, source: SkillInfo["source"]): SkillInfo[] {
  const out: SkillInfo[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skill = skillFromFile(path.join(dir, entry.name, "SKILL.md"), source);
      if (skill) out.push(skill);
    } else if (entry.isFile() && /^skill[-_.].+\.md$/i.test(entry.name)) {
      const skill = skillFromFile(path.join(dir, entry.name), source);
      if (skill) out.push(skill);
    }
  }
  return out;
}

// --- skill identity + version store -----------------------------------------
// Every skill gets a stable content-hash version; every change to a skill's
// definition is snapshotted (append-only) so evolution has lineage: diffs,
// rollback, and eval/feedback attribution all hang off {skillId, version}.
//
// Storage (per working directory) under .pi-web-chat-skills/:
//   launches.json            { [skillId]: { count, lastAt, lastVersion } }
//   <skillId>/versions.json  SkillVersionEntry[] (append-only)
//   <skillId>/<hash>.md      full content snapshot per version
//   events.jsonl             append-only audit trail

export interface SkillVersionEntry {
  hash: string;
  revision: number;
  savedAt: string;
  source: SkillInfo["source"];
  path?: string;
  /** Optional annotation: why this version exists. */
  note?: string;
  /** Evidence that drove the change (feedback ids, eval run ids). */
  evidence?: { feedbackIds?: string[]; evalRunId?: string };
  /** "live" versions came from disk/registry; "candidate" versions are model-proposed and not yet promoted. */
  status?: "live" | "candidate";
}

export interface SkillLaunchStats {
  count: number;
  lastAt?: string;
  lastVersion?: string;
}

function skillsStoreDir(cwd: string): string {
  const d = path.join(cwd, ".pi-web-chat-skills");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function skillDir(cwd: string, skillId: string): string {
  const safe = String(skillId).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120) || "skill";
  const d = path.join(skillsStoreDir(cwd), safe);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function readJsonFile<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}
function appendSkillLog(cwd: string, entry: unknown): void {
  try { fs.appendFileSync(path.join(skillsStoreDir(cwd), "events.jsonl"), JSON.stringify(entry) + "\n"); } catch { /* best effort */ }
}

export function hashSkillContent(content: string): string {
  return crypto.createHash("sha1").update(content, "utf8").digest("hex").slice(0, 8);
}

/** The canonical content string a skill's version hash is computed from. */
function skillContent(skill: SkillInfo): string {
  if (skill.path) {
    try { return fs.readFileSync(skill.path, "utf8"); } catch { /* fall through */ }
  }
  // Built-in (or unreadable file): hash the registry definition itself.
  return JSON.stringify({ name: skill.name, description: skill.description, whenToUse: skill.whenToUse, tools: skill.tools, prompt: skill.prompt });
}

export function listSkillVersions(cwd: string, skillId: string): SkillVersionEntry[] {
  return readJsonFile<SkillVersionEntry[]>(path.join(skillDir(cwd, skillId), "versions.json"), []);
}

export function getSkillVersionContent(cwd: string, skillId: string, hash: string): string | undefined {
  const safeHash = String(hash).replace(/[^a-f0-9]/gi, "").slice(0, 40);
  try { return fs.readFileSync(path.join(skillDir(cwd, skillId), `${safeHash}.md`), "utf8"); } catch { return undefined; }
}

/** Snapshot a skill's current content if it changed; returns {hash, revision}.
 *  Append-only: history is never rewritten. Deterministic — no model involved. */
export function snapshotSkill(cwd: string, skill: SkillInfo, opts?: { note?: string; evidence?: SkillVersionEntry["evidence"]; status?: SkillVersionEntry["status"] }): { hash: string; revision: number } {
  const content = skillContent(skill);
  const hash = hashSkillContent(content);
  const dir = skillDir(cwd, skill.id);
  const versionsFile = path.join(dir, "versions.json");
  const versions = readJsonFile<SkillVersionEntry[]>(versionsFile, []);
  const existing = versions.find((v) => v.hash === hash);
  if (existing) return { hash, revision: existing.revision };
  const entry: SkillVersionEntry = {
    hash,
    revision: versions.length + 1,
    savedAt: new Date().toISOString(),
    source: skill.source,
    path: skill.path,
    note: opts?.note,
    evidence: opts?.evidence,
    status: opts?.status || "live",
  };
  versions.push(entry);
  fs.writeFileSync(path.join(dir, `${hash}.md`), content);
  fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2));
  appendSkillLog(cwd, { event: "version", skillId: skill.id, hash, revision: entry.revision, source: skill.source });
  return { hash, revision: entry.revision };
}

const launchesFile = (cwd: string) => path.join(skillsStoreDir(cwd), "launches.json");

export function getSkillLaunches(cwd: string): Record<string, SkillLaunchStats> {
  return readJsonFile<Record<string, SkillLaunchStats>>(launchesFile(cwd), {});
}

/** Deterministic record of one skill launch (called by the server, not the model). */
export function recordSkillLaunch(cwd: string, skillId: string, version?: string): SkillLaunchStats {
  const all = getSkillLaunches(cwd);
  const cur = all[skillId] || { count: 0 };
  const next: SkillLaunchStats = { count: cur.count + 1, lastAt: new Date().toISOString(), lastVersion: version || cur.lastVersion };
  all[skillId] = next;
  fs.writeFileSync(launchesFile(cwd), JSON.stringify(all, null, 2));
  appendSkillLog(cwd, { event: "launch", skillId, version });
  return next;
}

/** Discover every available skill for the given working directory. */
export function listSkills(cwd: string): SkillInfo[] {
  const seen = new Set<string>();
  const out: SkillInfo[] = [];
  const push = (skill: SkillInfo | null) => {
    if (skill && !seen.has(skill.id)) { seen.add(skill.id); out.push(skill); }
  };

  for (const s of BUILTIN_SKILLS) push(s);

  const roots = [cwd];
  const parent = path.dirname(cwd);
  if (parent && parent !== cwd) roots.push(parent); // repo root when cwd is a package
  for (const root of roots) {
    for (const s of scanDir(path.join(root, ".pi", "skills"), "workspace")) push(s);
    for (const s of scanDir(path.join(root, "skills"), "workspace")) push(s);
    for (const s of scanDir(path.join(root, "docs"), "workspace")) push(s);
  }
  for (const s of scanDir(path.join(os.homedir(), ".pi", "skills"), "global")) push(s);

  // Stamp identity: snapshot changed definitions and annotate {version, revision}.
  for (const skill of out) {
    try {
      const { hash, revision } = snapshotSkill(cwd, skill);
      skill.version = hash;
      skill.revision = revision;
    } catch { /* identity is best-effort; discovery must never fail because of it */ }
  }
  return out;
}

/** Compose the prompt that launches a skill, with optional user context. */
export function skillPrompt(skill: SkillInfo, context?: string): string {
  const ctx = (context || "").trim();
  return skill.prompt.replace("{{context}}", ctx ? `Context from the user: ${ctx}\n` : "").replace(/\n{3,}/g, "\n\n").trim();
}
