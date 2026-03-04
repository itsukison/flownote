# CueMe — AI Agent Design
> **Version**: 1.1 | **Updated**: March 2026

---

## 1. Model Selection

### 1.1 Audio Transcription & Question Detection — Gemini Live API

| Property | Value |
|---|---|
| **Model** | `gemini-2.5-flash-native-audio-preview-12-2025` |
| **Interface** | WebSocket (Live API) |
| **Input audio format** | Raw 16-bit PCM, 16 kHz, mono, little-endian |
| **Output** | Text transcription (`input_audio_transcription`) + question detection via system prompt |

> ⚠️ **Critical correction from original PRD**: The original document listed `gemini-2.0-flash` as the Live API model. This is incorrect. `gemini-2.0-flash` does **not** support the Live API. The correct model family for real-time audio streaming is `gemini-2.5-flash-native-audio-*`. Additionally, the preview model `gemini-live-2.5-flash-preview-native-audio-09-2025` is **deprecated and will be removed on March 19, 2026** — do not use it.

**Why `gemini-2.5-flash-native-audio-preview-12-2025`?**
- Native audio model: processes audio directly without an intermediate STT step, reducing latency
- Built-in Voice Activity Detection (VAD) — no separate VAD library needed
- Supports `input_audio_transcription` to get text from streamed audio
- 24 languages supported natively
- Available on the Gemini Developer API free tier

### 1.2 Response Generation — Gemini REST API

| Property | Value |
|---|---|
| **Model** | `gemini-2.5-flash` |
| **Interface** | Standard `v1beta/generateContent` (streaming) |
| **Use case** | Generate interview answers with optional RAG context injection |

This is correct usage — `gemini-2.5-flash` is well-suited for low-latency, cost-effective text generation and is not used for the Live API connection.

### 1.3 Text Embeddings — OpenAI

| Property | Value |
|---|---|
| **Model** | `text-embedding-3-large` |
| **Dimensions** | 1536 |
| **Use case** | Embed document chunks and query questions for RAG vector search |

---

## 2. Gemini Live API — Session Management (Critical)

Interviews can last 30–60+ minutes. The Live API has strict session limits that **must** be handled explicitly.

### 2.1 Session Limits

| Limit | Value |
|---|---|
| WebSocket connection lifetime | ~10 minutes |
| Audio-only session (without compression) | 15 minutes |
| Context window | 128k tokens |

An unhandled session expiry will silently drop the audio stream mid-interview — a critical failure for the product.

### 2.2 Required: Session Resumption

Enable `session_resumption` in setup config and persist the session handle:

```typescript
// GeminiLiveQuestionDetector.ts
const session = await client.aio.live.connect({
  model: "gemini-2.5-flash-native-audio-preview-12-2025",
  config: {
    response_modalities: ["TEXT"],           // TEXT only — we don't need audio back
    input_audio_transcription: {},           // Enable transcription of mic/system audio
    system_instruction: QUESTION_DETECTION_PROMPT,
    session_resumption: {
      handle: previousSessionHandle ?? null  // null = new session
    },
    context_window_compression: {           // Recommended for long interviews
      sliding_window: {},
    }
  }
});

// Listen for session handle updates and GoAway signals
for await (const message of session.receive()) {
  if (message.session_resumption_update?.new_handle) {
    this.sessionHandle = message.session_resumption_update.new_handle;
    await this.persistSessionHandle(this.sessionHandle); // save to disk/memory
  }
  if (message.go_away) {
    // Proactively reconnect before forced termination
    await this.reconnect();
  }
  if (message.server_content?.input_transcription) {
    this.onTranscript(message.server_content.input_transcription.text);
  }
}
```

### 2.3 Required: Context Window Compression

For interviews exceeding 15 minutes, enable `context_window_compression` with a sliding window. Without it, the session will be terminated at the 15-minute audio-only limit.

### 2.4 Implementation Architecture

The PRD proposes connecting to Gemini Live directly from the Electron main process (server-to-server pattern). This is the **correct and recommended approach** — the API key stays in the main process and is never exposed to the renderer. Avoid client-side WebSocket connections to the Live API.

```
Renderer → IPC → Main Process → Gemini Live API (WebSocket)
                     ↑
               API key stored here only
```

---

## 3. Question Detection Design

### 3.1 Approach

CueMe uses `input_audio_transcription` to obtain the real-time text transcript, then applies question detection logic in one of two ways:

**Option A (Recommended): System-prompt-driven detection**
Set a system instruction that asks Gemini to output structured JSON only when a question is detected. This leverages Gemini's language understanding within the same session — no second API call needed.

```
SYSTEM PROMPT:
You are a silent question detector for a job interview assistant.
Listen to the audio transcript. When you detect a complete question directed at the interviewee, output ONLY a JSON object:
{ "question": "<exact question text>", "confidence": 0.0-1.0 }
Output nothing for statements, filler words, or incomplete sentences.
Do not respond conversationally. Do not output audio.
```

**Option B: Post-processing transcript with regex/heuristics**
Buffer transcript tokens, detect sentence boundaries and question markers (`?`, `"tell me about"`, `"describe"`, etc.) in the main process. Lighter-weight but less accurate.

Recommendation: Start with Option A for accuracy; fall back to Option B if Live API response modality causes issues with TEXT-only mode.

### 3.2 Response Modality for Detection

Since CueMe only needs transcription + question text (no audio output), set:
```json
"response_modalities": ["TEXT"]
```
This reduces cost and eliminates unwanted audio responses from Gemini.

### 3.3 VAD Configuration

The Live API includes automatic Voice Activity Detection. Configure it to suit interview pacing:
```json
"realtime_input_config": {
  "automatic_activity_detection": {
    "disabled": false,
    "start_of_speech_sensitivity": "LOW",    // avoid false triggers
    "end_of_speech_sensitivity": "LOW",      // allow natural pauses mid-sentence
    "prefix_padding_ms": 200,
    "silence_duration_ms": 1000             // 1s pause = end of turn
  }
}
```

---

## 4. RAG Pipeline

```
User Question
     │
     ▼
OpenAI text-embedding-3-large (1536d)
     │
     ▼
pgvector cosine similarity search
(match_threshold: 0.7, match_count: 5)
     │
     ▼
Top-k document chunks retrieved
     │
     ▼
Gemini 2.5 Flash — generateContent (streaming)
System: "You are an interview coach. Answer based on the candidate's background below."
Context: [retrieved chunks]
User: [detected question]
     │
     ▼
Streaming response → Overlay UI
```

---

## 5. Cost Considerations

| Operation | Model | Estimated cost per interview |
|---|---|---|
| 60-min audio stream | Gemini Live (2.5 Flash native audio) | ~$0.60–$1.20 (audio input tokens @ ~25 TPS) |
| Response generation (10 questions) | gemini-2.5-flash | ~$0.01–$0.05 |
| Embeddings (query only, docs pre-embedded) | text-embedding-3-large | Negligible |

> Actual costs depend on token rates at billing time. Monitor via Google AI Studio usage dashboard. Consider implementing a token budget warning in settings.

---

## 6. Known Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Session drops mid-interview | 🔴 Critical | Session resumption + GoAway handler (§2.2) |
| Context window overflow (long interview) | 🔴 Critical | Context window compression (§2.3) |
| `gemini-2.0-flash` deprecation affecting Live API references | 🟡 Medium | Use correct model names per §1.1 |
| Question detection false positives | 🟡 Medium | Confidence threshold filter (≥ 0.75) |
| Audio API key exposure from renderer | 🔴 Critical | Keys in main process only, IPC pattern (§2.4) |
| Rate limits on free tier | 🟡 Medium | Show user-facing rate limit error; document paid tier requirement |