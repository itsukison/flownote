# Detection replay harness

Makes question-detection changes measurable instead of vibe-checked. Nothing in
here runs in the app — it reads the JSONL session logs written by
`electron/services/detectionLog.ts`.

## 1. Capture sessions

Logging is on by default in every run (set `FLOWNOTE_DETECTION_LOG=0` to disable).
One file per transcription session:

```
~/Library/Application Support/Flownote/detection-logs/<timestamp>_<transcriptId>.jsonl
```

Contents (transcript text, detected questions, retrieved chunks, answers) stay on
the machine — they are never uploaded. Delete the directory to purge.

Event types: `session_start`, `segment`, `segment_dropped`, `interim` (throttled
to ~1/800ms), `detection`, `context_memo`, `rewrite`, `retrieval`, `answer`,
`session_end`.

Aim for **5–10 real sessions** before drawing conclusions.

## 2. Label them

```bash
npm run log:labels -- "~/Library/Application Support/Flownote/detection-logs/<file>.jsonl"
```

Writes `<file>.labels.jsonl`, one row per transcript segment, already joined with
what the live detector emitted. Fill in three fields per row:

| field | values | notes |
|---|---|---|
| `is_question` | `true` / `false` | was this actually a question? |
| `addressed_to` | `"user"` / `"other"` | did *the user* need to answer it? |
| `expected_search_text` | string / `null` | for questions with a referent: the self-contained query it should become |

Rows left at `is_question: null` are ignored by the scorer, so partial labelling
is fine. Re-running the command preserves labels you already filled in.

## 3. Score a variant

```bash
npm run log:replay -- <file>.jsonl --variant live      # shipped Realtime detector (baseline)
npm run log:replay -- <file>.jsonl --variant gate      # regex stage-1 only — recall ceiling, zero cost
npm run log:replay -- <file>.jsonl --variant gemini    # proposed stage 2: gate → flash-lite classify + rewrite
```

Useful flags: `--threshold 0.6` (confidence cut for `gemini`), `--model`,
`--context-turns 4`, `--no-gate` (LLM on every segment, to separate gate recall
loss from classifier error), `--show 20`, `--labels <path>`.

Reports precision / recall / F1, per-channel precision for `live` (how much of the
false-positive load is the user's own mic), referent-resolution similarity, and
call latency — plus a retrieval section showing the similarity distribution and
what each candidate RAG floor would keep.

## Reading the output

- **`live` precision** is the current baseline. Any P1 change must beat it on the
  same labels.
- **`gate` recall** bounds the transcript-driven design: whatever the gate misses,
  stage 2 never sees. If recall is low, widen `QUESTION_GATE` in `lib.mjs` — its
  precision doesn't matter.
- **`gemini` latency p95** vs **`live` latency p50** is the answer to "is the
  transcript path fast enough?". Remember the live number starts at
  `speech_stopped`, which `semantic_vad` only declares ~4s in, while the gate can
  fire off an `interim` event — compare against the `interim`→`segment` gap in the
  log, not just against zero.
- The retrieval **floor table** is how `FLOWNOTE_RAG_MIN_SIMILARITY` gets set.
