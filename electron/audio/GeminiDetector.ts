import { GoogleGenAI, Modality } from '@google/genai'
import { v4 as uuidv4 } from 'uuid'

export interface DetectedQuestion {
  id: string
  text: string
  timestamp: number
  source: 'gemini' | 'regex'
}

/**
 * Streams microphone audio to Gemini Live API and extracts questions in real-time.
 *
 * Detection uses two independent layers — whichever fires first wins per turn:
 *  1. Gemini JSON  — model outputs {"question": "..."} via outputAudioTranscription
 *  2. Regex        — applied to inputAudioTranscription (direct speech-to-text of what was said)
 *
 * The regex layer fixes two issues:
 *  - Japanese text garbled in outputAudioTranscription (model speaks JSON → transcribed back)
 *  - Gemini outputting {"question": null} even when a question was clearly asked
 *
 * inputAudioTranscription is a direct STT of the input audio, so Japanese text is reliable.
 */
export class GeminiDetector {
  private genAI: GoogleGenAI
  private session: any = null

  // outputBuffer: model's spoken JSON response, transcribed back to text
  private outputBuffer = ''
  // inputBuffer: direct speech-to-text of what the user said (reliable Japanese)
  private inputBuffer = ''

  private isListening = false
  private questions: DetectedQuestion[] = []

  // Detection layer toggles — can be changed at any time, even while listening
  private geminiEnabled = true
  private regexEnabled = true

  private onQuestion?: (q: DetectedQuestion) => void
  private onError?: (err: any) => void

  constructor(
    private readonly apiKey: string,
    callbacks?: {
      onQuestion?: (q: DetectedQuestion) => void
      onError?: (err: any) => void
    }
  ) {
    this.genAI = new GoogleGenAI({ apiKey })
    this.onQuestion = callbacks?.onQuestion
    this.onError = callbacks?.onError
  }

  async start(): Promise<void> {
    if (this.isListening) return

    const systemPrompt = `You are a JSON-only Question Extractor listening to a live conversation.

Your ONLY output must be EXACTLY one of these formats:
{"question": "the detected question text"}
OR
{"question": null}

RULES:
- Output ONLY the JSON object, nothing else
- Extract any question being asked (in any language, including Japanese)
- If no clear question is detected, output: {"question": null}
- NEVER output explanations, analysis, or any text besides the JSON
- Keep the question text exactly as spoken`

    this.session = await this.genAI.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => console.log('[GeminiDetector] Session opened'),
        onmessage: (msg: any) => this.handleMessage(msg),
        onerror: (err: any) => {
          console.error('[GeminiDetector] Session error:', err)
          this.onError?.(err)
        },
        onclose: (evt: any) => console.log('[GeminiDetector] Session closed:', evt.code),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},  // Direct STT of what was said — used for regex layer
        outputAudioTranscription: {},  // Transcription of model's JSON response
        systemInstruction: systemPrompt,
        temperature: 0.0,
        maxOutputTokens: 100,
      },
    })

    this.isListening = true
    console.log('[GeminiDetector] Listening started')
  }

  async stop(): Promise<void> {
    if (!this.isListening) return
    try {
      await this.session?.close()
    } catch (e) {
      console.error('[GeminiDetector] Error closing session:', e)
    }
    this.session = null
    this.isListening = false
    this.outputBuffer = ''
    this.inputBuffer = ''
    console.log('[GeminiDetector] Listening stopped')
  }

  async sendAudio(pcmBuffer: Buffer): Promise<void> {
    if (!this.session || !this.isListening) return
    try {
      await this.session.sendRealtimeInput({
        audio: {
          data: pcmBuffer.toString('base64'),
          mimeType: 'audio/pcm;rate=16000',
        },
      })
    } catch (e) {
      console.error('[GeminiDetector] Error sending audio:', e)
    }
  }

  private handleMessage(msg: any): void {
    // inputTranscription: direct STT of what the user said
    if (msg.serverContent?.inputTranscription?.text) {
      this.inputBuffer += msg.serverContent.inputTranscription.text
    }

    // outputTranscription: transcription of the model's spoken JSON response
    if (msg.serverContent?.outputTranscription?.text) {
      this.outputBuffer += msg.serverContent.outputTranscription.text
    }
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.text) this.outputBuffer += part.text
      }
    }

    if (msg.serverContent?.turnComplete) {
      this.processTurn()
    }

    // Model was interrupted — output is stale, but keep inputBuffer (we may still process it)
    if (msg.serverContent?.interrupted) {
      this.outputBuffer = ''
    }
  }

  /** Update detection layer toggles — safe to call while listening. */
  setDetectionMode(gemini: boolean, regex: boolean): void {
    this.geminiEnabled = gemini
    this.regexEnabled = regex
    console.log(`[GeminiDetector] Detection mode — gemini: ${gemini}, regex: ${regex}`)
  }

  /**
   * Run enabled detectors on the accumulated turn text.
   * Priority: Gemini JSON (higher quality text) → regex fallback (higher recall).
   */
  private processTurn(): void {
    const inputText = this.inputBuffer.trim()
    const outputText = this.outputBuffer.trim()
    this.inputBuffer = ''
    this.outputBuffer = ''

    // Layer 1: Gemini JSON detection
    if (this.geminiEnabled) {
      const geminiQuestion = this.parseGeminiJson(outputText)
      if (geminiQuestion) {
        console.log(`[GeminiDetector] Gemini detected question: "${geminiQuestion}"`)
        this.emitQuestion(geminiQuestion, 'gemini')
        return
      }
    }

    // Layer 2: Regex fallback on input transcription
    if (this.regexEnabled && inputText) {
      const regexQuestion = this.matchQuestionPattern(inputText)
      if (regexQuestion) {
        console.log(`[GeminiDetector] Regex detected question: "${regexQuestion}"`)
        this.emitQuestion(regexQuestion, 'regex')
      }
    }
  }

  // ─── Layer 1: Gemini JSON parser ──────────────────────────────────────────

  private parseGeminiJson(text: string): string | null {
    if (!text) return null
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim()
      const data = JSON.parse(clean)
      if (data?.question && typeof data.question === 'string' && data.question.trim().length > 0) {
        return data.question.trim()
      }
      return null
    } catch {
      // Fallback: regex extraction from malformed JSON
      const match = text.match(/"question":\s*"([^"]+)"/)
      return match?.[1]?.trim() ?? null
    }
  }

  // ─── Layer 2: Regex question pattern matcher ──────────────────────────────

  /**
   * Returns the input text unchanged if it matches a question pattern, null otherwise.
   * The text from inputAudioTranscription is already clean speech-to-text,
   * so the raw transcript is used as the question text.
   */
  private matchQuestionPattern(text: string): string | null {
    if (text.length < 4) return null

    // ── Japanese patterns ────────────────────────────────────────────────────

    // Any full-width or ASCII question mark
    if (/[？?]/.test(text)) return text

    // Polite question endings (ます/です form)
    if (/ですか[。？]?$/.test(text)) return text
    if (/ますか[。？]?$/.test(text)) return text
    if (/でしょうか[。？]?$/.test(text)) return text
    if (/ませんか[。？]?$/.test(text)) return text
    if (/ないですか[。？]?$/.test(text)) return text
    if (/ないでしょうか[。？]?$/.test(text)) return text

    // Explanatory / emphasis questions
    if (/んですか[。？]?$/.test(text)) return text
    if (/のですか[。？]?$/.test(text)) return text
    if (/のでしょうか[。？]?$/.test(text)) return text

    // Polite inquiry
    if (/いかがですか[。？]?$/.test(text)) return text
    if (/いかがでしょうか[。？]?$/.test(text)) return text
    if (/どうですか[。？]?$/.test(text)) return text
    if (/どうでしょうか[。？]?$/.test(text)) return text

    // Common verb question endings
    if (/ありますか[。？]?$/.test(text)) return text
    if (/しますか[。？]?$/.test(text)) return text
    if (/と思いますか[。？]?$/.test(text)) return text
    if (/いただけますか[。？]?$/.test(text)) return text
    if (/もらえますか[。？]?$/.test(text)) return text
    if (/できますか[。？]?$/.test(text)) return text

    // WH-word starters (interrogative words that almost always begin a question)
    if (/^(なぜ|どうして|どの|どんな|いつ|どこ|だれ|誰|何故|何で|どれ|どちら)/.test(text)) return text

    // ── English patterns ─────────────────────────────────────────────────────

    // Ends with ?
    if (/\?$/.test(text)) return text

    // Starts with a question word (word-boundary aware)
    if (/^(what|why|how|when|where|who|which|whose|whom|can|could|would|will|should|do|does|did|is|are|was|were|have|has|had)\b/i.test(text)) return text

    return null
  }

  // ─── Emit ─────────────────────────────────────────────────────────────────

  private emitQuestion(text: string, source: 'gemini' | 'regex'): void {
    const q: DetectedQuestion = {
      id: uuidv4(),
      text,
      timestamp: Date.now(),
      source,
    }
    this.questions.push(q)
    this.onQuestion?.(q)
  }

  getQuestions(): DetectedQuestion[] {
    return [...this.questions]
  }

  clearQuestions(): void {
    this.questions = []
  }

  get active(): boolean {
    return this.isListening
  }
}
