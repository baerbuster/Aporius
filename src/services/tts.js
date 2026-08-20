import { synthesizeWithElevenLabs, ElevenLabsQuotaError } from './elevenlabs'
import { synthesizeWithGoogle, base64ToAudioBlob } from './googleTTS'

// ─── TTS: ElevenLabs → Google fallback ─────────────────────
export async function synthesizeWithFallback({ elevenLabsKey, googleTTSKey, text, voiceSettings }) {
  try {
    const blob = await synthesizeWithElevenLabs({ apiKey: elevenLabsKey, text, voiceSettings })
    return { blob, url: URL.createObjectURL(blob) }
  } catch (err) {
    if (!(err instanceof ElevenLabsQuotaError)) throw err
    console.warn('[TTS] ElevenLabs quota exceeded, falling back to Google TTS')
    const base64 = await synthesizeWithGoogle({ apiKey: googleTTSKey, text })
    const blob = base64ToAudioBlob(base64)
    return { blob, url: URL.createObjectURL(blob) }
  }
}

// Every caller pairs the same two keys out of settings before it can ask for a
// voice, and two of them then hand the result on as an injected `synthesize`.
// Bind the keys once here so that pairing exists in one place instead of four.
// The returned function takes (text, voiceSettings) — the shape both the
// thinking-sound pool and the reflection stream already expect.
export function synthesizerFor(settings) {
  return (text, voiceSettings) =>
    synthesizeWithFallback({
      elevenLabsKey: settings.elevenLabsKey,
      googleTTSKey: settings.googleTTSKey,
      text,
      voiceSettings,
    })
}
