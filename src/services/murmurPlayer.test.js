import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fakeAudioContext } from '../../test/setup'

// Swap in a variant of the audio graph. A plain `function`, not an arrow — the
// app constructs it with `new`.
const useAudioContext = (overrides) => {
  window.AudioContext = vi.fn(function () {
    return fakeAudioContext(overrides)
  })
}

// The AudioContext is a module-level singleton created lazily on the first clip,
// so each test re-imports to get a clean one.
let playMurmur

// jsdom's Audio cannot play anything, and nothing fires `onended` on its own.
// This stands in so a test can decide exactly when a clip finishes.
class FakeAudio {
  static instances = []

  constructor(src) {
    this.src = src
    this.volume = 1
    FakeAudio.instances.push(this)
  }

  play() {
    this.played = true
    return this.playRejects ? Promise.reject(new Error('blocked')) : Promise.resolve()
  }

  end() {
    this.onended?.()
  }

  fail() {
    this.onerror?.()
  }
}

const audio = () => FakeAudio.instances.at(-1)

beforeEach(async () => {
  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
  vi.resetModules()
  ;({ playMurmur } = await import('./murmurPlayer'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('playMurmur', () => {
  it('resolves when the clip ends', async () => {
    const playing = playMurmur('blob:clip')
    audio().end()
    await expect(playing).resolves.toBeUndefined()
  })

  it('plays slowed down without dropping the pitch', async () => {
    // preservesPitch is the difference between "slower" and "a demon". The two
    // vendor spellings are still needed on Safari and older Firefox.
    const playing = playMurmur('blob:clip')

    expect(audio().playbackRate).toBe(0.85)
    expect(audio().preservesPitch).toBe(true)
    expect(audio().mozPreservesPitch).toBe(true)
    expect(audio().webkitPreservesPitch).toBe(true)

    audio().end()
    await playing
  })

  it('routes through gain and panner rather than the element volume', async () => {
    // An element routed into an AudioContext stops honouring its own `volume`,
    // so level has to move to the gain node.
    const playing = playMurmur('blob:clip')
    const ctx = window.AudioContext.mock.results[0].value

    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(audio())
    expect(ctx.createGain.mock.results[0].value.gain.value).toBe(0.9)
    expect(ctx.createStereoPanner).toHaveBeenCalled()

    audio().end()
    await playing
  })

  it('scatters clips across the stereo field', async () => {
    const playing = playMurmur('blob:clip')
    const ctx = window.AudioContext.mock.results[0].value
    const pan = ctx.createStereoPanner.mock.results[0].value.pan.value

    expect(Math.abs(pan)).toBeLessThanOrEqual(0.35)

    audio().end()
    await playing
  })

  it('reuses one AudioContext for the app lifetime', async () => {
    const first = playMurmur('blob:one')
    audio().end()
    await first

    const second = playMurmur('blob:two')
    audio().end()
    await second

    expect(window.AudioContext).toHaveBeenCalledTimes(1)
  })

  it('resumes a context the browser suspended', async () => {
    useAudioContext({ state: 'suspended' })

    const playing = playMurmur('blob:clip')
    expect(window.AudioContext.mock.results[0].value.resume).toHaveBeenCalled()

    audio().end()
    await playing
  })

  it('unwinds the graph once the clip is done', async () => {
    const playing = playMurmur('blob:clip')
    const ctx = window.AudioContext.mock.results[0].value
    const gain = ctx.createGain.mock.results[0].value

    expect(gain.disconnect).not.toHaveBeenCalled()
    audio().end()
    await playing

    expect(gain.disconnect).toHaveBeenCalled()
  })

  it('plays dry when the browser has no stereo panner', async () => {
    // Missing on some older WebKit builds — the chain skips that link rather
    // than falling over.
    useAudioContext({ createStereoPanner: undefined })

    const playing = playMurmur('blob:clip')
    expect(audio().played).toBe(true)

    audio().end()
    await expect(playing).resolves.toBeUndefined()
  })

  it('plays dry when there is no Web Audio at all', async () => {
    delete window.AudioContext
    delete window.webkitAudioContext

    const playing = playMurmur('blob:clip')
    expect(audio().volume).toBe(0.9)

    audio().end()
    await expect(playing).resolves.toBeUndefined()
  })

  it('plays dry when wiring the graph throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useAudioContext({
      createMediaElementSource: () => {
        throw new Error('already connected')
      },
    })

    const playing = playMurmur('blob:clip')
    expect(audio().volume).toBe(0.9)

    audio().end()
    await expect(playing).resolves.toBeUndefined()
  })

  it('resolves when the clip errors, rather than hanging the turn', async () => {
    // Every caller awaits this. A clip that never resolves would freeze playback
    // mid-turn with no error anywhere.
    const playing = playMurmur('blob:clip')
    audio().fail()
    await expect(playing).resolves.toBeUndefined()
  })

  it('resolves when playback is refused outright', async () => {
    FakeAudio.prototype.playRejects = true
    try {
      await expect(playMurmur('blob:clip')).resolves.toBeUndefined()
    } finally {
      delete FakeAudio.prototype.playRejects
    }
  })
})
