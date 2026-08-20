import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import MainScreen from './MainScreen'

import { useAudioCapture } from '../../hooks/useAudioCapture'
import { useConversation } from '../../hooks/useConversation'
import { sendToClaude } from '../../services/claude'
import { sendToGroq } from '../../services/groq'
import { synthesizeWithElevenLabs, ElevenLabsQuotaError } from '../../services/elevenlabs'
import {
  synthesizeWithGoogle,
  base64ToAudioBlob,
  speakWithBrowserTTS,
} from '../../services/googleTTS'
import { createLiveSentenceStream } from '../../services/deepgram'
import { createReflectionStream } from '../../services/reflectionStream'
import { prime as primeThinkingSounds, next as nextThinkingSound } from '../../services/thinkingSounds'
import { playReflection } from '../../services/reflectionPlayer'

// Layer 4 — the turn flow, with every collaborator faked.
//
// This is the layer that can only be tested here: the ordering, the reflections-vs-
// Claude race, and the TTS fallback chain are all decisions MainScreen makes, and
// none of them live in a module that can be imported on its own.
//
// What it still cannot catch: whether a "hmmm" lands in a natural place, whether
// the pause feels like thinking, whether the reply is any good. That stays a
// listening judgement, and a green run here is not a working app.

vi.mock('../../hooks/useAudioCapture', () => ({ useAudioCapture: vi.fn() }))
vi.mock('../../hooks/useConversation', () => ({ useConversation: vi.fn() }))
vi.mock('../../services/claude', () => ({ sendToClaude: vi.fn() }))
vi.mock('../../services/groq', () => ({ sendToGroq: vi.fn() }))
vi.mock('../../services/deepgram', () => ({ createLiveSentenceStream: vi.fn() }))
vi.mock('../../services/reflectionStream', () => ({ createReflectionStream: vi.fn() }))
vi.mock('../../services/thinkingSounds', () => ({ prime: vi.fn(), next: vi.fn() }))
vi.mock('../../services/reflectionPlayer', () => ({ playReflection: vi.fn() }))
vi.mock('../../services/googleTTS', () => ({
  synthesizeWithGoogle: vi.fn(),
  base64ToAudioBlob: vi.fn(),
  speakWithBrowserTTS: vi.fn(),
}))
// ElevenLabsQuotaError and REFLECTION_VOICE are real — MainScreen branches on the
// error type, so a stand-in class would make the fallback test prove nothing.
vi.mock('../../services/elevenlabs', async (importOriginal) => ({
  ...(await importOriginal()),
  synthesizeWithElevenLabs: vi.fn(),
}))

// ── Test doubles ──────────────────────────────────────────

class FakeAudio {
  static instances = []
  constructor(src) {
    this.src = src
    FakeAudio.instances.push(this)
  }
  play() {
    this.played = true
    return this.playRejects ? Promise.reject(new Error('blocked')) : Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  end() {
    return act(async () => { await this.onended?.() })
  }
  fail() {
    return act(async () => { await this.onerror?.() })
  }
}

const lastAudio = () => FakeAudio.instances.at(-1)

const clip = (index, profundity, reflected = `Reflection ${index}.`) => ({
  index,
  original: `Sentence ${index}.`,
  reflected,
  profundity,
  audio: { url: `blob:clip-${index}` },
})

function fakeReflectionStream(initial = []) {
  let audio = [...initial]
  let waiters = []
  return {
    start: vi.fn(),
    submit: vi.fn(),
    stop: vi.fn(async () => audio),
    getReflections: vi.fn(() => audio),
    getAudioReflections: vi.fn(() => audio),
    // Defaults to "nothing more is coming", so a test that says nothing about
    // clips runs straight through instead of parking forever.
    waitForAudio: vi.fn(() => new Promise((r) => waiters.push(r))),
    setThreshold: vi.fn(),
    release: vi.fn(),
    _land(entry) {
      audio.push(entry)
      waiters.splice(0).forEach((w) => w(true))
    },
    _drain() {
      waiters.splice(0).forEach((w) => w(false))
    },
  }
}

function fakeLiveStream() {
  return {
    start: vi.fn(async () => true),
    stop: vi.fn(async () => []),
    sendAudio: vi.fn(),
    getSentences: vi.fn(() => []),
  }
}

const settings = {
  name: 'Buster',
  claudeKey: 'sk-claude',
  groqKey: 'gsk',
  deepgramKey: 'dg',
  elevenLabsKey: 'xi',
  googleTTSKey: 'g-key',
}

let reflection
let live
let capture
let conversation

// Mount and wait for the mic to come up, which is where every turn test starts.
async function mount(overrides = {}) {
  const view = render(<MainScreen settings={{ ...settings, ...overrides }} />)
  await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
  return view
}

const speak = () => fireEvent.click(screen.getByRole('button', { name: 'SPEAK, APORIUS!' }))
const listen = () => fireEvent.click(screen.getByRole('button', { name: 'LISTEN, APORIUS!' }))

const statue = () => document.querySelector('.main-screen__statue').getAttribute('src')

// Every mocked module export, reset by hand before each test. `restoreMocks`
// only covers spies — the vi.fn()s inside a vi.mock factory are module-level and
// would otherwise carry their call history from one test into the next, which
// makes every "was not called" assertion meaningless.
const moduleMocks = [
  useAudioCapture,
  useConversation,
  sendToClaude,
  sendToGroq,
  synthesizeWithElevenLabs,
  synthesizeWithGoogle,
  base64ToAudioBlob,
  speakWithBrowserTTS,
  createLiveSentenceStream,
  createReflectionStream,
  primeThinkingSounds,
  nextThinkingSound,
  playReflection,
]

// Hand playReflection back one clip at a time. Playback and the Claude call race each
// other by design, so a test that needs a specific interleaving has to drive the
// clock rather than hope for it.
function gatePlayback() {
  const pending = []
  playReflection.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
  return {
    // Wait for the nth playReflection call to have started, then let it finish.
    async release(n) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(n))
      await act(async () => { pending[n]() })
    },
    get count() {
      return playReflection.mock.calls.length
    },
  }
}

beforeEach(() => {
  for (const mock of moduleMocks) mock.mockReset()

  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  reflection = fakeReflectionStream()
  live = fakeLiveStream()
  createReflectionStream.mockReturnValue(reflection)
  createLiveSentenceStream.mockReturnValue(live)

  capture = {
    startCapture: vi.fn(async () => {}),
    stopCaptureAndGetTranscript: vi.fn(async () => 'What is virtue?'),
    cleanup: vi.fn(async () => {}),
  }
  useAudioCapture.mockReturnValue(capture)

  conversation = {
    addTurn: vi.fn(),
    checkAndSummarize: vi.fn(async () => {}),
    refresh: vi.fn(),
  }
  useConversation.mockReturnValue(conversation)

  primeThinkingSounds.mockResolvedValue([])
  nextThinkingSound.mockReturnValue(null)
  playReflection.mockResolvedValue(undefined)

  sendToClaude.mockResolvedValue('Virtue is a habit.')
  sendToGroq.mockResolvedValue('Virtue is a habit, said the llama.')
  synthesizeWithElevenLabs.mockResolvedValue(new Blob(['mp3']))
  synthesizeWithGoogle.mockResolvedValue('YWJj')
  base64ToAudioBlob.mockReturnValue(new Blob(['mp3']))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ── Mount ─────────────────────────────────────────────────

describe('on mount', () => {
  it('opens the socket and the mic, then waits for the user', async () => {
    await mount()

    expect(live.start).toHaveBeenCalled()
    expect(capture.startCapture).toHaveBeenCalled()
    expect(conversation.refresh).toHaveBeenCalled()
    expect(statue()).toBe('/listener.png')
  })

  it('starts the reflection stream alongside the socket', async () => {
    // The two lists must reset together or they stop being index-aligned.
    await mount()
    expect(reflection.start).toHaveBeenCalled()
  })

  it('renders the thinking sounds once, in the background', async () => {
    // Already rendered is what keeps a turn from ever starting silent.
    await mount()
    expect(primeThinkingSounds).toHaveBeenCalledWith({ synthesize: expect.any(Function) })
  })

  it('builds the reflection stream with the key and the name', async () => {
    await mount()
    expect(createReflectionStream).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-claude', userName: 'Buster' }),
    )
  })

  it('wires Deepgram sentences straight into the reflection stream', async () => {
    await mount()
    const { onSentence } = createLiveSentenceStream.mock.calls[0][0]

    onSentence('I am tired.')

    expect(reflection.submit).toHaveBeenCalledWith('I am tired.')
  })

  it('reports a mic that will not open, out loud', async () => {
    capture.startCapture.mockRejectedValue(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
    )

    render(<MainScreen settings={settings} />)

    const message = await screen.findByText(/change your mic permissions/)
    expect(message).toHaveTextContent('NotAllowedError')
    expect(speakWithBrowserTTS).toHaveBeenCalled()
    expect(statue()).toBe('/thinker.png')
  })

  it('offers no tap-to-return on a mic error, because tapping cannot fix it', async () => {
    capture.startCapture.mockRejectedValue(new Error('nope'))
    render(<MainScreen settings={settings} />)

    await screen.findByText(/change your mic permissions/)
    expect(screen.queryByText('Tap to return')).not.toBeInTheDocument()
  })
})

describe('on unmount', () => {
  it('hands back the mic, the socket and every clip', async () => {
    const { unmount } = await mount()
    unmount()

    expect(live.stop).toHaveBeenCalled()
    expect(reflection.release).toHaveBeenCalled()
    expect(capture.cleanup).toHaveBeenCalled()
  })
})

// ── The turn ──────────────────────────────────────────────

describe('a complete turn', () => {
  it('runs stop-mic, transcribe, think, speak, in that order', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))

    expect(live.stop).toHaveBeenCalled()
    expect(capture.stopCaptureAndGetTranscript).toHaveBeenCalled()
    expect(sendToClaude).toHaveBeenCalled()
    expect(synthesizeWithElevenLabs).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Virtue is a habit.' }),
    )
  })

  it('sends the transcript with the stored history and summary', async () => {
    localStorage.setItem(
      'aporius_messages',
      JSON.stringify([{ role: 'user', content: 'Earlier.' }]),
    )
    localStorage.setItem('aporius_summary', 'They dislike Kant.')

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(sendToClaude).toHaveBeenCalled())
    expect(sendToClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-claude',
        summary: 'They dislike Kant.',
        messages: [
          { role: 'user', content: 'Earlier.' },
          { role: 'user', content: 'What is virtue?' },
        ],
      }),
    )
  })

  it('saves the turn and checks whether it is time to summarize', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(conversation.addTurn).toHaveBeenCalled())
    expect(conversation.addTurn).toHaveBeenCalledWith('What is virtue?', 'Virtue is a habit.')
    expect(conversation.checkAndSummarize).toHaveBeenCalledWith({
      apiKey: 'sk-claude',
      model: 'claude-sonnet-4-6',
    })
  })

  it('goes back to listening once the reply has finished playing', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    expect(screen.getByRole('button', { name: 'LISTEN, APORIUS!' })).toBeInTheDocument()

    await lastAudio().end()

    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
    expect(capture.startCapture).toHaveBeenCalledTimes(2)
    expect(reflection.start).toHaveBeenCalledTimes(2)
  })

  it('shows the thinker while it thinks and the exclaimer while it speaks', async () => {
    let release
    sendToClaude.mockReturnValue(new Promise((r) => { release = r }))

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(statue()).toBe('/thinker.png'))

    await act(async () => { release('Virtue is a habit.') })
    await waitFor(() => expect(statue()).toBe('/exclaimer.png'))
  })

  it('falls back to the browser voice when the clip will not play', async () => {
    FakeAudio.prototype.playRejects = true
    try {
      await mount()
      reflection._drain()
      speak()

      await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
        'Virtue is a habit.',
        expect.any(Function),
      ))
    } finally {
      delete FakeAudio.prototype.playRejects
    }
  })

  it('recovers when playback errors midway', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    await lastAudio().fail()

    expect(await screen.findByText(/frog in his throat/)).toBeInTheDocument()
    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
  })
})

// ── Routing ───────────────────────────────────────────────

describe('model routing', () => {
  it('defaults to Opus on the Claude route', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(sendToClaude).toHaveBeenCalled())
    expect(sendToClaude).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' }),
    )
    expect(sendToGroq).not.toHaveBeenCalled()
  })

  it('routes a llama model to Groq instead', async () => {
    await mount({ model: 'llama-3.3-70b-versatile' })
    reflection._drain()
    speak()

    await waitFor(() => expect(sendToGroq).toHaveBeenCalled())
    expect(sendToGroq).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'gsk', model: 'llama-3.3-70b-versatile' }),
    )
    expect(sendToClaude).not.toHaveBeenCalled()
  })

  it('keeps a non-llama model on the Claude route', async () => {
    await mount({ model: 'claude-haiku-4-5' })
    reflection._drain()
    speak()

    await waitFor(() => expect(sendToClaude).toHaveBeenCalled())
    expect(sendToClaude).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5' }),
    )
  })
})

// ── The reflections, and their race against Claude ────────────

describe('the reflection playback', () => {
  it('always opens with a thinking sound', async () => {
    // It runs before the first list read, covering exactly the window where
    // nothing has rendered yet — the reason a short utterance used to start in
    // silence.
    nextThinkingSound.mockReturnValue('blob:hmm')

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:hmm'))
  })

  it('plays the ranked clips while Claude is still thinking', async () => {
    let release
    sendToClaude.mockReturnValue(new Promise((r) => { release = r }))
    reflection = fakeReflectionStream([clip(0, 9), clip(1, 8)])
    createReflectionStream.mockReturnValue(reflection)

    await mount()
    speak()

    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-0'))
    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-1'))

    await act(async () => { release('Virtue is a habit.') })
  })

  it('stops pulling clips once Claude has answered', async () => {
    // The first clip always plays; beyond that the loop only continues while
    // Claude is still out. Driven clip by clip, because otherwise the loop and
    // the Claude call are genuinely racing and the result is a coin toss.
    let release
    sendToClaude.mockReturnValue(new Promise((r) => { release = r }))
    nextThinkingSound.mockReturnValue('blob:hmm')
    reflection = fakeReflectionStream([clip(0, 9), clip(1, 8), clip(2, 7)])
    createReflectionStream.mockReturnValue(reflection)
    const gate = gatePlayback()

    await mount()
    speak()

    await gate.release(0) // the opener
    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-0'))

    // Claude lands while the first clip is still playing.
    await act(async () => { release('Virtue is a habit.') })
    await gate.release(1)

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    expect(playReflection).not.toHaveBeenCalledWith('blob:clip-1')
    expect(playReflection).not.toHaveBeenCalledWith('blob:clip-2')
  })

  it('drops a beat of thought when the profundity swings hard', async () => {
    // A fall from something weighty to something mundane gets a pause instead of
    // a hard cut. The gap here is 9 → 2, well over the threshold of 1.
    let release
    sendToClaude.mockReturnValue(new Promise((r) => { release = r }))
    nextThinkingSound.mockReturnValue('blob:hmm')
    reflection = fakeReflectionStream([clip(0, 9), clip(1, 2)])
    createReflectionStream.mockReturnValue(reflection)

    await mount()
    speak()

    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-1'))

    const order = playReflection.mock.calls.map((c) => c[0])
    expect(order).toEqual(['blob:hmm', 'blob:clip-0', 'blob:hmm', 'blob:clip-1'])

    await act(async () => { release('Virtue is a habit.') })
  })

  it('runs two adjacent scores together with no pause between', async () => {
    let release
    sendToClaude.mockReturnValue(new Promise((r) => { release = r }))
    nextThinkingSound.mockReturnValue('blob:hmm')
    reflection = fakeReflectionStream([clip(0, 6), clip(1, 5)])
    createReflectionStream.mockReturnValue(reflection)

    await mount()
    speak()

    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-1'))

    const order = playReflection.mock.calls.map((c) => c[0])
    expect(order).toEqual(['blob:hmm', 'blob:clip-0', 'blob:clip-1'])

    await act(async () => { release('Virtue is a habit.') })
  })

  it('waits for a clip still rendering rather than giving up', async () => {
    // Empty right now does not mean empty for good.
    let release
    sendToClaude.mockReturnValue(new Promise((r) => { release = r }))

    await mount()
    speak()

    await waitFor(() => expect(reflection.waitForAudio).toHaveBeenCalled())
    expect(playReflection).not.toHaveBeenCalledWith('blob:clip-0')

    await act(async () => { reflection._land(clip(0, 7)) })
    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-0'))

    await act(async () => { release('Virtue is a habit.') })
  })

  it('does not hold up a finished reply for a clip that never lands', async () => {
    // waitForAudio is raced against Claude, so a stream that never drains cannot
    // wedge the turn.
    await mount()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    expect(playReflection).not.toHaveBeenCalledWith(expect.stringContaining('clip'))
  })

  it('lets the last clip finish before speaking over it', async () => {
    // Claude's render overlaps the tail reflection; the reply waits for it.
    let finishClip
    playReflection.mockReturnValue(new Promise((r) => { finishClip = r }))
    reflection = fakeReflectionStream([clip(0, 9)])
    createReflectionStream.mockReturnValue(reflection)

    await mount()
    speak()

    await waitFor(() => expect(playReflection).toHaveBeenCalledWith('blob:clip-0'))
    expect(lastAudio()?.played).toBeUndefined()

    await act(async () => { finishClip() })
    await waitFor(() => expect(lastAudio()?.played).toBe(true))
  })
})

// ── Interruption ──────────────────────────────────────────

describe('LISTEN, APORIUS!', () => {
  it('cuts the reply off and goes back to listening', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    const playing = lastAudio()

    await act(async () => { listen() })

    expect(playing.paused).toBe(true)
    expect(window.speechSynthesis.cancel).toHaveBeenCalled()
    expect(capture.cleanup).toHaveBeenCalled()
    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
  })

  it('revokes the clip it interrupted', async () => {
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    await act(async () => { listen() })

    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('abandons a turn interrupted while Claude was still thinking', async () => {
    sendToClaude.mockReturnValue(new Promise(() => {}))

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(sendToClaude).toHaveBeenCalled())
    await act(async () => { listen() })

    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
    expect(conversation.addTurn).not.toHaveBeenCalled()
  })

  it('clears a lingering error message', async () => {
    capture.stopCaptureAndGetTranscript.mockRejectedValue(new Error('no audio'))

    await mount()
    reflection._drain()
    speak()

    await screen.findByText(/didn't quite catch that/)
    await act(async () => { listen() })

    expect(screen.queryByText(/didn't quite catch that/)).not.toBeInTheDocument()
  })
})

// ── Nothing said ──────────────────────────────────────────

describe('when nothing was said', () => {
  it('goes straight back to listening on an empty transcript', async () => {
    capture.stopCaptureAndGetTranscript.mockResolvedValue('   ')

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(capture.startCapture).toHaveBeenCalledTimes(2))
    expect(sendToClaude).not.toHaveBeenCalled()
    expect(conversation.addTurn).not.toHaveBeenCalled()
  })
})

// ── Failure paths ─────────────────────────────────────────

describe('when transcription fails', () => {
  it('says so out loud and returns to listening on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    capture.stopCaptureAndGetTranscript.mockRejectedValue(new Error('Groq 500'))

    await mount()
    reflection._drain()
    speak()

    await screen.findByText(/didn't quite catch that/)
    expect(sendToClaude).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
  })

  it('offers a tap to return in the meantime', async () => {
    capture.stopCaptureAndGetTranscript.mockRejectedValue(new Error('Groq 500'))

    await mount()
    reflection._drain()
    speak()

    await screen.findByText('Tap to return')
  })
})

describe('when Claude fails', () => {
  it('retries three times before giving up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    sendToClaude.mockRejectedValue(new Error('529 overloaded'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(sendToClaude).toHaveBeenCalledTimes(3)
    await screen.findByText(/my brain is foggy/)
  })

  it('accepts a retry that succeeds and carries on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    sendToClaude
      .mockRejectedValueOnce(new Error('529 overloaded'))
      .mockResolvedValue('Virtue is a habit.')

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    await waitFor(() => expect(conversation.addTurn).toHaveBeenCalled())
    expect(sendToClaude).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/my brain is foggy/)).not.toBeInTheDocument()
  })

  it('saves nothing when every attempt fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    sendToClaude.mockRejectedValue(new Error('529 overloaded'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    await screen.findByText(/my brain is foggy/)
    expect(conversation.addTurn).not.toHaveBeenCalled()
  })
})

describe('the TTS fallback chain', () => {
  it('falls back to Google when the ElevenLabs quota runs dry', async () => {
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('quota'))

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(synthesizeWithGoogle).toHaveBeenCalledWith({
      apiKey: 'g-key',
      text: 'Virtue is a habit.',
    }))
    expect(base64ToAudioBlob).toHaveBeenCalledWith('YWJj')
    await waitFor(() => expect(lastAudio()?.played).toBe(true))
  })

  it('does not fall back on an error that is not a quota error', async () => {
    // A transient blip should be retried, not spent on the Google budget.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    synthesizeWithElevenLabs.mockRejectedValue(new Error('503'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(synthesizeWithGoogle).not.toHaveBeenCalled()
    expect(synthesizeWithElevenLabs).toHaveBeenCalledTimes(3)
  })

  it('drops to the browser voice when both services fail', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('quota'))
    synthesizeWithGoogle.mockRejectedValue(new Error('403'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
      'Virtue is a habit.',
      expect.any(Function),
    ))
    await screen.findByText(/frog in his throat/)
  })

  it('still saves the turn when it has to use the browser voice', async () => {
    // The words were said; losing them because the voice was ugly would be worse
    // than the ugly voice.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('quota'))
    synthesizeWithGoogle.mockRejectedValue(new Error('403'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    await waitFor(() => expect(conversation.addTurn).toHaveBeenCalledWith(
      'What is virtue?',
      'Virtue is a habit.',
    ))
  })
})

// ── The injected synthesizer ──────────────────────────────

describe('the synthesizer handed to the reflection stream', () => {
  // MainScreen's composite TTS is module-private, so it is reached the way the
  // reflection stream reaches it: through the injected callback.
  const injected = () => createReflectionStream.mock.calls[0][0].synthesize

  it('renders reflections through ElevenLabs in the reflection voice', async () => {
    await mount()
    await injected()('You are tired.')

    expect(synthesizeWithElevenLabs).toHaveBeenCalledWith({
      apiKey: 'xi',
      text: 'You are tired.',
      voiceSettings: { stability: 0.9, style: 0, similarity_boost: 0.4 },
    })
  })

  it('returns a blob and an object URL', async () => {
    await mount()
    const audio = await injected()('You are tired.')

    expect(audio.blob).toBeInstanceOf(Blob)
    expect(audio.url).toMatch(/^blob:aporius\//)
  })

  it('falls through to Google on a quota error', async () => {
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('quota'))

    await mount()
    const audio = await injected()('You are tired.')

    expect(synthesizeWithGoogle).toHaveBeenCalledWith({ apiKey: 'g-key', text: 'You are tired.' })
    expect(audio.url).toMatch(/^blob:aporius\//)
  })

  it('rethrows anything that is not a quota error', async () => {
    synthesizeWithElevenLabs.mockRejectedValue(new Error('503'))

    await mount()
    await expect(injected()('You are tired.')).rejects.toThrow('503')
    expect(synthesizeWithGoogle).not.toHaveBeenCalled()
  })
})

// ── Error overlay ─────────────────────────────────────────

describe('the error overlay', () => {
  it('returns to listening when tapped', async () => {
    capture.stopCaptureAndGetTranscript.mockRejectedValue(new Error('no audio'))

    await mount()
    reflection._drain()
    speak()

    const overlay = await screen.findByText(/didn't quite catch that/)
    await act(async () => { fireEvent.click(overlay) })

    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
    expect(screen.queryByText(/didn't quite catch that/)).not.toBeInTheDocument()
  })

  it('speaks the error through the browser when offline', async () => {
    // No point spending a network call to announce a network failure.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    capture.stopCaptureAndGetTranscript.mockRejectedValue(new Error('offline'))

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
      "I didn't quite catch that, could you repeat yourself?",
      expect.any(Function),
    ))
    expect(synthesizeWithElevenLabs).not.toHaveBeenCalled()
  })
})

// ── Hung calls ────────────────────────────────────────────

describe('when a call hangs rather than failing', () => {
  // withRetry races every attempt against a ceiling. Retrying on a *rejection* is
  // tested above; this is the other half — a call that never comes back at all,
  // which without the ceiling would strand the turn with no error and no way out.

  it('cuts off a Claude call that never returns', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    sendToClaude.mockReturnValue(new Promise(() => {}))

    await mount()
    reflection._drain()
    speak()

    // Three attempts at the 60s ceiling, with a second between each.
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60000 + 2 * 1000) })

    expect(sendToClaude).toHaveBeenCalledTimes(3)
    await screen.findByText(/my brain is foggy/)
  })

  it('gives up on the first attempt only after the full ceiling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    sendToClaude.mockReturnValue(new Promise(() => {}))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(59000) })
    expect(sendToClaude).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(sendToClaude).toHaveBeenCalledTimes(2)
  })

  it('cuts off a TTS render that never returns and falls back to the browser', async () => {
    // A shorter ceiling than Claude's — 15s, because the reply is already written
    // and the user is sitting in silence waiting to hear it.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    synthesizeWithElevenLabs.mockReturnValue(new Promise(() => {}))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 15000 + 2 * 1000) })

    expect(synthesizeWithElevenLabs).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
      'Virtue is a habit.',
      expect.any(Function),
    ))
  })
})

// ── The session guard ─────────────────────────────────────

describe('a turn that ends while Deepgram is still flushing', () => {
  it('does not stop the stream belonging to the turn that already started', async () => {
    // stopLive captures the session it was called for. Deepgram's flush is slow
    // enough that the user can press LISTEN and begin a new turn before it
    // finishes; without the guard, the late flush stops the NEW turn's reflection
    // stream and that turn goes silent for no visible reason.
    const flushes = []
    live.stop.mockImplementation(() => new Promise((resolve) => flushes.push(resolve)))

    await mount()
    reflection._drain()
    speak()
    await waitFor(() => expect(flushes).toHaveLength(1))

    // A new turn begins, bumping the session.
    await act(async () => { listen() })
    await waitFor(() => expect(flushes.length).toBeGreaterThan(1))

    const before = reflection.stop.mock.calls.length
    await act(async () => { flushes[0]() }) // the stale flush finally lands

    expect(reflection.stop).toHaveBeenCalledTimes(before)
  })

  it('does stop the stream when the session has not moved on', async () => {
    // The mirror of the guard: same code path, session unchanged, so the stop
    // goes through. Without this the test above would pass on a broken guard
    // that never stopped anything.
    const flushes = []
    live.stop.mockImplementation(() => new Promise((resolve) => flushes.push(resolve)))

    await mount()
    reflection._drain()
    speak()
    await waitFor(() => expect(flushes).toHaveLength(1))

    const before = reflection.stop.mock.calls.length
    await act(async () => { flushes[0]() })

    expect(reflection.stop).toHaveBeenCalledTimes(before + 1)
  })
})

// ── Audio fan-out ─────────────────────────────────────────

describe('the captured audio', () => {
  it('fans out to Deepgram as well as to the Whisper buffer', async () => {
    // The same 16kHz PCM feeds both paths. If this wiring breaks, the batch
    // transcript still works and only the reflections go silent — a failure with no
    // error attached to it.
    await mount()
    const { onAudioChunk, groqKey } = useAudioCapture.mock.calls.at(-1)[0]

    const chunk = new ArrayBuffer(8)
    onAudioChunk(chunk)

    expect(live.sendAudio).toHaveBeenCalledWith(chunk)
    expect(groqKey).toBe('gsk')
  })
})

// ── Spoken errors ─────────────────────────────────────────

describe('speaking an error aloud', () => {
  // The offline branch is covered above; this is the online one, where the error
  // gets the real voice rather than the browser's.
  const failTranscription = () =>
    capture.stopCaptureAndGetTranscript.mockRejectedValue(new Error('Groq 500'))

  it('uses the real voice when online', async () => {
    failTranscription()

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(synthesizeWithElevenLabs).toHaveBeenCalledWith(
      expect.objectContaining({ text: "I didn't quite catch that, could you repeat yourself?" }),
    ))
    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    expect(speakWithBrowserTTS).not.toHaveBeenCalled()
  })

  it('hands the clip back when it finishes', async () => {
    failTranscription()

    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))
    const spoken = lastAudio()
    await spoken.end()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(spoken.src)
  })

  it('drops to the browser voice when the error clip will not play', async () => {
    FakeAudio.prototype.playRejects = true
    try {
      failTranscription()

      await mount()
      reflection._drain()
      speak()

      await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
        "I didn't quite catch that, could you repeat yourself?",
        expect.any(Function),
      ))
    } finally {
      delete FakeAudio.prototype.playRejects
    }
  })

  it('drops to the browser voice when the error cannot be rendered at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    failTranscription()
    synthesizeWithElevenLabs.mockRejectedValue(new Error('503'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
      "I didn't quite catch that, could you repeat yourself?",
      expect.any(Function),
    ))
  })
})

// ── Getting back to listening after the browser voice ─────

describe('after the browser voice finishes', () => {
  // speakWithBrowserTTS is fire-and-forget: the only way back to listening is the
  // callback it is handed. If that callback is wrong the app sits on the thinking
  // screen forever, having just spoken a perfectly good reply.
  const browserOnEnd = () => speakWithBrowserTTS.mock.calls.at(-1)[1]

  it('returns to listening after a TTS failure was read aloud', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    synthesizeWithElevenLabs.mockRejectedValue(new ElevenLabsQuotaError('quota'))
    synthesizeWithGoogle.mockRejectedValue(new Error('403'))

    await mount()
    reflection._drain()
    speak()

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalled())
    await screen.findByText(/frog in his throat/)

    await act(async () => { await browserOnEnd()() })

    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
    expect(screen.queryByText(/frog in his throat/)).not.toBeInTheDocument()
    expect(capture.startCapture).toHaveBeenCalledTimes(2)
  })

  it('returns to listening after a refused clip was read aloud', async () => {
    FakeAudio.prototype.playRejects = true
    try {
      await mount()
      reflection._drain()
      speak()

      await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalledWith(
        'Virtue is a habit.',
        expect.any(Function),
      ))

      await act(async () => { await browserOnEnd()() })

      await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })
      expect(capture.startCapture).toHaveBeenCalledTimes(2)
    } finally {
      delete FakeAudio.prototype.playRejects
    }
  })

  it('does not reopen the mic on a screen the user has left', async () => {
    // The abort check inside the callback. LISTEN clears the flag again on its
    // way out, so the case this actually guards is unmount: the user walked to
    // settings while the browser voice was still talking, and the callback lands
    // afterwards. Restarting there would grab the microphone for a screen that no
    // longer exists.
    FakeAudio.prototype.playRejects = true
    try {
      const { unmount } = await mount()
      reflection._drain()
      speak()

      await waitFor(() => expect(speakWithBrowserTTS).toHaveBeenCalled())
      const finished = browserOnEnd()

      unmount()
      const restarts = capture.startCapture.mock.calls.length

      await act(async () => { await finished() })

      expect(capture.startCapture).toHaveBeenCalledTimes(restarts)
    } finally {
      delete FakeAudio.prototype.playRejects
    }
  })
})

// ── The mic, second time round ────────────────────────────

describe('when the mic fails on restart', () => {
  it('reports it, the same as it would on mount', async () => {
    // Not the same path as the mount failure: this one runs through
    // restartListening after a completed turn, and a device unplugged mid-session
    // lands here rather than at startup.
    await mount()
    reflection._drain()
    speak()

    await waitFor(() => expect(lastAudio()?.played).toBe(true))

    capture.startCapture.mockRejectedValue(new Error('device lost'))
    await lastAudio().end()

    expect(await screen.findByText(/change your mic permissions/)).toHaveTextContent('device lost')
    expect(statue()).toBe('/thinker.png')
  })

  it('reports it after an interruption too', async () => {
    await mount()
    reflection._drain()
    speak()
    await waitFor(() => expect(lastAudio()?.played).toBe(true))

    capture.startCapture.mockRejectedValue(new Error('device lost'))
    await act(async () => { listen() })

    expect(await screen.findByText(/change your mic permissions/)).toBeInTheDocument()
  })
})

// ── Navigation ────────────────────────────────────────────

describe('the top bar', () => {
  it('opens history and settings', async () => {
    const onOpenHistory = vi.fn()
    const onOpenSettings = vi.fn()
    render(<MainScreen settings={settings} onOpenHistory={onOpenHistory} onOpenSettings={onOpenSettings} />)
    await screen.findByRole('button', { name: 'SPEAK, APORIUS!' })

    fireEvent.click(screen.getByRole('button', { name: 'Conversation History' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(onOpenHistory).toHaveBeenCalled()
    expect(onOpenSettings).toHaveBeenCalled()
  })
})
