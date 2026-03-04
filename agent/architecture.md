# CueMe — Architecture
> **Version**: 1.1 | **Updated**: March 2026

---

## 1. Process Model

```
┌──────────────────────────────────────────────────────────────┐
│                        Main Process                          │
│  ┌─────────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ AppState        │  │ IPC Handlers  │  │ WindowManager │  │
│  │ (Singleton)     │  │               │  │               │  │
│  └─────────────────┘  └───────────────┘  └───────────────┘  │
│  ┌─────────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ DualAudioCapture│  │ RAG Service   │  │ Auth Service  │  │
│  │ Manager         │  │               │  │               │  │
│  └─────────────────┘  └───────────────┘  └───────────────┘  │
│                                                              │
│  API keys live here — NEVER sent to renderer                 │
└───────────────────────────────┬──────────────────────────────┘
                                │ IPC (contextBridge)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                      Renderer Process                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                     React App                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│  │  │ MainWindow   │  │ Overlay      │  │ Settings    │  │  │
│  │  │ (Settings,   │  │ (Floating,   │  │ (Prefs)     │  │  │
│  │  │  Docs,       │  │  always-on-  │  │             │  │  │
│  │  │  History)    │  │  top)        │  │             │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Window Architecture

### Main Window (`1000×700`, resizable)
- Settings & Configuration
- Document Management (RAG collections)
- Question & Response History
- Authentication

### Overlay Window (`600×400`, floating, always-on-top)
- Detected questions list
- One-click response generation
- Minimal transparent background
- Draggable position

---

## 3. Audio Pipeline

```
┌─────────────────┐    ┌──────────────────┐
│  Microphone     │    │  System Audio    │
│  (native mic)   │    │  (audiotee)      │
└────────┬────────┘    └────────┬─────────┘
         │                      │
         └──────────┬───────────┘
                    │ merge streams (PCM 16-bit, 16kHz, mono)
                    ▼
┌────────────────────────────────────────────┐
│        DualAudioCaptureManager             │
│  Coordinates mic + system audio streams   │
└────────────────────┬───────────────────────┘
                     │ sendRealtimeInput(audio)
                     ▼
┌────────────────────────────────────────────┐
│   Gemini Live API (WebSocket, server-side) │
│   Model: gemini-2.5-flash-native-audio-*  │
│   - Voice Activity Detection (built-in)   │
│   - input_audio_transcription enabled     │
│   - System prompt: question detector      │
│   - Session resumption for >10min         │
└────────────────────┬───────────────────────┘
                     │ input_transcription / question JSON
                     ▼
┌────────────────────────────────────────────┐
│  GeminiLiveQuestionDetector.ts             │
│  Parses transcript / question JSON         │
│  Emits: question-detected event            │
└────────────────────┬───────────────────────┘
                     │ IPC: audio:question-detected
                     ▼
              Overlay UI (React)
```

---

## 4. IPC Channel Reference

### 4.1 Audio
| Channel | Direction | Description |
|---|---|---|
| `audio:start-listening` | R → M | Start mic + system audio capture |
| `audio:stop-listening` | R → M | Stop audio capture |
| `audio:set-mode` | R → M | Set mode: mic-only, system-only, both |
| `audio:question-detected` | M → R | Question detected from audio |
| `audio:transcript` | M → R | Real-time transcript update |
| `audio:error` | M → R | Audio error |
| `audio:permission-status` | R → M | Check permission status |

### 4.2 AI/LLM
| Channel | Direction | Description |
|---|---|---|
| `llm:generate` | R → M | Generate response (no RAG) |
| `llm:generate-with-rag` | R → M | Generate with RAG context |
| `llm:stream-response` | M → R | Stream response tokens |
| `llm:error` | M → R | Generation error |

### 4.3 RAG/Documents
| Channel | Direction | Description |
|---|---|---|
| `rag:create-collection` | R → M | Create document collection |
| `rag:delete-collection` | R → M | Delete collection |
| `rag:list-collections` | R → M | List user's collections |
| `rag:upload-document` | R → M | Upload & embed document |
| `rag:delete-document` | R → M | Delete document |
| `rag:search` | R → M | Semantic search |
| `rag:toggle-collection` | R → M | Enable/disable for Q&A |

### 4.4 Window
| Channel | Direction | Description |
|---|---|---|
| `window:toggle-overlay` | R → M | Show/hide overlay |
| `window:minimize` | R → M | Minimize window |
| `window:close` | R → M | Close window |
| `window:open-main` | R → M | Open main window |

### 4.5 Auth
| Channel | Direction | Description |
|---|---|---|
| `auth:sign-in` | R → M | Sign in with email |
| `auth:sign-up` | R → M | Sign up |
| `auth:sign-out` | R → M | Sign out |
| `auth:get-session` | R → M | Get current session |
| `auth:session-changed` | M → R | Session updated |

*(R = Renderer, M = Main)*

---

## 5. File Structure

```
cue-me/
├── electron/
│   ├── main.ts
│   ├── preload.ts                        # contextBridge — all IPC here
│   ├── core/
│   │   ├── window-manager.ts
│   │   └── shortcuts.ts
│   ├── services/
│   │   ├── audio/
│   │   │   ├── DualAudioCaptureManager.ts
│   │   │   ├── SystemAudioCapture.ts     # audiotee interface
│   │   │   └── GeminiLiveQuestionDetector.ts
│   │   ├── rag/
│   │   │   ├── document-service.ts
│   │   │   └── vector-service.ts
│   │   ├── ai/
│   │   │   └── llm-service.ts
│   │   └── auth/
│   │       └── auth-service.ts
│   └── ipc/
│       ├── index.ts
│       ├── audio-handlers.ts
│       ├── llm-handlers.ts
│       ├── rag-handlers.ts
│       └── auth-handlers.ts
├── src/                                  # React renderer
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── overlay/
│   │   │   ├── OverlayWindow.tsx
│   │   │   ├── QuestionList.tsx
│   │   │   ├── QuestionItem.tsx
│   │   │   └── ResponseView.tsx
│   │   ├── main-window/
│   │   │   ├── MainWindowApp.tsx
│   │   │   ├── AuthPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── DocumentsPage.tsx
│   │   │   └── HistoryPage.tsx
│   │   └── shared/
│   ├── hooks/
│   │   ├── useAudio.ts
│   │   ├── useLLM.ts
│   │   └── useRAG.ts
│   ├── contexts/
│   │   └── AppContext.tsx
│   ├── lib/
│   │   ├── utils.ts
│   │   └── supabase.ts
│   └── styles/
│       └── index.css
├── custom-binaries/
│   └── audiotee/                         # Native macOS system audio module
│       ├── src/
│       └── build.sh
├── supabase/
│   ├── migrations/
│   └── functions/
├── public/
│   └── app_icon.png
├── package.json
├── vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── tsconfig.json
└── .env.example
```