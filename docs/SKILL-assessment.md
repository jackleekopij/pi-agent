---
name: assessment
description: >
  Pose interactive questions (multiple-choice or short-answer) to the user in
  Pi Web Chat, have them answer in a UI component, then mark and review the
  answers. Every answer is saved automatically and durably.
when_to_use: >
  Quizzes, knowledge checks, surveys, intake forms, guided self-assessment, or
  any time you need a structured, marked answer from the user rather than free
  chat. Ask ONE question per turn and wait for the answer before the next.
  DEFAULT TO 5 QUESTIONS when no count is given.
tools: [ask_question, mark_answer, list_answers]
storage: <cwd>/.pi-web-chat-assessment/
---

# Assessment skill

Interactive Q&A for Pi Web Chat. The model asks questions; the user answers in a
rendered component; **answers are saved server-side the instant they're
submitted** (never dependent on the model), and the model marks them on top.

## Protocol (the loop)

1. **Ask** — call `ask_question(...)`. A card renders in the chat. The correct
   answer / rubric you pass stays **server-side** (never sent to the browser).
2. **User answers** in the component and submits.
3. **Auto-save + auto-mark** — the server appends the answer to
   `answers.json` (+ `events.jsonl`). Multiple-choice is auto-marked if you gave
   `correct`. You then receive an `[Assessment]` turn with the user's answer.
4. **Mark** — grade it and call
   `mark_answer(questionId, correct, score, feedback)`. The mark is saved onto
   the answer. (For MCQ the auto-check is shown immediately; still call
   `mark_answer` to record the authoritative grade + feedback.)
5. **Review / score** — call `list_answers()` any time to compute a running or
   final score.

Ask one question per call; wait for the answer before asking the next.
**Default to 5 questions** when the user doesn't specify a count (then tally the
score with `list_answers`).

## Tool contracts

### `ask_question`
| param      | type     | notes |
| ---------- | -------- | ----- |
| `type`     | string   | `"multiple_choice"` or `"short_answer"` |
| `question` | string   | the prompt shown to the user |
| `id`       | string?  | stable id; auto-generated (`q-…`) if omitted |
| `choices`  | string[]? | options for MCQ; auto-labelled A, B, C… |
| `correct`  | string?  | MCQ correct option(s): letter (`A`), 1-based number (`1`), or exact text; comma-separate for multiple. **Server-side only.** |
| `expected` | string?  | short-answer expected answer / grading rubric. **Server-side only.** |
| `points`   | number?  | points the question is worth |

### `mark_answer`
`mark_answer(questionId, correct?, score?, feedback?)` — records your grade on
the user's most recent answer to `questionId`. `score` is 0..1 (use for partial
credit). The raw answer is already saved; this only adds the mark.

### `list_answers`
`list_answers(questionId?)` → `{ count, graded, correct, answers[] }`. Use to
score or summarise. `answers[]` includes `answerText`, `autoMark`, and `mark`.

## Storage (durability guarantee)

Per working directory, under `.pi-web-chat-assessment/`:

- `questions.json` — `{ [id]: { id, type, question, choices, correctIds, expected, points, createdAt } }`
- `answers.json` — append-only array of `AnswerRecord` (every submission kept):
  `{ answerId, questionId, type, question, answerText, answerValue, autoMark?, mark?, createdAt }`
- `events.jsonl` — append-only audit trail of `question` / `answer` / `mark` events.

Because the server writes on submit, **all answers are saved even if the model
never marks them**. Re-run `list_answers` later to recover everything.

## Worked example

```text
ask_question(
  type="multiple_choice",
  question="Which Revit class iterates elements in a document?",
  choices=["Transaction", "FilteredElementCollector", "ElementId", "Document"],
  correct="B",
  points=1
)
# → user picks B → server saves + auto-marks correct → you get an [Assessment] turn
mark_answer(questionId="<id>", correct=true, score=1, feedback="Right — FilteredElementCollector.")

ask_question(
  type="short_answer",
  question="In one sentence, what does a Revit Transaction do?",
  expected="Groups model changes so they can be committed or rolled back atomically."
)
# → user types an answer → server saves → you mark it:
mark_answer(questionId="<id>", correct=true, score=0.8, feedback="Good; also mention rollback.")

list_answers()   # → tally the score at the end
```

## Reproducing a quiz

Drive a fixed quiz from a question bank (see `docs/sample-questions.json`): for
each entry, call `ask_question` with that entry's fields, wait for the answer,
`mark_answer`, then `list_answers` to report. Passing explicit `id`s makes runs
comparable across sessions, and the `.pi-web-chat-assessment/` files are the
reproducible record of every attempt.
