# CueMe Implementation Progress

## Current Status

| Phase | Status |
|-------|--------|
| Phase 1: Infrastructure | ✅ Complete |
| Phase 2: Audio Pipeline | ✅ Complete |
| Phase 3: Two-Window Architecture | ✅ Complete |
| Phase 4: RAG Pipeline | 🔄 Next |

---

## Completed

### Phase 1: Infrastructure
- Database: 5 tables, pgvector, RLS
- Project: Electron + React + Vite + Tailwind
- Auth, LLM, UI

### Phase 2: Audio Pipeline ✅
- **Microphone capture**: `src/hooks/useMicrophoneCapture.ts` - React hook using Web Audio API
- **Gemini Live API**: `electron/services/audio/gemini-live.ts` - WebSocket connection to `gemini-2.5-flash-native-audio-preview-12-2025`
- **Audio IPC**: Renderer → Main → Gemini Live
- **Question detection**: Via system prompt + regex patterns
- **Session resumption**: Handles 10-min limit with session handles
- **Context window compression**: Enabled for long interviews

### Phase 3: Two-Window Architecture ✅
Implemented the PRD two-window model:

**Main Window** (1000×700):
- Settings & Authentication
- Document Collections management
- Question History (placeholder)

**Overlay Window** (600×400, floating, always-on-top):
- Listen button with mic capture
- Detected questions display
- Response generation with RAG
- Minimizable/closable

**Key Files Created/Updated**:
- `electron/services/window/WindowHelper.ts` - Two-window management
- `electron/main.ts` - Creates both windows, registers shortcuts
- `electron/ipc/window-handlers.ts` - Window IPC handlers
- `electron/preload.ts` - Added window control APIs
- `src/main.tsx` - Hash-based routing (#/overlay)
- `src/components/overlay/Overlay.tsx` - Overlay UI component
- `src/App.tsx` - Main window (documents/history only)

**Global Shortcuts**:
- `Cmd+Shift+C` / `Ctrl+Shift+C` - Toggle overlay
- `Cmd+Shift+L` / `Ctrl+Shift+L` - Toggle listening (shows overlay)
- `Cmd+Shift+G` / `Ctrl+Shift+G` - Generate response (shows overlay)
- `Cmd+,` / `Ctrl+,` - Show main window

---

## Next: RAG Pipeline

### Tasks
1. **OpenAI embeddings**: `text-embedding-3-large` (1536d)
2. **Document upload**: PDF, TXT, MD parsing
3. **Vector search**: `match_documents` RPC function
4. **RAG context**: Inject into Gemini prompts

### Key Files
- `electron/services/rag/embeddings-service.ts` - OpenAI embeddings
- `electron/services/rag/document-service.ts` - File parsing
- `electron/ipc/rag-handlers.ts` - Update for embeddings

---

## To Test Two-Window Architecture

```bash
cd desktop
npm start
```

1. Sign in
2. Click "Open Assistant" in sidebar → Opens overlay
3. In overlay: Click "Start Listening"
4. Speak - questions appear in overlay
5. Click question → generates response
6. Use `Cmd+Shift+C` to toggle overlay visibility
7. Use `Cmd+,` to show main window
