import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createReflectionStream } from './reflectionStream'

// Layer 3 — the two-stage pipeline.
//
// Both stages are strictly serial with their own in-flight flag, and they run
// alongside each other: sentence N+1's Claude call overlaps sentence N's TTS
// render. The properties that matter are that neither stage can ever stall the
// turn, and that every object URL handed out is eventually handed back.

// One Claude reply, in the shape the service unwraps.
const claudeReply = (reflected, profundity) => ({
  ok: true,
  json: async () => ({ content: [{ text: JSON.stringify({ reflected, profundity }) }] }),
})

// A synthesizer that succeeds instantly, minting a fresh object URL each time.
const workingSynth = () =>
  vi.fn(async (text) => {
    const blob = new Blob([text])
    return { blob, url: URL.createObjectURL(blob) }
  })

// Feed a list of sentences through a stream and wait for both stages to drain.
async function runThrough(stream, sentences) {
  stream.start()
  for (const s of sentences) stream.submit(s)
  return stream.stop()
}

const scores = (list) => list.map((e) => e.profundity)
const indices = (list) => list.map((e) => e.index)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  // The fallback paths warn on purpose; silenced so a green run stays readable.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the Claude stage', () => {
  it('reflects a sentence and files it', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 6))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()).toEqual([
      expect.objectContaining({ index: 0, original: 'I am tired.', reflected: 'You are tired.', profundity: 6 }),
    ])
  })

  it('keeps exactly one call in flight at a time', async () => {
    // The user decided against parallel calls. If this ever regresses, the free
    // tier drains and the ordering guarantees below stop holding.
    let live = 0
    let peak = 0
    fetch.mockImplementation(async () => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 1))
      live--
      return claudeReply('You are tired.', 5)
    })

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['One.', 'Two.', 'Three.', 'Four.'])

    expect(peak).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('sends the sentence at temperature zero with the shared system prompt', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['I am tired.'])

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      temperature: 0,
      messages: [{ role: 'user', content: 'I am tired.' }],
    })
    // Byte-identical on every call, which is what makes prompt caching apply.
    expect(typeof body.system).toBe('string')
  })
})

describe('when a reflection cannot be trusted', () => {
  it('falls back to the trimmed original when the call fails', async () => {
    fetch.mockRejectedValue(new Error('502'))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['  I am   tired.  '])

    expect(stream.getReflections()[0]).toMatchObject({
      reflected: 'I am tired.',
      profundity: 1, // unscored fallback
    })
  })

  it('falls back when the reply holds no JSON', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ text: 'sorry, no' }] }) })
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()[0].reflected).toBe('I am tired.')
  })

  it('keeps the queue moving after a failure', async () => {
    // One bad call must never stall the turn — the whole reason the fallback
    // exists rather than a rethrow.
    fetch
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(claudeReply('You are tired.', 7))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['I am tired.', 'I am also tired.'])

    expect(stream.getReflections()).toHaveLength(2)
  })

  it('replaces a paraphrase with the trimmed original but keeps the score', async () => {
    // §5c: the guard rejects the wording, not the judgement. Profundity is an
    // independent rating of the ORIGINAL, so it survives the rejection.
    fetch.mockResolvedValue(claudeReply('You are exhausted.', 8))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()[0]).toMatchObject({
      reflected: 'I am tired.',
      profundity: 8,
    })
  })

  it('accepts a reflection built only from allowed forms', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 8))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()[0].reflected).toBe('You are tired.')
  })

  it('accepts the user name when the stream was told one', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired, Buster.', 5))
    const stream = createReflectionStream({
      apiKey: 'sk-x',
      userName: 'Buster',
      synthesize: workingSynth(),
    })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()[0].reflected).toBe('You are tired, Buster.')
  })
})

describe('what never reaches the list', () => {
  it('drops a sentence the model reflected to nothing', async () => {
    // Pure filler. An empty reflection is the model saying "there is nothing here".
    fetch.mockResolvedValue(claudeReply('', 4))
    const synthesize = workingSynth()
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })

    await runThrough(stream, ['Um, you know.'])

    expect(stream.getReflections()).toEqual([])
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('drops a sentence scoring below the threshold', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 3))
    const synthesize = workingSynth()
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize, threshold: 5 })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()).toEqual([])
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('keeps a sentence sitting exactly on the threshold', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth(), threshold: 5 })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()).toHaveLength(1)
  })

  it('applies a threshold raised mid-turn', async () => {
    fetch
      .mockResolvedValueOnce(claudeReply('You are tired.', 4))
      .mockResolvedValueOnce(claudeReply('You are curious.', 4))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    stream.start()
    stream.submit('I am tired.')
    await vi.waitFor(() => expect(stream.getReflections()).toHaveLength(1))

    stream.setThreshold(6)
    stream.submit('I am curious.')
    await stream.stop()

    expect(stream.getReflections()).toHaveLength(1)
  })

  it('ignores a non-finite threshold', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 2))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    stream.setThreshold('high')

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()).toHaveLength(1)
  })

  it.each([['   '], [''], [null], [undefined], [42]])('ignores the submitted value %o', async (value) => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, [value])

    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores a sentence submitted before start', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    stream.submit('I am tired.')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores a sentence submitted after stop', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])
    stream.submit('Too late.')

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('the ranked list', () => {
  it('sorts by profundity descending', async () => {
    fetch
      .mockResolvedValueOnce(claudeReply('You are tired.', 4))
      .mockResolvedValueOnce(claudeReply('You are curious.', 9))
      .mockResolvedValueOnce(claudeReply('You are hungry.', 6))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['I am tired.', 'I am curious.', 'I am hungry.'])

    expect(scores(stream.getReflections())).toEqual([9, 6, 4])
  })

  it('lets a late high scorer jump to the top', async () => {
    // §6, and the design rather than a bug: the list is re-read before every clip
    // during playback, so a straggler competes at its true rank.
    fetch
      .mockResolvedValueOnce(claudeReply('You are tired.', 8))
      .mockResolvedValueOnce(claudeReply('You are curious.', 3))
      .mockResolvedValueOnce(claudeReply('You are afraid.', 10))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['I am tired.', 'I am curious.', 'I am afraid.'])

    expect(scores(stream.getReflections())).toEqual([10, 8, 3])
    expect(indices(stream.getReflections())).toEqual([2, 0, 1])
  })

  it('keeps insertion order among equal scores', async () => {
    // `>=` in the walk, so an equal-scoring newcomer lands BELOW the incumbent
    // and the sentence spoken first stays higher.
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['One.', 'Two.', 'Three.'])

    expect(indices(stream.getReflections())).toEqual([0, 1, 2])
  })

  it('numbers sentences in the order they were submitted', async () => {
    fetch
      .mockResolvedValueOnce(claudeReply('You are tired.', 1))
      .mockResolvedValueOnce(claudeReply('You are curious.', 9))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['I am tired.', 'I am curious.'])

    expect(stream.getReflections().find((e) => e.index === 0).original).toBe('I am tired.')
    expect(stream.getReflections().find((e) => e.index === 1).original).toBe('I am curious.')
  })

  it('ranks the audio list the same way', async () => {
    fetch
      .mockResolvedValueOnce(claudeReply('You are tired.', 4))
      .mockResolvedValueOnce(claudeReply('You are afraid.', 10))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await runThrough(stream, ['I am tired.', 'I am afraid.'])

    expect(scores(stream.getAudioReflections())).toEqual([10, 4])
  })

  it('shares entries between the two lists', async () => {
    // Same object, not a copy — so a clip landing is visible through either.
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getAudioReflections()[0]).toBe(stream.getReflections()[0])
  })
})

describe('the TTS stage', () => {
  it('renders each reflection and attaches the clip', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const synthesize = workingSynth()
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })

    await runThrough(stream, ['I am tired.'])

    expect(synthesize).toHaveBeenCalledWith('You are tired.')
    expect(stream.getAudioReflections()[0].audio.url).toMatch(/^blob:aporius\//)
  })

  it('keeps exactly one render in flight at a time', async () => {
    let live = 0
    let peak = 0
    const synthesize = vi.fn(async (text) => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 1))
      live--
      return { blob: new Blob([text]), url: URL.createObjectURL(new Blob([text])) }
    })

    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })
    await runThrough(stream, ['One.', 'Two.', 'Three.'])

    expect(peak).toBe(1)
  })

  it('leaves a failed render out of the audio list but keeps the reflection', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const synthesize = vi.fn().mockRejectedValue(new Error('ElevenLabs down'))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()).toHaveLength(1)
    expect(stream.getAudioReflections()).toEqual([])
  })

  it('keeps rendering after one failure', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const synthesize = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockImplementation(async (text) => ({ blob: new Blob([text]), url: URL.createObjectURL(new Blob([text])) }))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })
    await runThrough(stream, ['One.', 'Two.'])

    expect(stream.getReflections()).toHaveLength(2)
    expect(stream.getAudioReflections()).toHaveLength(1)
  })

  it('skips the render stage entirely when no synthesizer was injected', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x' })

    await runThrough(stream, ['I am tired.'])

    expect(stream.getReflections()).toHaveLength(1)
    expect(stream.getAudioReflections()).toEqual([])
  })
})

describe('timeouts', () => {
  it('abandons a Claude call that overruns and falls back', async () => {
    vi.useFakeTimers()
    // Honour the abort signal, the way a real fetch does.
    fetch.mockImplementation(
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    )

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    stream.start()
    stream.submit('I am tired.')

    await vi.advanceTimersByTimeAsync(3000)
    const done = stream.stop()
    await vi.advanceTimersByTimeAsync(0)
    await done

    expect(stream.getReflections()[0]).toMatchObject({ reflected: 'I am tired.', profundity: 1 })
  })

  it('does not let a slow call block the sentence behind it', async () => {
    vi.useFakeTimers()
    let calls = 0
    fetch.mockImplementation((url, init) => {
      if (++calls === 1) {
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        })
      }
      return Promise.resolve(claudeReply('You are curious.', 9))
    })

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    stream.start()
    stream.submit('I am tired.')
    stream.submit('I am curious.')

    await vi.advanceTimersByTimeAsync(3000)
    const done = stream.stop()
    await vi.advanceTimersByTimeAsync(0)
    await done

    expect(stream.getReflections()).toHaveLength(2)
    expect(scores(stream.getReflections())).toEqual([9, 1])
  })

  it('abandons a hung render rather than wedging the queue', async () => {
    vi.useFakeTimers()
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const synthesize = vi.fn(() => new Promise(() => {}))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })
    stream.start()
    stream.submit('I am tired.')

    await vi.advanceTimersByTimeAsync(10000)
    const done = stream.stop()
    await vi.advanceTimersByTimeAsync(0)
    await done

    expect(stream.getReflections()).toHaveLength(1)
    expect(stream.getAudioReflections()).toEqual([])
  })

  it('revokes the clip of an abandoned render when it eventually lands', async () => {
    // The render is still running out there; when it finishes, nobody is left to
    // own its object URL, so it is handed straight back.
    vi.useFakeTimers()
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))

    let land
    const synthesize = vi.fn(() => new Promise((r) => { land = r }))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })

    stream.start()
    stream.submit('I am tired.')
    await vi.advanceTimersByTimeAsync(10000)

    land({ blob: new Blob(['late']), url: 'blob:abandoned' })
    await vi.advanceTimersByTimeAsync(0)

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:abandoned')
  })
})

describe('waitForAudio', () => {
  it('resolves true when a clip lands', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    stream.start()
    const waiting = stream.waitForAudio()
    stream.submit('I am tired.')

    await expect(waiting).resolves.toBe(true)
  })

  it('resolves false once both stages have drained with nothing to show', async () => {
    // The only way a caller learns no clip is ever coming.
    fetch.mockResolvedValue(claudeReply('', 5)) // filler, dropped before TTS
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    stream.start()
    const waiting = stream.waitForAudio()
    stream.submit('Um.')
    await stream.stop()

    await expect(waiting).resolves.toBe(false)
  })

  it('resolves false immediately when the stream was never started', async () => {
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await expect(stream.waitForAudio()).resolves.toBe(false)
  })

  it('wakes every parked waiter at once', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    stream.start()
    const waiters = [stream.waitForAudio(), stream.waitForAudio(), stream.waitForAudio()]
    stream.submit('I am tired.')

    await expect(Promise.all(waiters)).resolves.toEqual([true, true, true])
  })

  it('does not let a waiter outlive the turn it belongs to', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    stream.start()
    const waiting = stream.waitForAudio()
    stream.start() // a new turn begins

    await expect(waiting).resolves.toBe(false)
  })
})

describe('stop', () => {
  it('waits for both stages, not just the Claude one', async () => {
    // A reflection whose audio is still rendering is not done.
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    let land
    const synthesize = vi.fn(() => new Promise((r) => { land = r }))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize })
    stream.start()
    stream.submit('I am tired.')
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalled())

    let settled = false
    const stopped = stream.stop().then((v) => { settled = true; return v })

    await Promise.resolve()
    expect(settled).toBe(false)

    land({ blob: new Blob(['x']), url: URL.createObjectURL(new Blob(['x'])) })
    await expect(stopped).resolves.toHaveLength(1)
  })

  it('resolves with the ranked audio list', async () => {
    fetch
      .mockResolvedValueOnce(claudeReply('You are tired.', 2))
      .mockResolvedValueOnce(claudeReply('You are afraid.', 9))

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    const withAudio = await runThrough(stream, ['I am tired.', 'I am afraid.'])

    expect(scores(withAudio)).toEqual([9, 2])
  })

  it('resolves immediately when nothing is in flight', async () => {
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    stream.start()
    await expect(stream.stop()).resolves.toEqual([])
  })

  it('resolves when the stream was never started', async () => {
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    await expect(stream.stop()).resolves.toEqual([])
  })

  it('is safe to call twice', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['I am tired.'])
    await expect(stream.stop()).resolves.toHaveLength(1)
  })
})

describe('start', () => {
  it('clears both lists so turns stay index-aligned', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['First turn.'])
    expect(stream.getReflections()).toHaveLength(1)

    stream.start()
    expect(stream.getReflections()).toEqual([])
    expect(stream.getAudioReflections()).toEqual([])
  })

  it('restarts numbering from zero', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['First turn.'])
    await runThrough(stream, ['Second turn.'])

    expect(stream.getReflections()[0].index).toBe(0)
  })

  it('hands back the previous turn clips', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['First turn.'])
    const url = stream.getAudioReflections()[0].audio.url

    stream.start()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })
})

describe('release', () => {
  it('frees every rendered clip', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    await runThrough(stream, ['One.', 'Two.', 'Three.'])
    const urls = stream.getAudioReflections().map((e) => e.audio.url)
    expect(urls).toHaveLength(3)

    stream.release()

    for (const url of urls) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    expect(stream.getAudioReflections()).toEqual([])
  })

  it('unblocks anything still waiting on a clip', async () => {
    // Unmount while playback is parked on waitForAudio: without this, the
    // promise never settles and the caller hangs forever.
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })

    stream.start()
    const waiting = stream.waitForAudio()
    stream.release()

    await expect(waiting).resolves.toBe(false)
  })

  it('is safe to call on a stream that never ran', () => {
    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth() })
    expect(() => stream.release()).not.toThrow()
  })
})

describe('consumers', () => {
  it('announces each reflection and each clip', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const onReflected = vi.fn()
    const onAudioReady = vi.fn()

    const stream = createReflectionStream({
      apiKey: 'sk-x',
      synthesize: workingSynth(),
      onReflected,
      onAudioReady,
    })
    await runThrough(stream, ['I am tired.'])

    expect(onReflected).toHaveBeenCalledWith(expect.objectContaining({ reflected: 'You are tired.' }))
    expect(onAudioReady).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.any(Object) }))
  })

  it('survives a consumer that throws on every reflection', async () => {
    // A throwing consumer must not corrupt the list or stall the queue.
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const onReflected = vi.fn(() => { throw new Error('consumer blew up') })

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth(), onReflected })
    await runThrough(stream, ['One.', 'Two.'])

    expect(stream.getReflections()).toHaveLength(2)
    expect(stream.getAudioReflections()).toHaveLength(2)
  })

  it('survives a consumer that throws on every clip', async () => {
    fetch.mockResolvedValue(claudeReply('You are tired.', 5))
    const onAudioReady = vi.fn(() => { throw new Error('consumer blew up') })

    const stream = createReflectionStream({ apiKey: 'sk-x', synthesize: workingSynth(), onAudioReady })
    await runThrough(stream, ['One.', 'Two.'])

    expect(stream.getAudioReflections()).toHaveLength(2)
  })
})
