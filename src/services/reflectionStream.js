import { debug } from '../log'
import { SYSTEM_PROMPT } from './reflection-prompt.js'

// Stage 2 (replacement) — sentence strings → a live, self-sorting list of
// LLM reflections.
//
// Fed by Stage 1's onSentence. Each sentence gets ONE Claude call that does three
// things at once: switch the speaker's perspective to singular "they", cut
// filler subtractively, and score profundity 1-10. Resolved reflections are
// inserted into a ranked list kept sorted by profundity descending, in real
// time, while the user is still speaking.
//
// Single in-flight call, FIFO queue — the user decided against parallel calls.
// A slow or failed call falls back to a lightly-trimmed original and the queue
// keeps moving; one call can never stall the turn.
//
// Stage 2b — TTS. Each resolved reflection is handed to a SECOND single-in-flight
// FIFO queue that renders it to audio via the injected `synthesize`. The two
// queues are independent, so sentence N+1's Claude call overlaps sentence N's TTS
// render: each stage is still strictly serial, but the pipeline doesn't stall.
// Entries that get audio are inserted into a second ranked list, also sorted by
// profundity descending — that is the list a playback layer pops from.
//
// This mirrors the shape of the stream it replaces (start / submit / stop /
// getReflections) so the MainScreen wiring is a one-line swap. It does not
// drive playback — both ranked lists are maintained and logged only; a future
// playback layer will pop from the top.

// ── Tunables ────────────────────────────────────────────────
// Switched off Groq: the free tier caps at ~80 calls/day and one conversational
// turn is 5-7 sentences, so it ran dry almost immediately. Now Claude Haiku, keyed
// off the same Anthropic key the settings pull uses (settings.claudeKey).
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5' // holds the bidirectional pronoun swap; fast + cheap
const TIMEOUT_MS = 3000 // per-call ceiling; roomy enough it never false-times-out
const TTS_TIMEOUT_MS = 10000 // same idea for the render; a hung TTS can't wedge the queue
const DEFAULT_THRESHOLD = 0 // sentences scoring below this are never inserted
const FALLBACK_PROFUNDITY = 1 // score for an unscored fallback (no model rating)
const MAX_TOKENS = 150

// ── System prompt ───────────────────────────────────────────
// Lives in ./reflection-prompt.js — imported at the top of this file. It is the
// single source of truth, shared with the prompt bench and the battery harness.
// Byte-identical on every call, so Anthropic's prompt caching applies. Read the
// warnings in that file before touching it: this is the live audible path, and
// the prompt is coupled to BASE_ALLOWED below.

// ── Validation guard (§7) ───────────────────────────────────
// Every word in the model's reflected sentence must either appear in the
// original, or be one of the pronoun/agreement forms the transform legitimately
// introduces, or be part of the user's name. Anything else means the model
// paraphrased or invented — reject and fall back to a trimmed original.
//
// Forms are stored apostrophe-stripped ("you're" -> "youre") to match how
// rawTokens normalizes, and expanded copulas (are/were/am/was) are included so
// both "you're" and "you are" pass.
//
// The speaker now maps to the you-family, not the they-family, so the they-forms
// were removed: a third-party "they" already present in the original passes via
// origSet, and the transform no longer introduces one.
const BASE_ALLOWED = new Set([
  'you', 'your', 'yours', 'yourself',
  'youre', 'youve', 'youd', 'youll',
  'me', 'my', 'mine', 'myself', 'i',
  'im', 'ive', 'id', 'ill',
  'are', 'were', 'am', 'was',
])

function normalizeApostrophes(s) {
  return s.replace(/[‘’]/g, "'")
}

// Words with apostrophes collapsed (don't -> dont), everything else split on
// non-word characters. This is how both the original and the reflected sentence
// are compared, so contractions line up token-for-token.
function rawTokens(s) {
  return normalizeApostrophes(s)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// Additionally expand contractions into their two words, so a reflected "she is"
// (from a spoken "she's") finds "is" in the original's token set.
function expandedTokens(s) {
  return normalizeApostrophes(s)
    .toLowerCase()
    .replace(/\bi'm\b/g, ' i am ')
    .replace(/\b(\w+)'re\b/g, ' $1 are ')
    .replace(/\b(\w+)'ve\b/g, ' $1 have ')
    .replace(/\b(\w+)'ll\b/g, ' $1 will ')
    .replace(/\b(\w+)'d\b/g, ' $1 would ')
    .replace(/\bwon't\b/g, ' will not ')
    .replace(/\bcan't\b/g, ' can not ')
    .replace(/\b(\w+)n't\b/g, ' $1 not ')
    .replace(/\b(he|she|it|that|what|who|there|here|where|when|how)'s\b/g, ' $1 is ')
    .replace(/\b(\w+)'s\b/g, ' $1 ')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function passesGuard(original, reflected, userName) {
  const origSet = new Set([...rawTokens(original), ...expandedTokens(original)])
  const allowed = new Set(BASE_ALLOWED)
  if (userName) for (const w of rawTokens(userName)) allowed.add(w)

  for (const w of rawTokens(reflected)) {
    if (!origSet.has(w) && !allowed.has(w)) return false
  }
  return true
}

// Lightly-trimmed original: whitespace only. A subtractive edit that touches
// nothing else — safe by construction, and it always passes the guard.
function trimOriginal(sentence) {
  return sentence.replace(/\s+/g, ' ').trim()
}

function normalizeScore(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return FALLBACK_PROFUNDITY
  return Math.min(10, Math.max(1, n))
}

// Pull the JSON object out of the model's text. Haiku returns bare JSON given
// the "Return ONLY a JSON object" instruction, but tolerate stray prose around
// it — a failed match throws and the caller falls back for this sentence.
function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in reply')
  return JSON.parse(text.slice(start, end + 1))
}

// ── The single Claude call ──────────────────────────────────
// A dedicated function with its own system prompt — NOT routed through
// sendToClaude (that carries the Aporius persona). One JSON object out:
// { reflected, profundity }.
async function reflectSentence({ apiKey, sentence, timeoutMs }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: sentence }],
      }),
    })

    if (!response.ok) throw new Error(`Claude reflect ${response.status}`)

    const data = await response.json()
    const parsed = extractJson(data.content[0].text)
    return {
      reflected: typeof parsed.reflected === 'string' ? parsed.reflected.trim() : '',
      profundity: normalizeScore(parsed.profundity),
    }
  } finally {
    clearTimeout(timer)
  }
}

// ── The single TTS render ───────────────────────────────────
// `synthesize` is injected by the caller (MainScreen passes its ElevenLabs →
// Google composite) so this service stays provider-agnostic. It takes the
// reflected text and resolves to { blob, url }.
//
// A timed-out render still finishes somewhere out there; when it lands, its
// object URL is revoked so the abandoned clip doesn't leak.
function synthesizeWithCeiling(synthesize, text, timeoutMs) {
  const pending = synthesize(text)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('TTS timed out'))
      pending.then((a) => a?.url && URL.revokeObjectURL(a.url)).catch(() => {})
    }, timeoutMs)
    pending.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export function createReflectionStream({
  apiKey,
  userName,
  synthesize,
  onReflected,
  onAudioReady,
  threshold,
} = {}) {
  let reflections = [] // every reflection, sorted by profundity descending
  let audioReflections = [] // only those with a rendered clip, same sort
  let nextIndex = 0
  let queue = []
  let inFlight = false
  let ttsQueue = []
  let ttsInFlight = false
  let running = false
  let stopping = false
  let resolveStop = null
  let audioWaiters = [] // resolvers parked in waitForAudio()
  let currentThreshold = Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD

  // Sorted insert. Equal scores keep insertion order (earlier stays higher); a
  // late high scorer lands at the top — that jump-to-top is the design (§6),
  // so nothing guards against it.
  const insertSorted = (list, entry) => {
    let i = 0
    while (i < list.length && list[i].profundity >= entry.profundity) i++
    list.splice(i, 0, entry)
  }

  // Drop every rendered clip and hand its memory back.
  const releaseAudio = () => {
    for (const e of audioReflections) {
      if (e.audio?.url) URL.revokeObjectURL(e.audio.url)
      e.audio = null
    }
    audioReflections = []
  }

  // Both stages must be idle — a reflection whose audio is still rendering is
  // not done.
  const isDrained = () =>
    !inFlight && queue.length === 0 && !ttsInFlight && ttsQueue.length === 0

  // Hand every parked waiter the same answer and clear the list. `true` means a
  // clip just landed; `false` means none is coming.
  const notifyAudioWaiters = (arrived) => {
    const waiters = audioWaiters
    audioWaiters = []
    for (const w of waiters) w(arrived)
  }

  const settleStopIfDrained = () => {
    if (!isDrained()) return
    if (stopping) notifyAudioWaiters(false) // nothing left to render, ever
    if (stopping && resolveStop) {
      const done = resolveStop
      resolveStop = null
      running = false
      done(audioReflections)
    }
  }

  const processOne = async ({ index, sentence }) => {
    let reflected
    let profundity

    try {
      const r = await reflectSentence({ apiKey, sentence, timeoutMs: TIMEOUT_MS })
      reflected = r.reflected
      profundity = r.profundity
    } catch (err) {
      // Timeout, API error, or unparseable JSON: fall back for this sentence
      // and let the queue continue.
      console.warn(`[Reflect ${index}] fallback:`, err?.name || err)
      reflected = trimOriginal(sentence)
      profundity = FALLBACK_PROFUNDITY
    }

    // Pure filler → empty reflected → never inserted.
    if (!reflected) {
      debug(`[Reflect ${index}] filler, dropped: "${sentence}"`)
      return
    }

    // Guard: a paraphrase or invention is replaced by the trimmed original
    // (which passes trivially). The model's profundity score still stands —
    // it's an independent judgment of the original (§5c).
    if (!passesGuard(sentence, reflected, userName)) {
      console.warn(`[Reflect ${index}] guard rejected, using trimmed original: "${reflected}"`)
      reflected = trimOriginal(sentence)
    }

    // Below-threshold entries are never inserted.
    if (profundity < currentThreshold) {
      debug(`[Reflect ${index}] below T(${currentThreshold}) score=${profundity}, dropped`)
      return
    }

    const entry = { index, original: sentence, reflected, profundity, audio: null }
    insertSorted(reflections, entry)

    // A throwing consumer must not corrupt the list or stall the queue.
    try {
      onReflected?.(entry)
    } catch (err) {
      console.warn(`[Reflect ${index}] reflected consumer threw:`, err)
    }

    // Hand off to the TTS stage. Filler and below-threshold sentences returned
    // above, so they are never rendered.
    ttsQueue.push(entry)
    pumpTts()
  }

  // Render one reflection and file it in the audio list. A failed render means
  // no clip for that sentence — it stays in `reflections`, it just never reaches
  // `audioReflections`, and the queue moves on.
  const renderOne = async (entry) => {
    if (!synthesize) return
    try {
      const audio = await synthesizeWithCeiling(synthesize, entry.reflected, TTS_TIMEOUT_MS)
      entry.audio = audio
      insertSorted(audioReflections, entry)
    } catch (err) {
      console.warn(`[Reflect ${entry.index}] TTS failed, no clip:`, err?.message || err)
      return
    }

    try {
      onAudioReady?.(entry)
    } catch (err) {
      console.warn(`[Reflect ${entry.index}] audio consumer threw:`, err)
    }

    // A playback layer blocked on an empty list can move now.
    notifyAudioWaiters(true)
  }

  // Drain the FIFO queue one call at a time.
  const pump = () => {
    if (inFlight) return
    const next = queue.shift()
    if (!next) {
      settleStopIfDrained()
      return
    }
    inFlight = true
    processOne(next).finally(() => {
      inFlight = false
      if (queue.length) pump()
      else settleStopIfDrained()
    })
  }

  // The TTS stage's own pump — same shape, its own in-flight flag, so it runs
  // alongside the Claude stage rather than behind it.
  const pumpTts = () => {
    if (ttsInFlight) return
    const next = ttsQueue.shift()
    if (!next) {
      settleStopIfDrained()
      return
    }
    ttsInFlight = true
    renderOne(next).finally(() => {
      ttsInFlight = false
      if (ttsQueue.length) pumpTts()
      else settleStopIfDrained()
    })
  }

  // One listening session, mirroring Stage 1: its start() clears its sentence
  // list, so this clears the ranked list alongside it, keeping index alignment
  // across a whole conversation.
  const start = () => {
    notifyAudioWaiters(false) // no waiter may outlive the turn it belongs to
    releaseAudio()
    reflections = []
    nextIndex = 0
    queue = []
    inFlight = false
    ttsQueue = []
    ttsInFlight = false
    stopping = false
    resolveStop = null
    running = true
    return true
  }

  // Wired to Stage 1's onSentence. The leftover sentence Stage 1 emits from its
  // own stop() arrives here before this stream's stop() runs, so stopping is
  // still false and it enqueues normally.
  const submit = (sentence) => {
    if (!running || stopping) return
    if (typeof sentence !== 'string' || !sentence.trim()) return

    queue.push({ index: nextIndex++, sentence })
    pump()
  }

  // Async, like the stream it replaces: resolves once BOTH stages have drained,
  // yielding the final ranked list of reflections with audio. In-flight calls are
  // allowed to finish; they are not aborted.
  const stop = () => {
    if (!running) return Promise.resolve(audioReflections)
    if (stopping) return Promise.resolve(audioReflections)

    stopping = true
    if (!inFlight && queue.length === 0 && !ttsInFlight && ttsQueue.length === 0) {
      running = false
      return Promise.resolve(audioReflections)
    }
    return new Promise((resolve) => {
      resolveStop = resolve
    })
  }

  // The live ranked lists at any instant — valid mid-speech, always current.
  // Entries are shared between the two, so an entry's `audio` appearing in one
  // is visible in the other.
  const getReflections = () => reflections
  const getAudioReflections = () => audioReflections

  // Resolves true when the next clip lands in the audio list, false when both
  // stages have drained and no clip is coming. Event-driven — a caller with an
  // empty list can block on this instead of polling or giving up.
  const waitForAudio = () => {
    if (isDrained() && (stopping || !running)) return Promise.resolve(false)
    return new Promise((resolve) => audioWaiters.push(resolve))
  }

  // Threshold is a tunable the user may raise later without touching code.
  const setThreshold = (t) => {
    if (Number.isFinite(t)) currentThreshold = t
  }

  // For teardown: start() already releases between turns, this covers unmount.
  const release = () => {
    notifyAudioWaiters(false)
    releaseAudio()
  }

  return {
    start,
    submit,
    stop,
    getReflections,
    getAudioReflections,
    waitForAudio,
    setThreshold,
    release,
  }
}
