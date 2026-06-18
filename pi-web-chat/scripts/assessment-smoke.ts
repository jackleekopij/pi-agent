/**
 * Deterministic smoke for the assessment tools — no LLM, no server.
 * Verifies: question stored server-side (correct answer NOT exposed to client),
 * every answer saved + auto-marked, mark_answer records a grade, list_answers
 * returns everything.
 *
 *   npm run assess:smoke -w pi-web-chat
 */
import fs from "node:fs";
import path from "node:path";
import { buildQuestionTools, saveAnswer, listAnswers, getQuestion } from "../src/question-tools.js";

const cwd = path.join(process.env.TMPDIR || "/tmp", "pi-assess-smoke");
fs.rmSync(cwd, { recursive: true, force: true });
fs.mkdirSync(cwd, { recursive: true });

const tools = buildQuestionTools(cwd);
const ask = tools.find((t) => t.name === "ask_question")!;
const mark = tools.find((t) => t.name === "mark_answer")!;
const list = tools.find((t) => t.name === "list_answers")!;
const ctx = undefined as never;
const store = path.join(cwd, ".pi-web-chat-assessment");

function assert(cond: unknown, msg: string) {
  if (!cond) { console.error("  ✗ " + msg); process.exitCode = 1; } else console.log("  ✓ " + msg);
}

const r1 = await ask.execute("c1", { type: "multiple_choice", question: "2 + 2 = ?", choices: ["3", "4", "5"], correct: "B", id: "q-math", points: 1 } as never, undefined, undefined, ctx);
const q = (r1 as { details: { question: any } }).details.question;
assert(q.id === "q-math" && q.type === "multiple_choice" && q.choices.length === 3, "ask_question returns a public spec");
assert(!("correct" in q) && !("correctIds" in q) && !q.expected, "correct answer is NOT exposed to the client");
assert(getQuestion(cwd, "q-math")?.correctIds?.[0] === "B", "correct answer is stored server-side (B)");

const rec = saveAnswer(cwd, { questionId: "q-math", value: "B", text: "B. 4" });
assert(rec.autoMark?.correct === true, "correct MCQ is auto-marked correct");
assert(JSON.parse(fs.readFileSync(path.join(store, "answers.json"), "utf8")).length === 1, "answer persisted to answers.json");
assert(fs.existsSync(path.join(store, "events.jsonl")), "events.jsonl audit trail written");

const rec2 = saveAnswer(cwd, { questionId: "q-math", value: "A", text: "A. 3" });
assert(rec2.autoMark?.correct === false, "wrong MCQ is auto-marked incorrect (and still saved)");

await ask.execute("c2", { type: "short_answer", question: "Capital of France?", expected: "Paris", id: "q-fr" } as never, undefined, undefined, ctx);
const rec3 = saveAnswer(cwd, { questionId: "q-fr", value: "Paris", text: "Paris" });
assert(!rec3.autoMark, "short answer is not auto-marked (awaits the model)");
const rm = await mark.execute("c3", { questionId: "q-fr", correct: true, score: 1, feedback: "Correct." } as never, undefined, undefined, ctx);
assert((rm as { details: { questionMarked: any } }).details.questionMarked?.mark?.correct === true, "mark_answer records the grade + returns questionMarked");
assert(listAnswers(cwd, "q-fr")[0].mark?.correct === true, "mark is persisted onto the saved answer");

const rl = await list.execute("c4", {} as never, undefined, undefined, ctx);
assert((rl as { details: { answers: any[] } }).details.answers.length === 3, "list_answers returns all 3 saved answers");

fs.rmSync(cwd, { recursive: true, force: true });
console.log(process.exitCode ? "\nassessment-smoke FAILED" : "\nassessment-smoke passed");
