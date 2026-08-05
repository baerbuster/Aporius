import { SYSTEM_PROMPT as APORIUS_SYSTEM_PROMPT } from './aporius-prompt.js'

// Groq Whisper batch STT
// Encodes buffered PCM chunks as WAV, POSTs to Groq, returns transcript string

export async function transcribeAudio({ apiKey, audioBlob }) {
  const formData = new FormData()
  formData.append('file', audioBlob, 'audio.wav')
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('prompt', 'Aporius')

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Groq Whisper ${response.status}: ${text}`)
  }

  const data = await response.json()
  return data.text?.trim() || ''
}

// Groq LLM — main Aporius response
// Same persona as the Claude route, imported from the shared module at the top
// of this file so the two can never drift apart.
export async function sendToGroq({ apiKey, model, messages, summary = '' }) {
  const systemPrompt = APORIUS_SYSTEM_PROMPT.replace(
    '{summary}',
    summary || '(No prior conversation history.)',
  )

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Groq API error: ${response.status}`)
  }

  const data = await response.json()
  return data.choices[0].message.content.trim()
}
