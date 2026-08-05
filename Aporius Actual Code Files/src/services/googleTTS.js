// Google Cloud TTS
// Voice: en-GB-Wavenet-B — deep British male, befitting a philosopher

const VOICE = {
  languageCode: 'en-US',
  name: 'en-US-Neural2-D',
  ssmlGender: 'MALE',
}

export async function synthesizeSpeech({ apiKey, text }) {
  const response = await fetch(
    `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: VOICE,
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 0.95,
        },
      }),
    },
  )

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `TTS error: ${response.status}`)
  }

  const data = await response.json()
  return data.audioContent // base64 MP3
}

export function base64ToAudioBlob(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: 'audio/mpeg' })
}

// Offline fallback using browser speech synthesis
export function speakWithBrowserTTS(text, onEnd) {
  if (!window.speechSynthesis) {
    onEnd?.()
    return null
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.9
  utterance.pitch = 0.75
  utterance.onend = onEnd
  utterance.onerror = onEnd
  window.speechSynthesis.speak(utterance)
  return utterance
}
