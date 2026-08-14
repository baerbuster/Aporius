import { describe, it, expect, beforeEach, vi } from 'vitest'
import { synthesizeSpeech, base64ToAudioBlob, speakWithBrowserTTS } from './googleTTS'

// Layer 2 — Google TTS, the fallback voice, plus the browser synthesizer that is
// the last resort when every network voice has failed.

const sentUrl = () => fetch.mock.calls.at(-1)[0]
const sentBody = () => JSON.parse(fetch.mock.calls.at(-1)[1].body)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('synthesizeSpeech', () => {
  it('returns the base64 audio', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ audioContent: 'YWJj' }) })
    await expect(synthesizeSpeech({ apiKey: 'g-key', text: 'Hello.' })).resolves.toBe('YWJj')
  })

  it('passes the key in the query string', async () => {
    // Google TTS keys go in the URL, not a header — unlike every other service here.
    fetch.mockResolvedValue({ ok: true, json: async () => ({ audioContent: 'x' }) })
    await synthesizeSpeech({ apiKey: 'g-key', text: 'Hello.' })
    expect(sentUrl()).toBe('https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=g-key')
  })

  it('asks for MP3 in the philosopher voice, slightly slowed', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ audioContent: 'x' }) })
    await synthesizeSpeech({ apiKey: 'g-key', text: 'Hello.' })

    expect(sentBody()).toEqual({
      input: { text: 'Hello.' },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-D', ssmlGender: 'MALE' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
    })
  })

  it("throws the API's own message when it gives one", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'API key not valid' } }),
    })
    await expect(synthesizeSpeech({ apiKey: 'bad', text: 'Hello.' })).rejects.toThrow(
      'API key not valid',
    )
  })

  it('falls back to the status code when the error body is unreadable', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json')
      },
    })
    await expect(synthesizeSpeech({ apiKey: 'g-key', text: 'Hello.' })).rejects.toThrow(
      'TTS error: 500',
    )
  })
})

describe('base64ToAudioBlob', () => {
  it('decodes to a blob of the original bytes', async () => {
    const blob = base64ToAudioBlob(btoa('philosopher'))
    expect(await blob.text()).toBe('philosopher')
  })

  it('labels the blob as MP3', () => {
    // The type matters: an <audio> element given the wrong one refuses to play.
    expect(base64ToAudioBlob(btoa('x')).type).toBe('audio/mpeg')
  })

  it('handles high bytes without mangling them', async () => {
    // charCodeAt on a binary string is only safe below 256; this pins that the
    // top of that range survives the round trip.
    const blob = base64ToAudioBlob(btoa('\xff\xfe\x00\x01'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes]).toEqual([255, 254, 0, 1])
  })

  it('produces an empty blob from an empty string', () => {
    expect(base64ToAudioBlob('').size).toBe(0)
  })
})

describe('speakWithBrowserTTS', () => {
  it('cancels whatever was already speaking before it starts', async () => {
    // Without the cancel, an interrupted error message queues behind the old one
    // instead of replacing it.
    speakWithBrowserTTS('Hello.', () => {})
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
    expect(window.speechSynthesis.speak).toHaveBeenCalled()
  })

  it('speaks low and slow', async () => {
    const utterance = speakWithBrowserTTS('Hello.', () => {})
    expect(utterance.text).toBe('Hello.')
    expect(utterance.rate).toBe(0.9)
    expect(utterance.pitch).toBe(0.75)
  })

  it('calls back when the utterance ends', () => {
    const onEnd = vi.fn()
    const utterance = speakWithBrowserTTS('Hello.', onEnd)
    utterance.onend()
    expect(onEnd).toHaveBeenCalled()
  })

  it('calls the same callback when the utterance errors', () => {
    // Both handlers point at onEnd on purpose: every caller uses it to restart
    // listening, and a failure that skipped it would strand the app.
    const onEnd = vi.fn()
    const utterance = speakWithBrowserTTS('Hello.', onEnd)
    utterance.onerror()
    expect(onEnd).toHaveBeenCalled()
  })

  it('calls back immediately when the browser has no speech synthesis', () => {
    delete window.speechSynthesis
    const onEnd = vi.fn()
    expect(speakWithBrowserTTS('Hello.', onEnd)).toBeNull()
    expect(onEnd).toHaveBeenCalled()
  })

  it('does not throw when there is no callback at all', () => {
    delete window.speechSynthesis
    expect(() => speakWithBrowserTTS('Hello.')).not.toThrow()
  })
})
