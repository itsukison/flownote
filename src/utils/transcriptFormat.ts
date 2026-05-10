/**
 * Splits a same-speaker run of AmiVoice segments into render-ready lines.
 *
 * AmiVoice already emits one segment per natural utterance, so each segment becomes
 * its own line. For long monologue segments (>SOFT_BREAK_THRESHOLD chars), we
 * additionally split on sentence terminators so a 200-character paragraph doesn't
 * become a wall of text.
 */
const SOFT_BREAK_THRESHOLD = 100

// Japanese (。．？！) + Latin (.?!) terminators. Keep terminator with preceding clause.
const SENTENCE_BOUNDARY = /([^。．！？.!?]+[。．！？.!?]+)/g

export function splitTranscriptLines(segments: string[]): string[] {
  const out: string[] = []
  for (const raw of segments) {
    const seg = raw.trim()
    if (!seg) continue
    if (seg.length <= SOFT_BREAK_THRESHOLD) {
      out.push(seg)
      continue
    }
    const matches = seg.match(SENTENCE_BOUNDARY)
    if (!matches || matches.length < 2) {
      out.push(seg)
      continue
    }
    let consumed = 0
    for (const m of matches) {
      const piece = m.trim()
      if (piece) out.push(piece)
      consumed += m.length
    }
    const tail = seg.slice(consumed).trim()
    if (tail) out.push(tail)
  }
  return out
}
