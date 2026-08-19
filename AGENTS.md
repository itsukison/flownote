# AGENTS.md — Flownote (CueMe)

> Orientation doc for AI agents / new engineers working in this repo.
> Written 2026-07 against the code on `main` (commit `d17fea4`). When the code and
> the older `agent/architecture.md` disagree, **this file and the code win** — that
> doc predates the AmiVoice migration and still describes a Gemini-Live detector.

---

## 1. What this app is

Flownote (internal codename **CueMe**) is an **Electron desktop AI meeting/interview
assistant** for Japanese business conversations. During a live call it:

1. **Transcribes** both sides of the conversation in real time (mic + system audio).
2. **Optionally detects questions** aimed at the user and lists them in a floating overlay.
3. **Generates answers on demand**, grounded in the user's uploaded documents (RAG).

Target users: sales / consulting / interview scenarios. UI language is **Japanese-first**.

---

## 2. Repo layout (the parts that matter)

```
flownote/
├── electron/                     # Main process (Node). API keys live ONLY here.
│   ├── main.ts                   # App entry, window + tray management
│   ├── preload.ts                # contextBridge — the entire IPC surface
│   ├── audio/
│   │   ├── TranscriptQuestionDetector.ts       # ⭐ QUESTION DETECTION (default: AmiVoice transcript → Gemini)
│   │   ├── questionGate.ts                     # stage-1 regex gate (mirrored in scripts/replay/lib.mjs)
│   │   ├── transcriptQuestionPrompt.ts         # stage-2 classify + repair + rewrite prompt
│   │   ├── question.ts, questionDedup.ts       # shared Question shape + cross-channel dedup
│   │   ├── OpenAIRealtimeQuestionDetector.ts   # alternative detector (FLOWNOTE_DETECTOR=realtime)
│   │   ├── questionPrompt.ts                   # JP question-detection system prompt (Realtime path)
│   │   ├── AmiVoiceTranscriptionSession.ts     # ⭐ ACTIVE transcription provider
│   │   ├── DeepgramTranscriptionSession.ts     # fallback transcription
│   │   ├── TranscriptionSession.ts             # OpenAI transcription (dev-only, JA hallucinates) + ITranscriptionSession iface
│   │   ├── SystemAudioCapture.ts               # spawns `audiotee` binary (macOS system audio)
│   │   ├── SharedAudioRouter.ts                # ref-counted fan-out of system audio to N consumers
│   │   └── AudioResampler.ts                   # PCM16 16k→24k linear resampler
│   ├── ipc/
│   │   ├── listening.ts          # ⭐ wires question detector + system audio (start/stop-listening)
│   │   ├── response.ts           # ⭐ generate-response: RAG + Gemini streaming
│   │   ├── transcription-handlers.ts  # ⭐ picks provider, runs mic+speaker sessions, post-polish
│   │   ├── ai-handlers.ts        # transcript Q&A, summaries
│   │   ├── documents.ts, prompts.ts, session-handlers.ts, auth.ts, ...
│   │   └── handlers.ts           # registers everything; reads env keys
│   └── services/
│       ├── rag.ts                # ⭐ embeddings + pgvector search + usage tracking
│       ├── usageLimiter.ts       # budget / plan gating
│       └── tokenNormalization.ts # normalizes provider tokens → billing units
├── src/                          # Renderer (React + Vite + Tailwind)
│   ├── overlay/OverlayApp.tsx    # ⭐ the floating always-on-top overlay (main UX)
│   ├── main-window/              # settings, docs, history, prompts, workflows, team
│   └── hooks/                    # useListening, useTranscription, useResponseStream, useTranscriptQA, ...
├── custom-binaries/audiotee/     # native macOS system-audio capture binary
├── flownoteweb/                  # marketing/web (Next) — separate
├── flownoteadmin/                # admin dashboard (Next) — separate
├── supabase/                     # migrations, edge functions
└── agent/                        # design docs (SOME OUTDATED — see note above) + pricing.md
```

`⭐` = touch these for anything about latency, detection, or answer quality.

---

## 3. The real-time pipeline (as actually built)

There are **two independent audio consumers**, both fed from mic + system audio:

```
 Mic (renderer getUserMedia, 16kHz)          System audio (audiotee, macOS only, 16kHz)
        │  process-mic-chunk IPC                     │  SharedAudioRouter (ref-counted)
        ▼                                            ▼
 ┌─────────────────────────── two parallel consumers ───────────────────────────┐
 │                                                                               │
 │  (A) TRANSCRIPTION  — always on when "Listen" is pressed                      │
 │      AmiVoiceTranscriptionSession × 2 (user 'You' + opponent 'Speaker')       │
 │      → live segments → overlay transcript → post-session Gemini polish        │
 │                                                                               │
 │  (B) QUESTION DETECTION — OPTIONAL toggle (secondary feature)                 │
 │      DEFAULT: TranscriptQuestionDetector. Each finalized AmiVoice segment from  │
 │      (A) → shouldClassify() (rejects only back-channel/fragments) → one         │
 │      gemini-3.1-flash-lite call that classifies, repairs ASR damage and emits  │
 │      search_text → overlay "questions" tab.                                    │
 │      Text with no interrogative marker also carries ~4s of the utterance's WAV  │
 │      (AudioTailBuffer) so the model can hear rising intonation — 「あります？」 vs  │
 │      「あります。」 is otherwise invisible. Falls back to text-only on audio error.  │
 │      FLOWNOTE_DETECTOR=realtime switches to OpenAIRealtimeQuestionDetector:    │
 │      two more WebSockets fed the same audio, 'gpt-realtime-mini', text-only,   │
 │      semantic_vad ('auto', interrupt_response:false) + early emit on deltas    │
 └───────────────────────────────────────────────────────────────────────────────┘
                                   │  user clicks a question
                                   ▼
        generate-response (ipc/response.ts):
          Promise.all[ budget check | selected prompts | RAG searchSimilar ]
          RAG = embedQuery (OpenAI text-embedding-3-small) → pgvector match_chunks(topK=5)
          → build prompt → gemini-2.5-flash-lite streaming → response-chunk events
```

Key facts an agent must know:

- **"Listen" button = transcription (AmiVoice).** Question detection is a **separate toggle**
  (`handleToggleQuestionDetection` in `OverlayApp.tsx`) that only works while transcribing.
  This was a deliberate change from the old "always detecting" model.
- **Answers are click-triggered, not automatic.** Detection lists the question; the user taps it
  to spend tokens on an answer. There is also a free-text Q&A box over the transcript
  (`useTranscriptQA` → `ai-handlers.ts`).
- **System audio is macOS-only.** `SystemAudioCapture` throws on non-darwin and needs macOS 14.2+
  **and** the "System Audio Recording" permission. If only the user's own voice is captured
  (e.g. in Google Meet), it is almost always this permission missing — `SystemAudioCapture`
  emits `system-audio-silent` after ~30s of all-zero chunks to signal exactly this.

---

## 4. Models & providers (current, in code)

| Function | Provider / Model | Where |
|---|---|---|
| Transcription (prod) | **AmiVoice** `-a-general` (env `AMIVOICE_ENGINE`, prod default aims for `-a-bizmrr`) | `AmiVoiceTranscriptionSession.ts`, `transcription-handlers.ts` |
| Transcription (fallback) | Deepgram; OpenAI is dev-only (JA hallucinations) | same |
| Question detection (default) | **AmiVoice transcript → cheap reject filter → `gemini-3.1-flash-lite`** (classify + ASR repair + retrieval-query rewrite in one call; +utterance WAV when the text has no interrogative marker) | `TranscriptQuestionDetector.ts`, `questionGate.ts`, `AudioTailBuffer.ts`, `transcriptQuestionPrompt.ts` |
| Question detection (alternative) | **OpenAI Realtime `gpt-realtime-mini`**, text-only output, `semantic_vad` (eagerness 'auto', interrupt_response:false). `FLOWNOTE_DETECTOR=realtime` | `OpenAIRealtimeQuestionDetector.ts` |
| Answer generation | **Gemini `gemini-2.5-flash-lite`** streaming | `response.ts:155`, `ai-handlers.ts` |
| Embeddings (RAG) | **OpenAI `text-embedding-3-small`** | `rag.ts` |
| Vector search | Supabase `pgvector` RPC `match_chunks` (topK 5) | `rag.ts:146` |

Env keys (`.env`): `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AMIVOICE_APP_KEY`, `DEEPGRAM_API_KEY`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SLACK_CLIENT_ID`, plus optional `AMIVOICE_ENGINE`,
`FLOWNOTE_DETECTOR` (`transcript` default | `realtime`), `FLOWNOTE_DETECT_MIN_CONFIDENCE`,
`FLOWNOTE_DETECT_USER_CHANNEL`, `FLOWNOTE_DETECT_SELF_QUESTIONS`, `FLOWNOTE_RAG_MIN_SIMILARITY`,
`FLOWNOTE_DETECTION_LOG`.

> **The mic channel does not filter by who asked** (`FLOWNOTE_DETECT_SELF_QUESTIONS`,
> default on). The speaker label is a *device* label — `'You'` = mic session,
> `'Speaker'` = system-audio session — so the user's own speech and the counterpart's
> voice bleeding out of the laptop speakers arrive under one label, and no amount of
> prompting separates them from text: 「なんでこの会社に入りたいと思ったんですか」 reads the
> same whoever said it. Two attempts to filter it (see git log) each made the channel
> silently emit nothing. The opponent channel *does* filter on `addressed_to`, where
> 'other' means the counterpart asked a third party or themselves.
>
> Debug with `<userData>/detection-logs/`: `gate.passed` says whether a segment
> reached stage 2, `classify.isQuestion` + `classify.addressedTo` say what stage 2
> decided. **Watch the speaker mix, too** — as of 2026-07 every logged session on the
> dev machine has 0 system-audio segments (56 mic, 0 `Speaker`), so the counterpart
> path is still unproven. Play a recorded call through the speakers and check for
> `speaker: "Speaker"` segments before trusting it.

> ⚠️ `agent/architecture.md` / `productPRD.md` still say the detector is Gemini-Live and the
> answer model is "Gemini 2.0 Flash" — both are stale. Trust the table above.

---

## 5. Build / run

```bash
npm install
npm start              # vite (5182) + electron concurrently — normal dev loop
npm run build:native   # (re)build the audiotee binary for macOS system audio
npm run app:build:mac  # signed/notarized dmg + zip
```

Renderer is Vite+React; Electron main is compiled via `tsc -p electron/tsconfig.json`.

---

## 6. Security / conventions

- Context isolation ON, no nodeIntegration. **All IPC goes through `preload.ts` contextBridge.**
- **API keys never reach the renderer** — they live in the main process only.
- Supabase RLS on all tables. Usage/billing is gated in `usageLimiter.ts` + `tokenNormalization.ts`.
- UI copy is Japanese; strings live in `src/i18n/ja.ts`.

---Do 

## 7. Known pain points / active work (2026-07)

Product feedback flagged real-time usability. If you're picking up that work, the levers are:

1. **Detection latency** — the Realtime path got three low-risk speedups in 2026-07
   (`interrupt_response:false`, early emit from streaming deltas, `[latency] speech_stopped→emit`
   logging). `semantic_vad` stayed: a `server_vad` @ 250ms attempt chopped natural speech
   mid-question, and `gpt-realtime-2.1-mini` was reverted (reasoning model, phased output
   incompatible with this detector). The bigger lever was item 2, now built. **Still open on the
   transcript path:** detection can't fire before AmiVoice's `A` (final) packet. Interim `U`
   hypotheses arrive 1.6–2.3s earlier (p50, captured sessions) and are already logged, so gating
   stage 1 on interims is the next latency step — at the cost of classifying text that may still
   change.
2. **Redundancy — DONE (2026-07, `feature/amivoice-question-detection`).** Detection now runs off
   the AmiVoice transcript (`TranscriptQuestionDetector`), so the second audio pipeline, the second
   `getUserMedia`, and the Realtime audio-in tokens are gone. What is **not** settled: accuracy vs
   the Realtime baseline, because no session has been labelled yet. Measured so far on the captured
   logs — AmiVoice's final segment for a question landed 0.9–10.2s *before* the Realtime detector
   emitted the same question (n=7 matched pairs); stage 1 admits 77% of segments (82/107) ≈ 440
   flash-lite calls/hour ≈ **¥7/hr**, of which 54% carry audio. The known regression risk is ASR text quality: 4 of
   11 Realtime detections had no recognizable counterpart in the transcript at all (badly garbled
   mic segments — 「なんで…会社は死亡死亡したとしたんですかですか。」), and no gate can recover those.
   Flip back with `FLOWNOTE_DETECTOR=realtime` and compare on the same labels.
3. **Answer latency** — `embedQuery` (OpenAI round-trip) + pgvector RPC happen only after the user
   clicks. Speculatively pre-fetching RAG at detection time would hide most of it. `response.ts`
   already parallelizes budget/prompt/RAG via `Promise.all`.
4. **System-audio permission UX** — the usual suspect for "only my voice is captured", *but check
   the rate contract first*: from 2026-03 to 2026-07 the counterpart channel produced 0 transcript
   segments because audiotee emits 16kHz while AmiVoice/Deepgram/OpenAI each assumed something else
   (fixed 2026-07, see `audioFormat.ts` and its test). audiotee itself was measured working. Only
   after `speaker: "Speaker"` segments appear in a log is a permission problem the right diagnosis;
   there is no system-audio path on Windows at all.
5. **Referent resolution ("it doesn't know which button") — fixed 2026-08, verify on a
   live call.** Three independent causes, all measured on `<userData>/detection-logs/`:
   - *The context window was ~14 seconds.* Every consumer capped by **segment count**,
     which is the wrong unit for AmiVoice (median finalized segment: 12 chars). The
     answer tail's 6-segment cap covered a median of **14.4s** using 109 of its 800-char
     budget; the detector's 4-turn window ~10s. Both now budget characters via
     `electron/audio/transcriptWindow.ts` (mirrored in `scripts/replay/lib.mjs`, drift
     test in `test:transcript`), and merge consecutive same-speaker segments into one
     line. Measured reach on the 97-segment session: **14.4s → 126s median / 160s max**.
   - *The rewrite that had the most context never ran.* `ConversationContext.resolve
     SearchQuery()` fired in **0 of 11** captured detections: `captureForQuestion` treated
     any detector `search_text` differing from the question as "already resolved", and
     stage 2 is also told to keyword-ify, so it always differs. The detector was dropping
     referents rather than resolving them (「これによって質問件数なども？」 → `質問件数 影響`;
     「その松屋の具体的な数字」 → `松屋 TikTokショップ 成功事例 具体的な数字`). The detector's
     query is now a **fallback only** — a deictic question always gets the rewrite, which
     sees the memo plus a 1000-char tail, and degrades to the detector's query then the
     raw question. Deliberately *not* solved by asking stage 2 for a `resolved` flag: that
     call has no latency headroom (see item 6).
   - *The answer prompt still got the raw demonstrative.* Only retrieval saw the resolved
     query. The rewrite now also returns `resolved_question` (question verbatim, referent
     substituted) and `response.ts` puts that in every prompt shape's question slot. The
     overlay card still shows the verbatim question. `buildContextBlock()` also carries
     its own "resolve demonstratives from this" instruction, so user-authored prompts
     from the DB get it too.

   Only populated on the retrieval path — a no-collection answer keeps the question as
   asked and relies on the context block. Regress against
   `2026-07-29T08-51-24-*.jsonl`, which contains both bad rewrites above.

6. **Stage-2 classification times out on most audio calls (open, unfixed).** Across the
   captured sessions **15 of 24** classifications carrying audio hit `CLASSIFY_TIMEOUT_MS`
   (2500ms); with-audio latency p50 is 2503ms — i.e. *the median audio classification is
   the timeout itself*. Text-only p50 is 1102ms. Since ~54% of gated segments carry audio
   (item 7), this is silently eating a large share of detections, and it means the stage-2
   call has **no headroom for additional output fields**. Unknown whether the fix is a
   longer timeout, a smaller clip (`AUDIO_LAG_PAD_MS` + `AUDIO_FALLBACK_DURATION_MS`
   currently send up to ~4.4s of WAV), or splitting audio into a second call.

7. **Prosody is still only consulted when the text is ambiguous.** Japanese marks many yes/no
   questions with intonation alone and AmiVoice writes ？ in 1 of 107 segments, so segments without
   a marker are sent with their audio. Open questions: whether a local terminal-F0 feature would be
   cheaper than the audio tokens, and whether `-a-bizmrr` punctuates interrogatives better than
   `-a-general` (a 5-minute experiment, needs the entitlement).

### Measuring detection & retrieval (added 2026-07)

Every transcription session writes a JSONL log to
`<userData>/detection-logs/` (`electron/services/detectionLog.ts`, disable with
`FLOWNOTE_DETECTION_LOG=0`): transcript segments, throttled interim hypotheses,
detections (with channel + `speech_stopped→emit` latency), query rewrites,
retrieved chunks **with similarities**, and answers. Local only, never uploaded.

Score changes against it instead of guessing — `scripts/replay/README.md`:

```bash
npm run log:labels -- <log.jsonl>                    # label worksheet
npm run log:replay -- <log.jsonl> --variant live     # whatever detector produced the log
npm run log:replay -- <log.jsonl> --variant gate     # regex stage-1 recall ceiling
npm run log:replay -- <log.jsonl> --variant gemini   # the shipped transcript stage 2, offline
```

The gate in `scripts/replay/lib.mjs` is a mirror of `electron/audio/questionGate.ts` —
`npm run test:transcript` fails if they drift, because scoring a filter the app doesn't
ship is worse than not scoring. Logs from the transcript detector also carry `gate`
(every segment, passed or not) and `classify` (decision, confidence, latency) events,
so its recall loss is visible without re-running anything.

Two other things changed with it, both aimed at the "right question, wrong
answer" failure:

- `searchSimilar` now enforces a similarity floor (`DEFAULT_MIN_SIMILARITY`, env
  `FLOWNOTE_RAG_MIN_SIMILARITY`, default 0.3). `match_chunks` has none, so before
  this every query injected 5 chunks no matter how irrelevant.
- `electron/services/conversationContext.ts` keeps a rolling ~400-char memo plus a
  verbatim tail, injects them into answer prompts as 【会話の文脈】, and rewrites
  deictic questions (「その店舗の年商は？」) into self-contained retrieval queries
  before `embedQuery`. Gated by a heuristic and timeboxed at 1.5s, so
  self-contained questions pay nothing.

See `agent/docs/` for provider-specific notes (`realtimegpt.md`, `transcription.md`) and
`agent/docs/pricing.md` for the cost model.
