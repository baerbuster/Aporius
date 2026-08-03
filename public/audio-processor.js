// AudioWorklet processor — runs in audio rendering thread
// Handles VAD (voice activity detection), downsampling to 16kHz, and PCM conversion

class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    // Source sample rate from AudioContext (typically 44100 or 48000)
    this.sourceSampleRate = options.processorOptions?.sourceSampleRate || sampleRate
    this.targetSampleRate = 16000
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate

    // Small resampling buffer to handle fractional ratios
    this.resampleBuffer = []
    this.resamplePhase = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0] || input[0].length === 0) return true

    const samples = input[0] // Float32Array, mono channel

    // Downsample from sourceSampleRate → 16000 using linear interpolation
    const outputLength = Math.floor(samples.length / this.resampleRatio)
    if (outputLength === 0) return true

    const output = new Int16Array(outputLength)
    for (let i = 0; i < outputLength; i++) {
      const srcIdx = i * this.resampleRatio
      const srcFloor = Math.floor(srcIdx)
      const srcCeil = Math.min(srcFloor + 1, samples.length - 1)
      const frac = srcIdx - srcFloor
      const sample = samples[srcFloor] * (1 - frac) + samples[srcCeil] * frac
      // Clamp and convert float32 [-1, 1] → int16 [-32768, 32767]
      output[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    }

    // Transfer buffer ownership to main thread (zero-copy)
    this.port.postMessage(output.buffer, [output.buffer])
    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
