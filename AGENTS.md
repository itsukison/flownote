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
│   │   ├── OpenAIRealtimeQuestionDetector.ts  # ⭐ QUESTION DETECTION (OpenAI Realtime WS)
│   │   ├── questionPrompt.ts                   # JP question-detection system prompt
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
 │      OpenAIRealtimeQuestionDetector: TWO WebSockets (user + opponent)         │
 │      model = 'gpt-realtime-mini', text-only, semantic_vad (eagerness 'auto',   │
 │      interrupt_response:false) + early emit on deltas                          │
 │      → model emits {"question": "..."} JSON → overlay "questions" tab         │
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
| Question detection | **OpenAI Realtime `gpt-realtime-mini`**, text-only output, `semantic_vad` (eagerness 'auto', interrupt_response:false) | `OpenAIRealtimeQuestionDetector.ts` |
| Answer generation | **Gemini `gemini-2.5-flash-lite`** streaming | `response.ts:155`, `ai-handlers.ts` |
| Embeddings (RAG) | **OpenAI `text-embedding-3-small`** | `rag.ts` |
| Vector search | Supabase `pgvector` RPC `match_chunks` (topK 5) | `rag.ts:146` |

Env keys (`.env`): `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AMIVOICE_APP_KEY`, `DEEPGRAM_API_KEY`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SLACK_CLIENT_ID`, plus optional `AMIVOICE_ENGINE`.

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

1. **Detection latency** — partly addressed 2026-07 with three low-risk speedups that don't
   hurt accuracy: `interrupt_response:false` (a detection is never cancelled by the next
   utterance), early question emit from streaming deltas, and per-question latency logging
   (`[latency] speech_stopped→emit`). Turn detection stays on `semantic_vad` — a `server_vad`
   @ 250ms attempt was reverted because it chopped natural speech mid-question (truncated
   questions + statements misread as questions). `gpt-realtime-2.1-mini` was also reverted
   (reasoning model, phased output incompatible with this detector). `vadEagerness` is the
   remaining knob ('auto' default; 'high' faster but can split long questions). The real
   remaining lever is detecting from AmiVoice interim results instead (see item 2).
2. **Redundancy** — AmiVoice transcription and the OpenAI Realtime detector both run the full
   audio pipeline in parallel. Since the transcript already exists, questions could be detected
   from AmiVoice segments (heuristic on `？/ですか/ください` or a cheap Gemini-Flash-Lite call),
   removing the second audio pipeline and its Realtime token cost entirely. See `agent/docs/pricing.md`.
3. **Answer latency** — `embedQuery` (OpenAI round-trip) + pgvector RPC happen only after the user
   clicks. Speculatively pre-fetching RAG at detection time would hide most of it. `response.ts`
   already parallelizes budget/prompt/RAG via `Promise.all`.
4. **System-audio permission UX** — the #1 cause of "only my voice is captured." Improve onboarding
   around the macOS "System Audio Recording" grant; there is no system-audio path on Windows.

### Measuring detection & retrieval (added 2026-07)

Every transcription session writes a JSONL log to
`<userData>/detection-logs/` (`electron/services/detectionLog.ts`, disable with
`FLOWNOTE_DETECTION_LOG=0`): transcript segments, throttled interim hypotheses,
detections (with channel + `speech_stopped→emit` latency), query rewrites,
retrieved chunks **with similarities**, and answers. Local only, never uploaded.

Score changes against it instead of guessing — `scripts/replay/README.md`:

```bash
npm run log:labels -- <log.jsonl>                    # label worksheet
npm run log:replay -- <log.jsonl> --variant live     # shipped Realtime detector
npm run log:replay -- <log.jsonl> --variant gate     # regex stage-1 recall ceiling
npm run log:replay -- <log.jsonl> --variant gemini   # proposed transcript-driven stage 2
```

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
