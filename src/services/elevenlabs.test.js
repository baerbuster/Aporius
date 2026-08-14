import { describe, it, expect, beforeEach, vi } from 'vitest'
import { synthesizeSpeech, ElevenLabsQuotaError, REFLECTION_VOICE } from './elevenlabs'

// Layer 2 — ElevenLabs, the primary voice. The one case that matters most here is
// 402: it is the trigger for the whole Google fallback, and it is the error that
// actually fires in practice when the month's quota runs out.

const sentInit = () => fetch.mock.calls.at(-1)[1]
const sentBody = () => JSON.parse(sentInit().body)

const audio = () => ({ ok: true, blob: async () => new Blob(['mp3'], { type: 'audio/mpeg' }) })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('synthesizeSpeech', () => {
  it('returns the audio blob', async () => {
    fetch.mockResolvedValue(audio())
    const blob = await synthesizeSpeech({ apiKey: 'xi', text: 'Hello.' })
    expect(await blob.text()).toBe('mp3')
  })

  it('posts to the Highland Sage voice and asks for mpeg', async () => {
    fetch.mockResolvedValue(audio())
    await synthesizeSpeech({ apiKey: 'xi', text: 'Hello.' })

    expect(fetch.mock.calls.at(-1)[0]).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/s2wvuS7SwITYg8dqsJdn',
    )
    expect(sentInit().headers).toMatchObject({ 'xi-api-key': 'xi', Accept: 'audio/mpeg' })
    expect(sentBody().model_id).toBe('eleven_turbo_v2_5')
  })

  it('uses the speaking-voice defaults when given no settings', async () => {
    fetch.mockResolvedValue(audio())
    await synthesizeSpeech({ apiKey: 'xi', text: 'Hello.' })

    expect(sentBody().voice_settings).toEqual({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
    })
  })

  it('lets the reflection preset override those defaults', async () => {
    // This is what makes the murmurs sound muttered rather than performed. If the
    // spread stopped applying, the reflection phase would come through at full
    // presence and the contrast with his actual reply would be gone.
    fetch.mockResolvedValue(audio())
    await synthesizeSpeech({ apiKey: 'xi', text: 'Hello.', voiceSettings: REFLECTION_VOICE })

    expect(sentBody().voice_settings).toEqual({
      stability: 0.9,
      similarity_boost: 0.4,
      style: 0,
    })
  })

  it('merges a partial override onto the defaults', async () => {
    fetch.mockResolvedValue(audio())
    await synthesizeSpeech({ apiKey: 'xi', text: 'Hello.', voiceSettings: { stability: 0.1 } })

    expect(sentBody().voice_settings).toEqual({
      stability: 0.1,
      similarity_boost: 0.75,
      style: 0,
    })
  })

  it('throws a typed quota error on 402', async () => {
    // Typed, not a message match: MainScreen tests `instanceof` to decide whether
    // to fall back to Google, and a message-based check would break the moment
    // ElevenLabs reworded it.
    fetch.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })

    const call = synthesizeSpeech({ apiKey: 'xi', text: 'Hello.' })
    await expect(call).rejects.toThrow(ElevenLabsQuotaError)
    await expect(call).rejects.toThrow('ElevenLabs quota exceeded')
  })

  it("uses the API's own detail message when it gives one", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: { message: 'Invalid API key' } }),
    })
    await expect(synthesizeSpeech({ apiKey: 'bad', text: 'Hello.' })).rejects.toThrow(
      'Invalid API key',
    )
  })

  it.each([401, 422, 500])('does not raise a quota error on %i', async (status) => {
    // The mirror of the 402 test. A non-quota failure must NOT be typed as one,
    // or every transient blip would burn the Google fallback instead of retrying.
    fetch.mockResolvedValue({ ok: false, status, json: async () => ({}) })

    const err = await synthesizeSpeech({ apiKey: 'xi', text: 'Hello.' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ElevenLabsQuotaError)
  })

  it('falls back to the status code when the error body is unreadable', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json')
      },
    })
    await expect(synthesizeSpeech({ apiKey: 'xi', text: 'Hello.' })).rejects.toThrow(
      'ElevenLabs TTS error: 500',
    )
  })
})

describe('REFLECTION_VOICE', () => {
  it('is the flat, breathy preset the murmurs are tuned to', () => {
    // One constant imported by both call sites so the murmurs and the thinking
    // sounds can never drift apart. Pinned because these are tuned by ear and a
    // stray edit would be inaudible in a test run but obvious in the app.
    expect(REFLECTION_VOICE).toEqual({ stability: 0.9, style: 0, similarity_boost: 0.4 })
  })
})
