/**
 * Assessment tools — the LLM passes questions into the chat, the user answers in
 * an interactive component, and EVERY answer is saved deterministically (so a
 * save never depends on the model remembering). The model then marks on top.
 *
 *   ask_question  -> renders an MCQ / short-answer card (correct answer + rubric
 *                    are kept server-side, never sent to the browser)
 *   mark_answer   -> records the model's grade onto the saved answer
 *   list_answers  -> read back all saved answers (+ marks) to score / review
 *
 * Storage (per working directory):
 *   .pi-web-chat-assessment/questions.json  { [id]: StoredQuestion }
 *   .pi-web-chat-assessment/answers.json    AnswerRecord[]   (every submission)
 *   .pi-web-chat-assessment/events.jsonl    append-only audit trail
 */
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

export type QuestionType = "multiple_choice" | "short_answer";
export interface QuestionChoice { id: string; text: string }
export interface StoredQuestion {
  id: string;
  type: QuestionType;
  question: string;
  choices?: QuestionChoice[];
  correctIds?: string[];
  expected?: string;
  points?: number;
  createdAt: string;
}
/** What the browser receives — no correct answer / rubric. */
export interface PublicQuestion {
  id: string;
  type: QuestionType;
  question: string;
  choices?: QuestionChoice[];
  points?: number;
}
export interface AnswerMark { correct?: boolean; score?: number; feedback?: string; by: string; at: string }
export interface AnswerRecord {
  answerId: string;
  questionId: string;
  type: QuestionType;
  question: string;
  answerText: string;
  answerValue: string | string[];
  autoMark?: { correct: boolean; correctChoice?: string };
  mark?: AnswerMark;
  createdAt: string;
}

// --- persistence -------------------------------------------------------------
function dir(cwd: string): string {
  const d = path.join(cwd, ".pi-web-chat-assessment");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const qFile = (cwd: string) => path.join(dir(cwd), "questions.json");
const aFile = (cwd: string) => path.join(dir(cwd), "answers.json");

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
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function resolveCorrect(correct: unknown, choices: QuestionChoice[]): string[] | undefined {
  if (correct == null || correct === "") return undefined;
  const ids: string[] = [];
  for (const partRaw of String(correct).split(/[,;]/)) {
    const p = partRaw.trim();
    if (!p) continue;
    const byLetter = choices.find((c) => c.id.toLowerCase() === p.toLowerCase());
    if (byLetter) { ids.push(byLetter.id); continue; }
    const n = Number(p);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) { ids.push(choices[n - 1].id); continue; }
    const byText = choices.find((c) => c.text.toLowerCase() === p.toLowerCase());
    if (byText) ids.push(byText.id);
  }
  return ids.length ? [...new Set(ids)] : undefined;
}

export function getQuestion(cwd: string, id: string): StoredQuestion | undefined {
  return readJson<Record<string, StoredQuestion>>(qFile(cwd), {})[id];
}

/** Store a question directly (used by ask_question AND server-driven flows like
 *  eval runs) and return both the stored and browser-safe shapes. */
export function registerQuestion(cwd: string, input: {
  id?: string; type: string; question: string; choices?: string[]; correct?: string; expected?: string; points?: number;
}): { stored: StoredQuestion; pub: PublicQuestion } {
  const type: QuestionType = String(input.type).toLowerCase().startsWith("multi") ? "multiple_choice" : "short_answer";
  const id = (input.id && String(input.id)) || uid("q");
  let choices: QuestionChoice[] | undefined;
  let correctIds: string[] | undefined;
  if (type === "multiple_choice") {
    choices = (input.choices ?? []).map((c, i) => ({ id: String.fromCharCode(65 + i), text: String(c) }));
    correctIds = resolveCorrect(input.correct, choices);
  }
  const q: StoredQuestion = {
    id, type, question: String(input.question), choices, correctIds,
    expected: input.expected ? String(input.expected) : undefined,
    points: typeof input.points === "number" ? input.points : undefined,
    createdAt: new Date().toISOString(),
  };
  const store = readJson<Record<string, StoredQuestion>>(qFile(cwd), {});
  store[id] = q;
  writeJson(qFile(cwd), store);
  appendLog(cwd, { event: "question", id, type, question: q.question });
  const pub: PublicQuestion = { id, type, question: q.question, choices, points: q.points };
  return { stored: q, pub };
}

/** Deterministic save of one submission. Auto-marks MCQ when the correct answer
 *  is known. Always appends — every answer is kept. */
export function saveAnswer(cwd: string, input: { questionId: string; value: string | string[]; text?: string }): AnswerRecord {
  const q = getQuestion(cwd, input.questionId);
  const answerValue = input.value;
  const answerText = input.text ?? (Array.isArray(answerValue) ? answerValue.join(", ") : String(answerValue ?? ""));
  let autoMark: AnswerRecord["autoMark"];
  if (q?.type === "multiple_choice" && q.correctIds?.length && q.choices) {
    const sel = (Array.isArray(answerValue) ? answerValue : [answerValue]).map(String);
    const correct = sel.length === q.correctIds.length && sel.every((s) => q.correctIds!.includes(s));
    const correctChoice = q.choices.filter((c) => q.correctIds!.includes(c.id)).map((c) => `${c.id}. ${c.text}`).join("; ");
    autoMark = { correct, correctChoice };
  }
  const rec: AnswerRecord = {
    answerId: uid("a"),
    questionId: input.questionId,
    type: q?.type ?? "short_answer",
    question: q?.question ?? "",
    answerText,
    answerValue,
    autoMark,
    createdAt: new Date().toISOString(),
  };
  const answers = readJson<AnswerRecord[]>(aFile(cwd), []);
  answers.push(rec);
  writeJson(aFile(cwd), answers);
  appendLog(cwd, { event: "answer", ...rec });
  return rec;
}

export function markAnswer(cwd: string, questionId: string, mark: Omit<AnswerMark, "by" | "at">): AnswerRecord | undefined {
  const answers = readJson<AnswerRecord[]>(aFile(cwd), []);
  for (let i = answers.length - 1; i >= 0; i--) {
    if (answers[i].questionId === questionId) {
      answers[i].mark = { ...mark, by: "llm", at: new Date().toISOString() };
      writeJson(aFile(cwd), answers);
      appendLog(cwd, { event: "mark", questionId, answerId: answers[i].answerId, mark: answers[i].mark });
      return answers[i];
    }
  }
  return undefined;
}

export function listAnswers(cwd: string, questionId?: string): AnswerRecord[] {
  const answers = readJson<AnswerRecord[]>(aFile(cwd), []);
  return questionId ? answers.filter((a) => a.questionId === questionId) : answers;
}

// --- tools -------------------------------------------------------------------
export function buildQuestionTools(cwd: string): ToolDefinition[] {
  return [
    defineTool({
      name: "ask_question",
      label: "Ask the user a question",
      description:
        "Render an interactive question in the chat for the user to answer. Supports type 'multiple_choice' (provide choices + correct) " +
        "or 'short_answer' (optionally provide expected/rubric). The correct answer and rubric stay server-side. The user's answer is " +
        "saved automatically and sent back for you to grade — then call mark_answer(questionId, ...). Ask one question per call.",
      promptSnippet: "ask_question(type, question, choices?, correct?, expected?) — pose an interactive MCQ / short-answer question.",
      promptGuidelines: [
        "When the user asks for a quiz / assessment / to be tested without specifying how many questions, default to 5 questions. Ask all questions up front in the same turn using multiple ask_question calls, not one-at-a-time.",
        "Do not provide feedback after each individual question when multiple questions are pending. Wait until the user has answered all questions; the UI sends the answers back as one batch.",
        "After the batched answers arrive, mark every answer and call mark_answer once per questionId, then provide combined feedback/score only after all marks are recorded.",
        "Every answer is already saved server-side; mark_answer only records your grade. Use list_answers to compute a final tally after the batch.",
      ],
      parameters: Type.Object({
        type: Type.String({ description: "'multiple_choice' or 'short_answer'." }),
        question: Type.String({ description: "The question text shown to the user." }),
        id: Type.Optional(Type.String({ description: "Stable question id (auto-generated if omitted)." })),
        choices: Type.Optional(Type.Array(Type.String(), { description: "Answer options (multiple_choice). Labelled A, B, C…" })),
        correct: Type.Optional(Type.String({ description: "Correct option(s) for MCQ — letter (A), 1-based number, or exact text; comma-separate for multiple. Kept server-side." })),
        expected: Type.Optional(Type.String({ description: "Expected answer or grading rubric for short_answer. Kept server-side." })),
        points: Type.Optional(Type.Number({ description: "Points the question is worth." })),
      }),
      async execute(_id, params) {
        const { stored, pub } = registerQuestion(cwd, {
          id: params.id ? String(params.id) : undefined,
          type: String(params.type),
          question: String(params.question),
          choices: params.choices?.map(String),
          correct: params.correct ? String(params.correct) : undefined,
          expected: params.expected ? String(params.expected) : undefined,
          points: typeof params.points === "number" ? params.points : undefined,
        });
        const { id, type } = stored;
        const summary =
          `Rendered a ${type === "multiple_choice" ? "multiple-choice" : "short-answer"} question [${id}] in the chat. ` +
          `The user will answer in the component; their answer is saved automatically and sent back to you to mark — ` +
          `then call mark_answer(questionId="${id}", ...).`;
        return { content: [{ type: "text" as const, text: summary }], details: { question: pub } };
      },
    }),

    defineTool({
      name: "mark_answer",
      label: "Mark an answer",
      description:
        "Record your grade for the user's most recent answer to a question. The raw answer is already saved; this adds your mark (correct / score / feedback).",
      parameters: Type.Object({
        questionId: Type.String({ description: "The question id you are marking." }),
        correct: Type.Optional(Type.Boolean({ description: "Whether the answer is correct." })),
        score: Type.Optional(Type.Number({ description: "Score from 0 to 1 (use for partial credit)." })),
        feedback: Type.Optional(Type.String({ description: "Short feedback shown to the user." })),
      }),
      async execute(_id, params) {
        const rec = markAnswer(cwd, String(params.questionId), {
          correct: typeof params.correct === "boolean" ? params.correct : undefined,
          score: typeof params.score === "number" ? params.score : undefined,
          feedback: params.feedback ? String(params.feedback) : undefined,
        });
        if (!rec) {
          return {
            content: [{ type: "text" as const, text: `No saved answer found for question ${params.questionId}.` }],
            details: { questionMarked: null as null | { questionId: string; answerId: string; mark: AnswerMark } },
          };
        }
        const m = rec.mark!;
        const verdict = m.correct === true ? "correct" : m.correct === false ? "incorrect" : "scored";
        return {
          content: [{ type: "text" as const, text: `Marked ${rec.questionId}: ${verdict}${m.score != null ? ` (${Math.round(m.score * 100)}%)` : ""}.` }],
          details: { questionMarked: { questionId: rec.questionId, answerId: rec.answerId, mark: m } },
        };
      },
    }),

    defineTool({
      name: "list_answers",
      label: "List saved answers",
      description: "Read back the user's saved answers (and marks). Use to review progress or compute a total score.",
      parameters: Type.Object({
        questionId: Type.Optional(Type.String({ description: "Filter to one question id." })),
      }),
      async execute(_id, params) {
        const answers = listAnswers(cwd, params.questionId ? String(params.questionId) : undefined);
        const graded = answers.filter((a) => a.mark || a.autoMark);
        const correct = answers.filter((a) => (a.mark?.correct ?? a.autoMark?.correct) === true).length;
        const summary = { count: answers.length, graded: graded.length, correct, answers };
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }], details: { answers } };
      },
    }),
  ];
}
