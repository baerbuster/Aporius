import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// jsdom ships none of the browser APIs Aporius actually runs on: no object URLs,
// no Web Audio, no speech synthesis, no media playback. Each one is stubbed here
// once rather than in every file that trips over it.

let urlCounter = 0

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })

// Exported so a test can build a variant — a suspended context, one with no
// stereo panner — without restating the whole graph.
export function fakeAudioContext(overrides = {}) {
  return {
    state: 'running',
    resume: vi.fn(),
    destination: node(),
    createMediaElementSource: vi.fn(node),
    createGain: vi.fn(() => ({ ...node(), gain: { value: 0 } })),
    createStereoPanner: vi.fn(() => ({ ...node(), pan: { value: 0 } })),
    ...overrides,
  }
}

beforeEach(() => {
  // ── Object URLs ───────────────────────────────────────────
  // Counted rather than constant, so a test can prove that the URL it created is
  // the exact one that got revoked.
  URL.createObjectURL = vi.fn(() => `blob:aporius/${++urlCounter}`)
  URL.revokeObjectURL = vi.fn()

  // ── HTMLMediaElement ──────────────────────────────────────
  // jsdom defines the element but throws "not implemented" on play(). Resolving
  // is the honest default: playback started. Tests that need a clip to *finish*
  // fire `onended` themselves.
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  HTMLMediaElement.prototype.pause = vi.fn()

  // ── Web Audio ─────────────────────────────────────────────
  // Just enough graph for reflectionPlayer to wire up and tear down. A plain
  // `function` rather than an arrow: the app calls `new AudioContext()`, and an
  // arrow cannot be constructed.
  window.AudioContext = vi.fn(function () {
    return fakeAudioContext()
  })

  // ── Speech synthesis (the last-resort TTS) ────────────────
  window.speechSynthesis = { speak: vi.fn(), cancel: vi.fn() }
  window.SpeechSynthesisUtterance = vi.fn(function (text) {
    this.text = text
  })

  // ── Layout ────────────────────────────────────────────────
  // jsdom has no layout, so scrollIntoView is undefined rather than a no-op.
  Element.prototype.scrollIntoView = vi.fn()

  // ── navigator.onLine ──────────────────────────────────────
  // Defaults to online; the offline branch is opted into per test.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)

  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
