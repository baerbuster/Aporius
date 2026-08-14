import { describe, it, expect, beforeEach, vi } from 'vitest'
import { REFLECTION_VOICE } from './elevenlabs'

// The pool is a module-level singleton on purpose — MainScreen unmounts on every
// trip to settings or history, and a component-scoped cache would re-render all
// eight clips each time. That makes a fresh import per test mandatory.
let prime, next, release

beforeEach(async () => {
  vi.resetModules()
  ;({ prime, next, release } = await import('./thinkingSounds'))
})

const workingSynth = () =>
  vi.fn(async (text) => ({ blob: new Blob([text]), url: URL.createObjectURL(new Blob([text])) }))

describe('prime', () => {
  it('renders the whole pool', async () => {
    const synthesize = workingSynth()
    const clips = await prime({ synthesize })

    expect(clips).toHaveLength(8)
    expect(synthesize).toHaveBeenCalledTimes(8)
  })

  it('renders every clip in the murmuring voice', async () => {
    // Shared with the reflected sentences, so the whole reflection phase sounds
    // like one continuous act of thinking rather than two different voices.
    const synthesize = workingSynth()
    await prime({ synthesize })

    // Compared by value, not identity: resetModules gives thinkingSounds its own
    // copy of the elevenlabs module, so its REFLECTION_VOICE is a different
    // object from the one imported at the top of this file.
    for (const call of synthesize.mock.calls) {
      expect(call[1]).toEqual(REFLECTION_VOICE)
    }
  })

  it('renders serially, so the first clip is usable long before the last', async () => {
    let live = 0
    let peak = 0
    const synthesize = vi.fn(async (text) => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 1))
      live--
      return { blob: new Blob([text]), url: URL.createObjectURL(new Blob([text])) }
    })

    await prime({ synthesize })
    expect(peak).toBe(1)
  })

  it('makes the first clip available before the pool finishes', async () => {
    // The user can press the button before priming is done; an opener has to be
    // there anyway.
    let release1
    const synthesize = vi
      .fn()
      .mockImplementationOnce(async () => ({ blob: new Blob(['a']), url: 'blob:first' }))
      .mockImplementationOnce(() => new Promise((r) => { release1 = r }))

    prime({ synthesize })
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2))

    expect(next()).toBe('blob:first')
    release1({ blob: new Blob(['b']), url: 'blob:second' })
  })

  it('renders nothing a second time', async () => {
    const synthesize = workingSynth()
    await prime({ synthesize })
    await prime({ synthesize })

    expect(synthesize).toHaveBeenCalledTimes(8)
  })

  it('returns the same promise to a caller that arrives mid-render', async () => {
    const synthesize = workingSynth()
    const first = prime({ synthesize })
    const second = prime({ synthesize })

    expect(second).toBe(first)
    await first
  })

  it('resolves empty when no synthesizer is supplied', async () => {
    await expect(prime()).resolves.toEqual([])
  })

  it('leaves a phrase that failed to render out of the rotation', async () => {
    // One bad render costs one phrase, not the pool.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const synthesize = vi
      .fn()
      .mockRejectedValueOnce(new Error('quota'))
      .mockImplementation(async (text) => ({ blob: new Blob([text]), url: URL.createObjectURL(new Blob([text])) }))

    const clips = await prime({ synthesize })
    expect(clips).toHaveLength(7)
  })

  it('survives every render failing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const synthesize = vi.fn().mockRejectedValue(new Error('down'))

    await expect(prime({ synthesize })).resolves.toEqual([])
    expect(next()).toBeNull()
  })
})

describe('next', () => {
  it('returns null before anything has rendered', () => {
    expect(next()).toBeNull()
  })

  it('walks the whole pool before repeating any clip', async () => {
    await prime({ synthesize: workingSynth() })

    const firstPass = Array.from({ length: 8 }, next)
    expect(new Set(firstPass).size).toBe(8)
  })

  it('cycles rather than running dry', async () => {
    await prime({ synthesize: workingSynth() })

    const drawn = Array.from({ length: 24 }, next)
    expect(drawn.every(Boolean)).toBe(true)
  })

  it('never plays the same phrase twice in a row across a reshuffle', async () => {
    // The reshuffle rejects any order that would open on the clip just played —
    // "...Hmmm... ...Hmmm..." back to back sounds like a stutter, not thinking.
    await prime({ synthesize: workingSynth() })

    const drawn = Array.from({ length: 40 }, next)
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]).not.toBe(drawn[i - 1])
    }
  })

  it('repeats the only clip it has, rather than returning null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const synthesize = vi
      .fn()
      .mockImplementationOnce(async () => ({ blob: new Blob(['a']), url: 'blob:only' }))
      .mockRejectedValue(new Error('down'))

    await prime({ synthesize })
    expect([next(), next(), next()]).toEqual(['blob:only', 'blob:only', 'blob:only'])
  })
})

describe('release', () => {
  it('hands every clip back and empties the pool', async () => {
    const synthesize = workingSynth()
    const clips = await prime({ synthesize })
    const urls = clips.map((c) => c.url)

    release()

    for (const url of urls) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    expect(next()).toBeNull()
  })

  it('allows a fresh prime afterwards', async () => {
    const synthesize = workingSynth()
    await prime({ synthesize })
    release()
    await prime({ synthesize })

    expect(synthesize).toHaveBeenCalledTimes(16)
  })
})
