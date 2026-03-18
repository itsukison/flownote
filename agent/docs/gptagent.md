# Flownote OpenAI Realtime Question Detection Migration

**Summary**
Replace the Gemini Live + regex detector in Flownote with OpenAI Realtime (text-only), keep mic + system audio capture, add 16k→24k resampling, remove detection settings UI/storage, and stop token-usage tracking for detection while keeping question count.

**Implementation Changes**
1. **Realtime detector + prompt**
   - Add `OpenAIRealtimeQuestionDetector` in `flownote/electron/audio/` with:
     - Two WebSocket sessions (mic/user + system/opponent).
     - `session.update` with `output_modalities: ["text"]`, `semantic_vad`, and Japanese-first JSON prompt.
     - Accumulate `response.output_text.delta` into per-source buffers; parse JSON on `response.output_text.done`.
     - Emit `question-detected` with `Question` shape and `source: "realtime"` (or omit source entirely).
     - Keep JSON cleanup + fallback regex extraction of `"question": "..."`, plus `looksLikeQuestion` guard.
   - Add `questionPrompt.ts` with the shared Japanese-first JSON-only prompt.

2. **Audio pipeline refactor (main process)**
   - Replace `GeminiDetector` usage in `flownote/electron/ipc/handlers.ts` with the Realtime detector.
   - Update `start-listening` to require `OPENAI_API_KEY` (GEMINI stays for response generation).
   - Update system audio path: before sending to Realtime, auto-detect audiotee format and convert Float32 → PCM16 when needed, then resample to 24k.
   - Update mic path: Float32 → PCM16 → resample to 24k → send.

3. **Resampling + PCM conversion**
   - Add `AudioResampler.ts` (linear interpolation) to convert PCM16 16k → 24k.
   - Add small helper (or inline in handlers) to detect Float32 vs PCM16 for system audio and convert when necessary.

4. **Remove detection settings (UI + storage + IPC)**
   - Delete detection settings storage in `flownote/electron/services/tokenStorage.ts` and remove `set/getDetectionSettings` IPC handlers.
   - Remove detection toggles from `SettingsPage.tsx` and related i18n strings.
   - Remove `setDetectionSettings/getDetectionSettings` from `preload.ts` and `src/types/global.d.ts`.
   - Remove detection settings state/useEffect in `src/App.tsx`.

5. **Types + question model**
   - Update `Question` type in `src/types/global.d.ts` to use `source?: "realtime"` (or drop source if not used).
   - Update any UI usage that expects `source: "gemini" | "regex"`.

6. **Usage tracking**
   - Remove Gemini token usage tracking for detection (no `TokenUsage` in detector); keep `trackQuestionCount()` on `question-detected`.
   - Leave response-generation token tracking as-is.

7. **Docs**
   - Update `flownote/agent/productPRD.md` and `flownote/agent/architecture.md` to reflect OpenAI Realtime detection, removal of regex fallback, and new 24k resample step.

**Public API / Interface Changes**
- Remove IPC: `set-detection-settings`, `get-detection-settings`.
- Update `Question.source` semantics (`"realtime"` or remove).
- `start-listening` now depends on `OPENAI_API_KEY` (detection).

**Test Plan**
1. Start listening with mic + system audio:
   - Japanese direct question → detected.
   - Japanese indirect request (“〜していただけますか”) → detected.
   - Statement → ignored.
2. System audio:
   - Confirm audiotee format detection; no crashes; questions still detected.
3. Regression:
   - UI still starts/stops listening; question list updates.
   - Settings page renders without detection section.
4. Permissions:
   - System audio unavailable → mic-only still works.

**Assumptions**
- OpenAI Realtime is used only for question detection; Gemini remains for response generation.
- No need to estimate Realtime token usage for detection.
- Realtime uses 24k PCM16 input; resampling required.
