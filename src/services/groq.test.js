import { describe, it, expect, beforeEach, vi } from 'vitest'
import { transcribeAudio, sendToGroq } from './groq'

// Layer 2 — the Groq routes. Whisper does the app's STT; the chat route is the
// alternative LLM path, picked when the chosen model name starts with "llama".

const sentInit = () => fetch.mock.calls.at(-1)[1]
const sentBody = () => JSON.parse(sentInit().body)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('transcribeAudio', () => {
  const audioBlob = new Blob(['fake wav bytes'], { type: 'audio/wav' })

  it('returns the transcript', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ text: 'What is virtue?' }) })
    await expect(transcribeAudio({ apiKey: 'gsk', audioBlob })).resolves.toBe('What is virtue?')
  })

  it('trims surrounding whitespace', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ text: '  padded.  ' }) })
    await expect(transcribeAudio({ apiKey: 'gsk', audioBlob })).resolves.toBe('padded.')
  })

  it('returns an empty string when Whisper heard nothing', async () => {
    // Silence is not an error — MainScreen treats an empty transcript as "go back
    // to listening", so this must resolve rather than throw.
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(transcribeAudio({ apiKey: 'gsk', audioBlob })).resolves.toBe('')
  })

  it('posts multipart form data with the model and the spelling hint', async () => {
    // The "Aporius" prompt is a vocabulary hint — without it Whisper renders the
    // name a dozen different ways.
    fetch.mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) })
    await transcribeAudio({ apiKey: 'gsk', audioBlob })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )

    const form = sentInit().body
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('prompt')).toBe('Aporius')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('sets the bearer token and no Content-Type', async () => {
    // FormData must set its own multipart boundary; naming Content-Type here
    // would break the upload.
    fetch.mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) })
    await transcribeAudio({ apiKey: 'gsk', audioBlob })

    expect(sentInit().headers).toEqual({ Authorization: 'Bearer gsk' })
  })

  it('throws with the status and the body text on failure', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limit reached' })
    await expect(transcribeAudio({ apiKey: 'gsk', audioBlob })).rejects.toThrow(
      'Groq Whisper 429: rate limit reached',
    )
  })

  it('still throws when the error body cannot be read', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('unreadable')
      },
    })
    await expect(transcribeAudio({ apiKey: 'gsk', audioBlob })).rejects.toThrow('Groq Whisper 500:')
  })
})

describe('sendToGroq', () => {
  const messages = [{ role: 'user', content: 'What is virtue?' }]
  const reply = (content) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  })

  it('returns the trimmed reply', async () => {
    fetch.mockResolvedValue(reply('  Virtue is a habit.  '))
    await expect(sendToGroq({ apiKey: 'gsk', model: 'llama-3.3-70b', messages })).resolves.toBe(
      'Virtue is a habit.',
    )
  })

  it('puts the persona in a system message ahead of the conversation', async () => {
    // Anthropic takes a top-level `system`; the OpenAI-shaped Groq API takes a
    // system-role message instead. Same persona, different envelope.
    fetch.mockResolvedValue(reply('ok'))
    await sendToGroq({ apiKey: 'gsk', model: 'llama-3.3-70b', messages, summary: 'They like Hume.' })

    const sent = sentBody().messages
    expect(sent[0].role).toBe('system')
    expect(sent[0].content).toContain('You are Aporius')
    expect(sent[0].content).toContain('They like Hume.')
    expect(sent.slice(1)).toEqual(messages)
  })

  it('says so explicitly when there is no history', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToGroq({ apiKey: 'gsk', model: 'llama-3.3-70b', messages })
    expect(sentBody().messages[0].content).toContain('(No prior conversation history.)')
  })

  it('sends the same 300-token ceiling as the Claude route', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToGroq({ apiKey: 'gsk', model: 'llama-3.3-70b', messages })
    expect(sentBody()).toMatchObject({ model: 'llama-3.3-70b', max_tokens: 300 })
  })

  it("throws the API's own message when it gives one", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit reached for llama-3.3-70b' } }),
    })
    await expect(sendToGroq({ apiKey: 'gsk', model: 'llama-3.3-70b', messages })).rejects.toThrow(
      'Rate limit reached for llama-3.3-70b',
    )
  })

  it('falls back to the status code when the error body is unreadable', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json')
      },
    })
    await expect(sendToGroq({ apiKey: 'gsk', model: 'llama-3.3-70b', messages })).rejects.toThrow(
      'Groq API error: 503',
    )
  })
})
