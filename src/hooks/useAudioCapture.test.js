import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioCapture } from './useAudioCapture'
import { transcribeAudio } from '../services/groq'

vi.mock('../services/groq', () => ({ transcribeAudio: vi.fn() }))

// The capture path: microphone → AudioWorklet → 16kHz PCM chunks, which fan out
// two ways at once. One copy accretes into a buffer that becomes the WAV posted
// to Whisper; the other goes straight to Deepgram for the reflection side. Neither
// may interfere with the other.

let context
let worklet
let source
let track

function fakeContext({ sampleRate = 16000, state = 'running', closeRejects = false } = {}) {
  source = { connect: vi.fn(), disconnect: vi.fn() }
  return {
    sampleRate,
    state,
    resume: vi.fn(async () => { context.state = 'running' }),
    close: vi.fn(() => (closeRejects ? Promise.reject(new Error('already closed')) : Promise.resolve())),
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => source),
  }
}

// A 16-bit PCM chunk, the shape the worklet actually posts.
const pcm = (...samples) => new Int16Array(samples).buffer

const capture = (groqKey = 'gsk', onAudioChunk = undefined) =>
  renderHook(({ key, cb }) => useAudioCapture({ groqKey: key, onAudioChunk: cb }), {
    initialProps: { key: groqKey, cb: onAudioChunk },
  })

// The blob handed to Whisper, as bytes.
const sentWav = async () => new DataView(await transcribeAudio.mock.calls.at(-1)[0].audioBlob.arrayBuffer())
const ascii = (view, offset, length) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

beforeEach(() => {
  transcribeAudio.mockReset()
  transcribeAudio.mockResolvedValue('What is virtue?')

  track = { stop: vi.fn() }
  const micStream = { getTracks: () => [track] }

  context = fakeContext()
  vi.stubGlobal('AudioContext', vi.fn(function () { return context }))
  vi.stubGlobal('AudioWorkletNode', vi.fn(function () {
    worklet = { port: {}, connect: vi.fn(), disconnect: vi.fn() }
    return worklet
  }))
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn(async () => micStream) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startCapture', () => {
  it('asks for a single processed channel and no video', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
  })

  it('asks for a 16kHz context, matching what Whisper wants', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(AudioContext).toHaveBeenCalledWith({ sampleRate: 16000, latencyHint: 'interactive' })
  })

  it('retries without the sample rate when the browser refuses it', async () => {
    // Safari throws rather than ignoring an unsupported rate; the worklet then
    // resamples in software instead.
    let first = true
    vi.stubGlobal('AudioContext', vi.fn(function (opts) {
      if (first && opts.sampleRate) {
        first = false
        throw new Error('unsupported sample rate')
      }
      return context
    }))

    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(AudioContext).toHaveBeenCalledTimes(2)
    expect(AudioContext).toHaveBeenLastCalledWith({ latencyHint: 'interactive' })
  })

  it('resumes a context the browser started suspended', async () => {
    context = fakeContext({ state: 'suspended' })
    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(context.resume).toHaveBeenCalled()
  })

  it('loads the worklet from the served path', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(context.audioWorklet.addModule).toHaveBeenCalledWith('/audio-processor.js')
  })

  it('tells the worklet both sample rates so it can resample', async () => {
    context = fakeContext({ sampleRate: 48000 })
    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(AudioWorkletNode).toHaveBeenCalledWith(context, 'audio-processor', {
      processorOptions: { sourceSampleRate: 48000, targetSampleRate: 16000 },
      numberOfInputs: 1,
      numberOfOutputs: 0,
    })
  })

  it('wires the microphone into the worklet', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())

    expect(context.createMediaStreamSource).toHaveBeenCalled()
    expect(source.connect).toHaveBeenCalledWith(worklet)
  })

  it('lets a failed mic reach the caller', async () => {
    // MainScreen turns this into the "change your mic permissions" screen, so it
    // must not be swallowed here.
    navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('NotAllowedError'))
    const { result } = capture()

    await expect(result.current.startCapture()).rejects.toThrow('NotAllowedError')
  })

  it('drops audio buffered by a previous turn', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())
    act(() => worklet.port.onmessage({ data: pcm(1, 2) }))

    await act(() => result.current.startCapture())
    await act(async () => { await result.current.stopCaptureAndGetTranscript() })

    expect(transcribeAudio).not.toHaveBeenCalled()
  })
})

describe('the chunks the worklet posts', () => {
  it('fans out to the live consumer', async () => {
    const onAudioChunk = vi.fn()
    const { result } = capture('gsk', onAudioChunk)
    await act(() => result.current.startCapture())

    const chunk = pcm(1, 2, 3)
    act(() => worklet.port.onmessage({ data: chunk }))

    expect(onAudioChunk).toHaveBeenCalledWith(chunk)
  })

  it('keeps buffering for Whisper even when the live consumer throws', async () => {
    // The two paths must not interfere. A dead Deepgram socket cannot be allowed
    // to cost the user their transcript.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onAudioChunk = vi.fn(() => { throw new Error('socket gone') })
    const { result } = capture('gsk', onAudioChunk)
    await act(() => result.current.startCapture())

    act(() => worklet.port.onmessage({ data: pcm(1, 2) }))
    await act(async () => { await result.current.stopCaptureAndGetTranscript() })

    expect(transcribeAudio).toHaveBeenCalled()
  })

  it('works with no live consumer at all', async () => {
    const { result } = capture('gsk', undefined)
    await act(() => result.current.startCapture())

    expect(() => worklet.port.onmessage({ data: pcm(1) })).not.toThrow()
  })

  it('reaches the newest consumer without restarting capture', async () => {
    // The consumer is held in a ref precisely so a re-render does not tear the
    // microphone down and build it again.
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = capture('gsk', first)
    await act(() => result.current.startCapture())

    rerender({ key: 'gsk', cb: second })
    act(() => worklet.port.onmessage({ data: pcm(9) }))

    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('stopCaptureAndGetTranscript', () => {
  it('returns an empty transcript without calling Whisper when nothing was captured', async () => {
    // Silence is free — no upload, no cost, and MainScreen reads the empty string
    // as "go back to listening".
    const { result } = capture()
    await act(() => result.current.startCapture())

    let transcript
    await act(async () => { transcript = await result.current.stopCaptureAndGetTranscript() })

    expect(transcript).toBe('')
    expect(transcribeAudio).not.toHaveBeenCalled()
  })

  it('posts the buffered audio and returns what Whisper heard', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())
    act(() => worklet.port.onmessage({ data: pcm(1, 2, 3) }))

    let transcript
    await act(async () => { transcript = await result.current.stopCaptureAndGetTranscript() })

    expect(transcript).toBe('What is virtue?')
    expect(transcribeAudio).toHaveBeenCalledWith({
      apiKey: 'gsk',
      audioBlob: expect.any(Blob),
    })
  })

  it('releases the microphone, the nodes and the context', async () => {
    // The recording indicator stays lit until the track is stopped, which users
    // notice immediately.
    const { result } = capture()
    await act(() => result.current.startCapture())
    await act(async () => { await result.current.stopCaptureAndGetTranscript() })

    expect(worklet.port.onmessage).toBeNull()
    expect(worklet.disconnect).toHaveBeenCalled()
    expect(source.disconnect).toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()
  })

  it('survives a teardown that throws', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())
    worklet.disconnect.mockImplementation(() => { throw new Error('already gone') })
    source.disconnect.mockImplementation(() => { throw new Error('already gone') })

    await expect(result.current.stopCaptureAndGetTranscript()).resolves.toBe('')
  })

  it('survives a context that refuses to close', async () => {
    context = fakeContext({ closeRejects: true })
    const { result } = capture()
    await act(() => result.current.startCapture())

    await expect(result.current.stopCaptureAndGetTranscript()).resolves.toBe('')
  })

  it('is safe to call before capture ever started', async () => {
    const { result } = capture()
    await expect(result.current.stopCaptureAndGetTranscript()).resolves.toBe('')
  })

  it('empties the buffer, so a second stop uploads nothing', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())
    act(() => worklet.port.onmessage({ data: pcm(1, 2) }))

    await act(async () => { await result.current.stopCaptureAndGetTranscript() })
    await act(async () => { await result.current.stopCaptureAndGetTranscript() })

    expect(transcribeAudio).toHaveBeenCalledTimes(1)
  })
})

describe('the WAV it builds', () => {
  // encodeWAV is module-private, so it is read back off the blob that reaches
  // Whisper. A malformed header is rejected by the API with a status code that
  // says nothing about which field was wrong, so each one is pinned here.
  let view

  beforeEach(async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())
    act(() => worklet.port.onmessage({ data: pcm(1, 2, 3, 4) })) // 8 bytes
    act(() => worklet.port.onmessage({ data: pcm(5, 6) })) //          4 bytes
    await act(async () => { await result.current.stopCaptureAndGetTranscript() })
    view = await sentWav()
  })

  it('opens with a RIFF/WAVE header', () => {
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(ascii(view, 36, 4)).toBe('data')
  })

  it('declares uncompressed 16-bit mono PCM', () => {
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // format: PCM
    expect(view.getUint16(22, true)).toBe(1) // channels
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
  })

  it('declares 16kHz, with a byte rate and block align to match', () => {
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000) // 16000 * 1 * 2
    expect(view.getUint16(32, true)).toBe(2) //     1 * 2
  })

  it('sizes both length fields to the audio it actually holds', () => {
    expect(view.getUint32(40, true)).toBe(12) // 8 + 4 bytes of samples
    expect(view.getUint32(4, true)).toBe(48) // 36 + 12
    expect(view.byteLength).toBe(56) // 44-byte header + 12
  })

  it('concatenates the chunks in the order they were spoken', () => {
    const samples = new Int16Array(view.buffer, 44, 6)
    expect([...samples]).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('cleanup', () => {
  it('releases everything and discards the buffer', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())
    act(() => worklet.port.onmessage({ data: pcm(1, 2) }))

    await act(() => result.current.cleanup())

    expect(track.stop).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()

    await act(async () => { await result.current.stopCaptureAndGetTranscript() })
    expect(transcribeAudio).not.toHaveBeenCalled()
  })

  it('is safe to call twice', async () => {
    const { result } = capture()
    await act(() => result.current.startCapture())

    await act(() => result.current.cleanup())
    await expect(result.current.cleanup()).resolves.toBeUndefined()
  })

  it('is safe to call before capture ever started', async () => {
    const { result } = capture()
    await expect(result.current.cleanup()).resolves.toBeUndefined()
  })
})
