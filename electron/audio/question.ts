/**
 * The one shape a detected question has, whatever detected it. Two detectors
 * emit it today — the audio-native OpenAI Realtime one and the AmiVoice
 * transcript-driven one — and `ipc/listening.ts` handles both identically, so
 * the type lives here rather than inside either implementation.
 */
export interface Question {
  id: string
  text: string
  timestamp: number
  /** Which detector produced it. Also stored as `questions.source_audio_type`. */
  source?: 'realtime' | 'transcript'
  /**
   * Which audio channel produced it: 'opponent' = system audio (the counterpart),
   * 'user' = the mic (the user's own voice, which is usually a false positive for
   * "a question the user needs answered"). Carried so the log/harness can score
   * precision per channel.
   */
  channel?: 'user' | 'opponent'
  /**
   * Detection latency in ms, null when it wasn't observable. The anchor differs
   * by detector and that is inherent, not an inconsistency:
   *   realtime   — VAD `speech_stopped` → emit
   *   transcript — AmiVoice final segment → emit
   */
  detectLatencyMs?: number | null
  /** Detector's self-reported confidence, 0–1. Null when it didn't supply one. */
  confidence?: number | null
  /**
   * Retrieval query for this question with referents already resolved, when the
   * detector could produce one for free (the transcript detector classifies and
   * rewrites in a single call). Null means the answer path resolves it itself.
   */
  searchText?: string | null
}
