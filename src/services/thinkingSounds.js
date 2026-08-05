import { debug } from '../log'
// Thinking sounds — the character's connective tissue between reflections.
//
// A small pool of murmurs, rendered ONCE per app open and held as object URLs.
// Every turn opens with one, and one is dropped between two reflection clips
// whose profundity scores are far apart, so a fall from something weighty to
// something mundane gets a beat of thought instead of a hard cut.
//
// Because they are already rendered, one is playable the instant the button is
// pressed. That is what keeps a turn from ever starting silent: the reflection
// pipeline (Deepgram flush → Haiku call → TTS render) can lose its race with
// Claude on a short utterance, and the opener covers exactly that window.
//
// Module-level singleton, deliberately. MainScreen unmounts whenever the user
// visits settings or history and remounts on the way back; a component-scoped
// cache would re-render the whole pool on every one of those trips.
//
// This file only owns the pool and its rotation. Playback — the filter chain that
// gives everything in the reflection phase its muffled quality — lives in
// murmurPlayer.js, shared with the reflected sentences.

// The voice preset is shared too, so it can't shift mid-turn.
import { REFLECTION_VOICE } from './elevenlabs'

// One shared pool — openers and interstitials draw from the same list.
const PHRASES = [
  '...Hmmm...',
  '...Mmmm...',
  '...yyyyyaaa...',
  'Hmmm?',
  "Let's see...",
  '...Mmhm...',
  '...I see...',
  '...Ahhh...',
]

let clips = [] // { text, url } for every phrase that rendered successfully
let priming = null // in-flight or settled prime() promise; makes it idempotent
let order = [] // shuffled indices into `clips`, consumed by next()
let cursor = 0
let lastPlayed = null // guards against the same phrase twice in a row

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Reshuffle, rejecting an order that would repeat the phrase just played. With
// two or more clips a satisfying order always exists, so this terminates.
function reshuffle() {
  if (clips.length <= 1) {
    order = clips.length ? [0] : []
    cursor = 0
    return
  }
  do {
    order = shuffled(clips.length)
  } while (clips[order[0]].url === lastPlayed)
  cursor = 0
}

// Render the pool. Idempotent — a second call while rendering, or after it has
// finished, returns the same promise and re-renders nothing.
//
// `synthesize` is injected (same shape as createReflectionStream's) so this file
// stays provider-agnostic: it resolves to { blob, url }.
//
// Serial, not parallel. The first clip becomes usable in well under a second and
// the rest fill in behind it, which matters because the user can press the button
// before the pool is finished.
export function prime({ synthesize } = {}) {
  if (priming) return priming
  if (!synthesize) return Promise.resolve([])

  priming = (async () => {
    for (const text of PHRASES) {
      try {
        const audio = await synthesize(text, REFLECTION_VOICE)
        if (audio?.url) {
          clips.push({ text, url: audio.url })
          // Usable immediately — don't wait for the whole pool.
          if (clips.length === 1) reshuffle()
        }
      } catch (err) {
        // One bad render just leaves that phrase out of the rotation.
        console.warn(`[Thinking] "${text}" failed to render:`, err?.message || err)
      }
    }
    reshuffle()
    debug(`[Thinking] ${clips.length}/${PHRASES.length} sounds ready`)
    return clips
  })()

  return priming
}

// The next clip URL, or null if nothing has rendered yet. Walks a shuffled order
// and reshuffles at the end, so the pool cycles rather than repeating at random.
export function next() {
  if (!clips.length) return null
  if (cursor >= order.length) reshuffle()

  const clip = clips[order[cursor++]]
  lastPlayed = clip.url
  return clip.url
}

// Teardown only. These clips are app-lifetime — releasing them on a screen change
// would defeat the whole point of the cache.
export function release() {
  for (const c of clips) URL.revokeObjectURL(c.url)
  clips = []
  order = []
  cursor = 0
  lastPlayed = null
  priming = null
}
