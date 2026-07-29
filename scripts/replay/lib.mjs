import fs from 'node:fs'

/**
 * Shared helpers for the detection replay harness.
 *
 * The gate below is stage 1 of the transcript-driven detector (AmiVoice segment →
 * cheap regex → LLM classify). It is deliberately recall-oriented: precision is
 * stage 2's job. `npm run log:replay -- --variant gate` measures exactly how
 * recall-oriented it actually is on real sessions.
 *
 * This is a MIRROR of `QUESTION_GATE` in `electron/audio/questionGate.ts`, which is
 * what the app ships — scoring a different filter than production is worse than not
 * scoring at all. `npm run test:transcript` fails if the two literals drift.
 */
export const QUESTION_GATE =
  /[?？]|(です|ます|でしょう|ました|ません)か(?!ら)|(ください|下さい|いただけますか|もらえますか|願えますか)|(教えて|聞かせて|伺|いかが|どう(です|でしょう)?|どちら|どれ|どの|どこ|いつ|誰|だれ|なぜ|なんで(?!す)|何(?!か)|なに(?!か)|いくら|どのくらい|どれくらい|どんな)/

export function questionGate(text) {
  return QUESTION_GATE.test(text ?? '')
}

/** MIRROR of hasExplicitQuestionMarker in electron/audio/questionGate.ts. */
export const hasExplicitQuestionMarker = questionGate

/**
 * MIRROR of NON_CANDIDATE in electron/audio/questionGate.ts — keep byte-identical.
 */
export const NON_CANDIDATE =
  /^(はい|ええ|うん|うーん|あー|えー|あの|えっと|まあ|そう|そうです|そうですね|そうですか|なるほど|なるほどですね|わかりました|承知しました|了解です|ありがとうございます|ありがとうございました|よろしくお願いします|失礼します|こんにちは|おはようございます|お世話になっております|では|それでは|はいはい)[。、！\.\s]*$/

const MIN_CANDIDATE_CHARS = 6

/**
 * MIRROR of shouldClassify in electron/audio/questionGate.ts. This — not
 * QUESTION_GATE — is what the app actually filters on, so `--variant gate` scores
 * this. QUESTION_GATE now only decides whether the classifier is also handed the
 * audio (see TranscriptQuestionDetector), which this harness cannot replay.
 */
export function shouldClassify(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return false
  if (NON_CANDIDATE.test(trimmed)) return false
  if (hasExplicitQuestionMarker(trimmed)) return true
  return trimmed.replace(/[。、，．,.！!？?\s]/g, '').length >= MIN_CANDIDATE_CHARS
}

export function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l)
      } catch {
        console.warn(`[replay] skipping unparseable line ${i + 1} of ${file}`)
        return null
      }
    })
    .filter(Boolean)
}

export function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

const normalize = (s) => (s ?? '').replace(/[\s、。，．,.？?！!「」『』（）()]/g, '')

/** Character-bigram Dice coefficient — good enough to align two renderings of the same utterance. */
export function similarity(a, b) {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const bigrams = (s) => {
    const out = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      out.set(g, (out.get(g) ?? 0) + 1)
    }
    return out
  }
  const A = bigrams(x)
  const B = bigrams(y)
  if (A.size === 0 || B.size === 0) return x === y ? 1 : 0
  let overlap = 0
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0)
  const total = [...A.values()].reduce((a, b) => a + b, 0) + [...B.values()].reduce((a, b) => a + b, 0)
  return (2 * overlap) / total
}

export const channelToSpeaker = (channel) => (channel === 'user' ? 'You' : 'Speaker')

export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

export function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}
