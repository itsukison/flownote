# OpenAI Realtime Question Detector — Implementation Notes

## Overview

`OpenAIRealtimeQuestionDetector` manages two WebSocket connections to the OpenAI Realtime API to detect questions in live audio from both conversation participants.

## WebSocket Sessions

Two concurrent sessions are created:
- **`user`** — captures microphone input (the local user speaking)
- **`opponent`** — captures system audio (the remote participant via screen recording)

Both connect to:
```
wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview
```

Required headers:
```
Authorization: Bearer <OPENAI_API_KEY>
OpenAI-Beta: realtime=v1
```

## Session Configuration

After `session.created` is received, `session.update` is sent:
```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text"],
    "instructions": "<QUESTION_DETECTION_PROMPT>",
    "input_audio_format": "pcm16",
    "turn_detection": {
      "type": "semantic_vad"
    }
  }
}
```

Key points:
- `modalities: ['text']` — text-only output (no audio response from the model)
- `input_audio_format: 'pcm16'` — audio must be 16-bit PCM at 24kHz
- `turn_detection.type: 'semantic_vad'` — semantic voice activity detection; the model decides when a turn ends based on meaning, not silence

## Audio Flow

1. Microphone audio: `renderer → process-mic-chunk IPC → PCM16 → resample to 24kHz → userSocket`
2. System audio: `SystemAudioCapture → detect format → convert float32→PCM16 if needed → resample to 24kHz → opponentSocket`

Audio is sent as base64-encoded PCM16 chunks via `input_audio_buffer.append` events.

## Response Lifecycle

After VAD detects end of a turn:
1. `input_audio_buffer.speech_stopped` — VAD triggered
2. `input_audio_buffer.committed` — buffer flushed
3. `response.created` — model starts generating
4. Text delta events (one of three variants that OpenAI may fire):
   - `response.output_text.delta` / `response.output_text.done`
   - `response.text.delta` / `response.text.done`
   - `response.content_part.done` with `part.type === 'text'`
5. `response.done` — final event with `msg.response.usage = { input_tokens, output_tokens }`

The `userResponseProcessed` / `opponentResponseProcessed` flags prevent double-processing when multiple text events fire for the same turn.

## Token Usage in `response.done`

The `response.done` event carries usage data:
```json
{
  "type": "response.done",
  "response": {
    "id": "resp_xxx",
    "status": "completed",
    "usage": {
      "input_tokens": 142,
      "output_tokens": 28,
      "total_tokens": 170
    }
  }
}
```

**Current state**: usage is logged to console but not captured.
**Required**: call `onTokenUsage(input_tokens + output_tokens)` callback so the caller can persist it.

## Session Rotation

WebSocket connections are automatically recycled after **58 minutes** to avoid the OpenAI 60-minute session limit. The rotation timer starts after `session.updated` is confirmed. On expiry:
1. Current socket is closed cleanly
2. A new session is created via `reconnectSession(source)`
3. The new session goes through the full `session.created → session.update → session.updated` handshake

## Question Detection Logic

1. Model returns JSON: `{"question": "..."}` or `{"question": null}`
2. `parseQuestionFromJson()` extracts the question string (with regex fallback)
3. `looksLikeQuestion()` filters out non-questions (too long, starts with `**`, starts with `Analysis:`)
4. Valid questions are pushed to `this.questions` and emitted via `onQuestion` callback

## Reconnection

If a socket closes unexpectedly while `isListening === true`, a reconnect is scheduled after 1 second via `setTimeout(() => reconnectSession(source), 1000)`.
