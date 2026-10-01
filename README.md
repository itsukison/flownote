# Flownote

Flownote is a desktop AI assistant for live conversations.

I started building it around a simple frustration: during a meeting, interview, or sales call, the useful answer often already exists somewhere in your notes or company documents — but finding it while someone is waiting for you to respond is too slow.

Flownote listens to the conversation, transcribes both sides in real time, detects questions that may need an answer, and lets you pull up a response grounded in your own documents without leaving the call.

## What it does

During a live conversation, Flownote can:

- capture microphone and system audio,
- transcribe both sides of the conversation in real time,
- detect questions directed at the user,
- retrieve relevant context from uploaded documents,
- generate a grounded answer on demand,
- keep the result in a small always-on-top overlay,
- preserve the transcript for review afterwards.

The answer is intentionally **click-triggered rather than automatic**. Detection helps surface the moment; the user still decides when an answer is worth generating.

## Why this project became interesting

The first version sounded simple: audio in, transcription, question detection, answer out.

In practice, most of the work has been in the parts between those steps:

- system-audio capture on macOS,
- handling two simultaneous audio sources,
- deciding when an utterance is actually a question,
- dealing with Japanese ASR errors and missing punctuation,
- keeping enough conversational history to resolve phrases like “that number” or “this plan,”
- reducing latency enough that the answer is still useful in a live conversation,
- grounding answers in the right document chunks instead of relying on model memory.

That made Flownote less of a chatbot project and more of a real-time systems problem.

## Real-time pipeline

```text
Microphone ───────────────┐
                          ├─→ real-time transcription ─→ transcript
System audio ── audiotee ─┘
                                      │
                                      ▼
                              question detection
                                      │
                               user selects one
                                      ▼
                          query/context resolution
                                      │
                     embeddings + pgvector retrieval
                                      │
                                      ▼
                            streaming answer
```

The production transcription path currently uses AmiVoice for Japanese, with alternative/fallback paths kept in the codebase for testing.

Question detection runs over finalized transcript segments. For ambiguous Japanese utterances where punctuation is not enough, the detector can also use a short slice of the original audio to recover intonation.

## RAG and conversational context

When a question is selected, Flownote does more than search for the raw sentence.

A question such as:

> “What happened to that number?”

is not useful as a retrieval query on its own.

The app keeps a bounded conversation window, resolves references using recent context, embeds the resulting search query, and retrieves related chunks from Supabase/pgvector before generating the response.

```text
spoken question
      ↓
conversation-aware rewrite
      ↓
embedding
      ↓
pgvector top-k retrieval
      ↓
question + conversation + documents
      ↓
streaming response
```

## Stack

- **Electron** — desktop shell and native integration
- **React + Vite + TypeScript** — renderer
- **AmiVoice** — production Japanese transcription
- **Gemini / OpenAI** — question detection, generation, embeddings and experimental paths
- **Supabase + pgvector** — auth, documents, vector search and usage data
- **Native macOS audio helper** — system-audio capture
- **electron-builder** — signed/notarized desktop builds

## Repository map

```text
electron/
├── audio/          # transcription, question detection, audio routing
├── ipc/            # renderer ↔ main-process workflows
└── services/       # RAG, usage limits, supporting services

src/
├── overlay/        # always-on-top meeting UI
├── main-window/    # documents, settings, history, team surfaces
└── hooks/          # transcription, listening and streaming state

custom-binaries/
└── audiotee/       # macOS system-audio capture helper

supabase/           # schema and backend functions
scripts/            # replay, evaluation and native build tools
```

## Running locally

```bash
npm install
npm start
```

That starts the Vite renderer and Electron app together.

To rebuild the native macOS audio helper:

```bash
npm run build:native
```

Tests cover conversation context, question filtering, transcript behavior, answer sources and audio-format assumptions:

```bash
npm test
```

## More detail

The short explanation lives here. The repo also contains the working engineering notes behind the product:

- [AGENTS.md](./AGENTS.md) — current architecture and real-time pipeline
- [design.md](./design.md) — current visual direction
- [scripts/replay/](./scripts/replay/) — replay/evaluation tooling for captured sessions

---

What I like about Flownote is that the model is only one component. A good answer that arrives ten seconds too late, loses the referent from the previous sentence, or listens to the wrong audio channel is still a bad product. Most of the interesting work has been making all of those pieces behave like one system.
