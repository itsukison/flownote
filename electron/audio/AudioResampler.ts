const INPUT_RATE = 16000
const OUTPUT_RATE = 24000
const RATE_RATIO = OUTPUT_RATE / INPUT_RATE

export function resamplePcm16To24k(input: Buffer): Buffer {
  if (!input || input.length === 0) return input

  const inputSamples = new Int16Array(
    input.buffer,
    input.byteOffset,
    Math.floor(input.length / 2)
  )

  if (inputSamples.length === 0) return Buffer.alloc(0)

  const outputLength = Math.floor(inputSamples.length * RATE_RATIO)
  const output = Buffer.alloc(outputLength * 2)

  for (let i = 0; i < outputLength; i++) {
    const position = i / RATE_RATIO
    const leftIndex = Math.floor(position)
    const rightIndex = Math.min(leftIndex + 1, inputSamples.length - 1)
    const frac = position - leftIndex

    const leftSample = inputSamples[leftIndex]
    const rightSample = inputSamples[rightIndex]
    const interpolated = leftSample + (rightSample - leftSample) * frac
    const clamped = Math.max(-32768, Math.min(32767, Math.round(interpolated)))
    output.writeInt16LE(clamped, i * 2)
  }

  return output
}
