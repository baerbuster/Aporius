import {
  synthesizeSpeech as elevenLabsSynthesize,
  ElevenLabsQuotaError,
} from './elevenlabs'
import { synthesizeSpeech as googleSynthesize, base64ToAudioBlob } from './googleTTS'

// ─── TTS: ElevenLabs → Google fallback ─────────────────────
export async function synthesizeSpeech({ elevenLabsKey, googleTTSKey, text, voiceSettings }) {
  try {
    const blob = await elevenLabsSynthesize({ apiKey: elevenLabsKey, text, voiceSettings })
    return { blob, url: URL.createObjectURL(blob) }
  } catch (err) {
    if (!(err instanceof ElevenLabsQuotaError)) throw err
    console.warn('[TTS] ElevenLabs quota exceeded, falling back to Google TTS')
    const base64 = await googleSynthesize({ apiKey: googleTTSKey, text })
    const blob = base64ToAudioBlob(base64)
    return { blob, url: URL.createObjectURL(blob) }
  }
}
