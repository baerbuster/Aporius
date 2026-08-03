// ElevenLabs TTS
const VOICE_ID = 's2wvuS7SwITYg8dqsJdn' // The Highland Sage
const MODEL_ID = 'eleven_turbo_v2_5'

export class ElevenLabsQuotaError extends Error {}

// The reflection phase's voice — murmurs and reflected sentences alike. Flatter
// and looser than his speaking reply, which uses the defaults below.
//   stability 0.9        — near-monotone; he is not performing, he is muttering
//   style 0              — no exaggeration at all
//   similarity_boost 0.4 — loosened from 0.75; comes out breathier, less crisp,
//                          which is the closest this API gets to "under his breath"
// One constant, imported by both call sites, so the two can never drift apart.
export const REFLECTION_VOICE = {
  stability: 0.9,
  style: 0,
  similarity_boost: 0.4,
}

export async function synthesizeSpeech({ apiKey, text, voiceSettings = {} }) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          ...voiceSettings,
        },
      }),
    },
  )

  if (!response.ok) {
    if (response.status === 402) throw new ElevenLabsQuotaError('ElevenLabs quota exceeded')
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail?.message || `ElevenLabs TTS error: ${response.status}`)
  }

  return await response.blob()
}
