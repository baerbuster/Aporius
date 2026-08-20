import { describe, it, expect, beforeEach, vi } from 'vitest'
import { synthesizeWithFallback, synthesizerFor } from './tts'
import { synthesizeWithElevenLabs, ElevenLabsQuotaError } from './elevenlabs'
import { synthesizeWithGoogle, base64ToAudioBlob } from './googleTTS'

// Layer 3 — the fallback chain, and the binding that hands it round the app.
//
// The whole point of this module is a branch that only fires when ElevenLabs is
// out of quota, which in the app happens once a month at most and cannot be
// scheduled. Here it is a mock rejection.

vi.mock('./googleTTS', () => ({
  synthesizeWithGoogle: vi.fn(),
  base64ToAudioBlob: vi.fn(),
}))

// ElevenLabsQuotaError stays real — this module branches on the error *type*, so
// a stand-in class would make the fallback test prove nothing.
vi.mock('./elevenlabs', async (importOriginal) => ({
  ...(await importOriginal()),
  synthesizeWithElevenLabs: vi.fn(),
}))

const keys = { elevenLabsKey: 'xi-key', googleTTSKey: 'g-key' }

// restoreMocks does not clear vi.fn()s inside a mock factory.
beforeEach(() => {
  synthesizeWithElevenLabs.mockReset()
  synthesizeWithGoogle.mockReset()
  base64ToAudioBlob.mockReset()
})

describe('synthesizeWithFallback', () => {
  it('returns the ElevenLabs blob and a URL for it, without touching Google', async () => {
    const blob = new Blob(['mp3'], { type: 'audio/mpeg' })
    synthesizeWithElevenLabs.mockResolvedValue(blob)

    const result = await synthesizeWithFallback({ ...keys, text: 'Hello.' })

    expect(result.blob).toBe(blob)
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(result.url).toBe(URL.createObjectURL.mock.results[0].value)
    expect(synthesizeWithGoogle).not.toHaveBeenCalled()
  })

  it('passes the ElevenLabs key and the voice settings through', async () => {
    synthesizeWithElevenLabs.mockResolvedValue(new Blob(['mp3']))
    const voiceSettings = { stability: 0.9, style: 0, similarity_boost: 0.4 }

    await synthesizeWithFallback({ ...keys, text: 'Hello.', voiceSettings })

    expect(synthesizeWithElevenLabs).toHaveBeenCalledWith({
      apiKey: 'xi-key',
      text: 'Hello.',
      voiceSettings,
    })
  })

  it('falls back to Google when the quota is gone', async () => {
    const googleBlob = new Blob(['google mp3'], { type: 'audio/mpeg' })
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('out'))
    synthesizeWithGoogle.mockResolvedValue('YWJj')
    base64ToAudioBlob.mockReturnValue(googleBlob)

    const result = await synthesizeWithFallback({ ...keys, text: 'Hello.' })

    expect(synthesizeWithGoogle).toHaveBeenCalledWith({ apiKey: 'g-key', text: 'Hello.' })
    expect(base64ToAudioBlob).toHaveBeenCalledWith('YWJj')
    expect(result.blob).toBe(googleBlob)
    expect(URL.createObjectURL).toHaveBeenCalledWith(googleBlob)
  })

  it('does not carry the voice settings over to Google', async () => {
    // Google's request shape has no equivalent field, and its voice is fixed in
    // that module. Sending one would be silently ignored at best.
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('out'))
    synthesizeWithGoogle.mockResolvedValue('YWJj')
    base64ToAudioBlob.mockReturnValue(new Blob(['x']))

    await synthesizeWithFallback({
      ...keys,
      text: 'Hello.',
      voiceSettings: { stability: 0.9 },
    })

    expect(synthesizeWithGoogle).toHaveBeenCalledWith({ apiKey: 'g-key', text: 'Hello.' })
  })

  it('rethrows any other ElevenLabs failure instead of falling back', async () => {
    // A bad key, a network drop, a 500 — none of those mean "out of quota", and
    // quietly swapping voices would hide a problem worth surfacing.
    synthesizeWithElevenLabs.mockRejectedValue(new Error('ElevenLabs TTS error: 401'))

    await expect(synthesizeWithFallback({ ...keys, text: 'Hello.' })).rejects.toThrow(
      'ElevenLabs TTS error: 401',
    )
    expect(synthesizeWithGoogle).not.toHaveBeenCalled()
  })

  it('lets a Google failure through when both voices are down', async () => {
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('out'))
    synthesizeWithGoogle.mockRejectedValue(new Error('TTS error: 403'))

    await expect(synthesizeWithFallback({ ...keys, text: 'Hello.' })).rejects.toThrow(
      'TTS error: 403',
    )
  })
})

describe('synthesizerFor', () => {
  it('binds both keys out of settings so callers only pass text', async () => {
    synthesizeWithElevenLabs.mockResolvedValue(new Blob(['mp3']))
    const synthesize = synthesizerFor({
      elevenLabsKey: 'xi-key',
      googleTTSKey: 'g-key',
      claudeKey: 'irrelevant',
    })

    await synthesize('Hello.')

    expect(synthesizeWithElevenLabs).toHaveBeenCalledWith({
      apiKey: 'xi-key',
      text: 'Hello.',
      voiceSettings: undefined,
    })
  })

  it('passes voice settings through as the second argument', async () => {
    // The shape both the thinking-sound pool and the reflection stream call it
    // with: (text, voiceSettings).
    synthesizeWithElevenLabs.mockResolvedValue(new Blob(['mp3']))
    const voiceSettings = { stability: 0.9, style: 0, similarity_boost: 0.4 }

    await synthesizerFor(keys)('...Hmmm...', voiceSettings)

    expect(synthesizeWithElevenLabs).toHaveBeenCalledWith({
      apiKey: 'xi-key',
      text: '...Hmmm...',
      voiceSettings,
    })
  })

  it('returns the same { blob, url } the chain produces', async () => {
    const blob = new Blob(['mp3'])
    synthesizeWithElevenLabs.mockResolvedValue(blob)

    const result = await synthesizerFor(keys)('Hello.')

    expect(result.blob).toBe(blob)
    expect(result.url).toBe(URL.createObjectURL.mock.results[0].value)
  })

  it('reads the keys at call time, so saved settings take effect', async () => {
    // The hooks rebuild this on every render from the current settings object;
    // nothing caches a key from first render.
    synthesizeWithElevenLabs.mockResolvedValue(new Blob(['mp3']))
    const settings = { elevenLabsKey: 'old-key', googleTTSKey: 'g-key' }
    const synthesize = synthesizerFor(settings)

    settings.elevenLabsKey = 'new-key'
    await synthesize('Hello.')

    expect(synthesizeWithElevenLabs).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'new-key' }),
    )
  })

  it('lets the fallback failure reach the caller', async () => {
    synthesizeWithElevenLabs.mockRejectedValue(new Error('ElevenLabs TTS error: 500'))

    await expect(synthesizerFor(keys)('Hello.')).rejects.toThrow('ElevenLabs TTS error: 500')
  })
})
