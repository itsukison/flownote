# CueMe — Product Requirements Document
> **Version**: 1.1 | **Updated**: March 2026 | **Status**: Draft

---

## 1. Executive Summary

CueMe is a desktop AI interview assistant that provides real-time assistance during interviews by:

1. **Listening** — Continuously capturing microphone AND system audio to detect questions
2. **Displaying** — Showing detected questions in a floating overlay UI
3. **Responding** — Generating AI-powered responses on demand
4. **Context-Aware** — Using RAG (Retrieval Augmented Generation) with user-uploaded documents

**Target Users**: Job seekers, students, professionals preparing for interviews  
**Platform**: Desktop (Electron) — macOS / Windows

---

## 2. Design Philosophy

Following **promptOS** design principles:
- **Minimal & Focused**: Content is king, remove unnecessary decoration
- **Native & Premium**: System integration, tactile feedback, high fidelity
- **Fluid & Responsive**: Adaptive layouts, beyond fixed dimensions
- **Motion as Meaning**: Guide attention, 60 fps animations

---

## 3. Tech Stack

### 3.1 Frontend
| Layer | Technology | Version |
|---|---|---|
| Framework | React | 18.x |
| Language | TypeScript | 5.x |
| Build Tool | Vite | 5.x |
| Styling | Tailwind CSS | 3.x |
| UI Components | Shadcn UI | Latest |
| Motion | Framer Motion | 11.x |
| State | React Context + useReducer | Built-in |

### 3.2 Desktop
| Layer | Technology | Version |
|---|---|---|
| Runtime | Electron | 33.x |
| Bundler | electron-builder | 24.x |
| IPC | contextBridge + ipcRenderer | Native |

### 3.3 Backend (Supabase)
| Service | Technology | Purpose |
|---|---|---|
| Database | PostgreSQL | User data, questions, documents |
| Auth | Supabase Auth | Email/password, OAuth |
| Storage | Supabase Storage | Document file storage |
| Vector Search | pgvector | Semantic search on embeddings |
| Edge Functions | Deno | Document processing, embeddings |

### 3.4 AI/ML
| Function | Provider | Model |
|---|---|---|
| Audio Transcription + Question Detection | Google Gemini | **gemini-2.5-flash-native-audio-preview-12-2025** (Live API) |
| Response Generation | Google Gemini | gemini-2.5-flash |
| Text Embeddings | OpenAI | text-embedding-3-large (1536d) |

> ⚠️ **Model Update (v1.1)**: The original PRD referenced `gemini-2.0-flash` for Live API usage. The correct and current model for real-time audio transcription is `gemini-2.5-flash-native-audio-preview-12-2025`. See [`ai-agent-design.md`](./ai-agent-design.md) for full details on model selection rationale and session management requirements.

### 3.5 Native Dependencies
- **System Audio (macOS)**: Custom native module `audiotee`, built via `npm run build:native`
- Requires **screen recording permission** on macOS

---

## 4. Architecture

See [`architecture.md`](./architecture.md) for full process model, window architecture, and audio pipeline diagrams.

### 4.1 Summary
- **Main Process**: AppState, IPC Handlers, Window Manager, DualAudioCaptureManager, RAG Service, Auth Service
- **Renderer Process**: React App with MainWindow (settings, docs, history) and Overlay Window (floating, always-on-top)
- **Two-Window Model**: Main (1000×700, resizable) + Overlay (600×400, floating)

---

## 5. Feature Specifications

### 5.1 Audio Listening (Core)
Continuously captures audio from BOTH microphone AND system audio to detect questions in real-time.

**User Flow**:
1. User clicks "Start Listening" in overlay
2. App requests microphone permission (first launch)
3. App requests screen recording permission for system audio (first launch)
4. Audio streams (mic + system) to Gemini Live API
5. Gemini analyzes transcription for question patterns
6. Detected questions appear in overlay UI

**Edge Cases**:
- No mic → show error with setup instructions
- Permission denied → show permission guide
- Network disconnection → auto-reconnect with retry; on Live API `GoAway` message, trigger session resumption
- System audio unavailable → fallback to mic-only mode
- **Session expiry (10-min connection limit)** → transparent session resumption using session handle (see `ai-agent-design.md`)

### 5.2 Question Display (Core)
Floating overlay window shows detected questions with one-click response generation.

**Interactions**: Click question → generate response | Click X → dismiss | Drag → reposition | Global shortcut → toggle visibility

### 5.3 Response Generation (Core)
AI-powered responses generated on demand using Gemini 2.0 Flash with optional RAG context.

**Response Options**: Copy to clipboard | Regenerate | Adjust length (short/medium/long) | Toggle RAG context

### 5.4 RAG Document Management (Core)
Upload documents to create a knowledge base for contextual answers.

**Supported Formats**: PDF, TXT, Markdown, Word (doc/docx)

**RAG Pipeline**:
```
Question → Embed (OpenAI) → Vector Search (pgvector) → Retrieve Context → Gemini Generate
```

See [`database.md`](./database.md) for full schema and vector search function.

### 5.5 Settings & Preferences
- **General**: Startup behavior, theme, global shortcuts
- **Audio**: Input device, system audio toggle, sensitivity
- **AI**: Model preferences, response length, RAG toggle
- **Documents**: Manage collections
- **Account**: Sign in/out

---

## 6. IPC Channels

See [`architecture.md`](./architecture.md) for full IPC channel reference (audio, AI/LLM, RAG/documents, window, auth).

---

## 7. Security Requirements
- Context Isolation: enabled (no nodeIntegration)
- Preload Script: all IPC via contextBridge
- Hardened Runtime: enabled on macOS
- API Keys: never exposed to renderer; stored in main process only
- Supabase RLS: row-level security on all tables

---

## 8. Non-Functional Requirements

### 8.1 Performance
- Startup: < 3 seconds to overlay ready
- Audio Latency: < 500 ms question detection
- Response Generation: < 3 seconds for typical response
- Memory: < 300 MB baseline

### 8.2 Compatibility
- macOS 12.x (Monterey) and later
- Windows 10 and later

### 8.3 Accessibility
- Keyboard navigation
- Screen reader support
- High contrast mode

---

## 9. Global Shortcuts
| Action | macOS | Windows |
|---|---|---|
| Toggle overlay | Cmd+Shift+C | Ctrl+Shift+C |
| Start/Stop listening | Cmd+Shift+L | Ctrl+Shift+L |
| Generate response | Cmd+Shift+G | Ctrl+Shift+G |
| Open settings | Cmd+, | Ctrl+, |

---

## 10. Environment Variables
```bash
GEMINI_API_KEY=       # Gemini Live API + response generation
OPENAI_API_KEY=       # Text embeddings (text-embedding-3-large)
SUPABASE_URL=         # Supabase project URL
SUPABASE_ANON_KEY=    # Supabase anonymous key

# Optional — macOS release signing
APPLE_ID=
APPLE_PASSWORD=
APPLE_TEAM_ID=
```

---

## 11. Build Commands
```bash
npm run dev            # Vite dev server
npm run electron:dev   # Electron only
npm start              # Both concurrently

npm run build          # Production build
npm run build:native   # Build audiotee binary
npm run app:build      # Distributable

npm run app:build:mac
npm run app:build:win
npm run app:build:linux
```

---

## 12. Milestones
- **Phase 1**: Foundation (Electron + React, windows, IPC, Supabase)
- **Phase 2**: Audio (mic capture, system audio, dual merge, Gemini Live, question detection)
- **Phase 3**: Response Generation (Gemini API, streaming UI, clipboard)
- **Phase 4**: RAG (document upload, extraction, embedding, vector search, context-aware responses)
- **Phase 5**: Polish (settings persistence, themes, error handling, shortcuts, distribution)

---

## 13. Open Questions
1. Free tier with limits vs. completely free?
2. Multi-language question detection?
3. Pre-built document templates (common interview topics)?
4. Question history storage in database?

---

## 14. Related Documents
- [`ai-agent-design.md`](./ai-agent-design.md) — AI model selection, Live API session management, question detection prompt design
- [`database.md`](./database.md) — Supabase schema, RLS policies, vector search functions
- [`architecture.md`](./architecture.md) — Process model, window architecture, audio pipeline, IPC channels, file structure