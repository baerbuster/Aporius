# Aporius — Technical Specification (as built)

This describes the application as it exists in `src/`. Every claim here was
checked against the code rather than carried over from the plan.

The document that preceded the build is preserved at
[`original-design.md`](original-design.md). It is history, not reference — it
describes a different STT provider, a different voice, three APIs instead of
five, and no reflection pipeline at all. Its typography and colour sections are
still authoritative and are not repeated here.

## Contents

1. [What Aporius is](#1-what-aporius-is)
2. [Stack, build and deployment](#2-stack-build-and-deployment)
3. [Screens and navigation](#3-screens-and-navigation)
4. [State machine](#4-state-machine)
5. [Anatomy of a turn](#5-anatomy-of-a-turn)
6. [Audio capture](#6-audio-capture)
7. [Stage 1 — live sentence stream](#7-stage-1--live-sentence-stream)
8. [Stage 2 — reflection stream](#8-stage-2--reflection-stream)
9. [Stage 2b — the render queue](#9-stage-2b--the-render-queue)
10. [Playback](#10-playback)
11. [External services](#11-external-services)
12. [Conversation and context](#12-conversation-and-context)
13. [Settings and storage](#13-settings-and-storage)
14. [Error handling](#14-error-handling)
15. [Debug logging](#15-debug-logging)
16. [Known gaps](#16-known-gaps)

---

## 1. What Aporius is

A voice-only philosophical interlocutor. You hold a conversation out loud with a
Greek philosopher who lives in a browser tab, and he answers in a voice.

The thing that makes it more than a speech-to-LLM-to-speech loop is what happens
in the gap. An LLM answer takes seconds to arrive, and seconds of silence after
someone finishes speaking reads as dead air. Instead of filling that gap with a
spinner, Aporius **reflects the speaker's own sentences back at them, in his own
voice, while he is still thinking** — turned into second person, ranked by how
substantial they were, and played most-substantial-first, interleaved with
half-vocalised thinking sounds.

Everything architecturally unusual in this codebase exists to serve that.

---

## 2. Stack, build and deployment

**Runtime dependencies: two.** `react` and `react-dom` (18.3.1). There is no
state library, no router, no HTTP client, no UI framework. Every API call is
`fetch`, every screen transition is a string in `App.jsx`.

**Build:** Vite 5.4 with `@vitejs/plugin-react` and `vite-plugin-pwa`.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on `:5173`. Also serves the prompt bench at `/tools/debug.html` |
| `npm run build` | Production build, **then** `scripts/sync-app.mjs` copies it to the Dock app |
| `npm run build:only` | Build without the sync |
| `npm run build:phone` | `APORIUS_PWA=1` — full PWA, installable, offline |
| `npm run preview` | Serve the built output |

**The service worker is off by default, deliberately.** `vite.config.js` reads
`APORIUS_PWA` and passes `selfDestroying: !PWA_ENABLED`, which emits a worker
whose only job is to unregister any previously installed one. A cached service
worker on a desktop test build shows yesterday's code and wastes an afternoon;
phone builds opt back in via `build:phone`.

**Deployment is a local macOS Dock app**, not a website. `Aporius.app` serves a
build out of `~/Library/Application Support/Aporius/dist`. The Desktop project
directory is the source; the Dock app runs a *copy*, which `npm run build` keeps
in sync automatically. See [`dock-app.md`](dock-app.md).

There is no hosting, no server, and no backend. Every API call goes from the
browser straight to the provider using the user's own key.

---

## 3. Screens and navigation

Five screens, switched by a single `screen` string in `App.jsx`. No router.

| Screen | Component | Reached by |
|---|---|---|
| Splash | `SplashScreen.jsx` | app launch |
| Know Thyself | `KnowThyself.jsx` | laurel wreath; or automatically when keys are missing |
| Main | `MainScreen.jsx` | tapping the splash |
| Conversation History | `ConversationHistory.jsx` | scroll icon |
| Ponder This | `PonderThis.jsx` | pressing **back** on the splash |

**The key gate.** `hasAllKeys()` requires all five: `groqKey`, `claudeKey`,
`elevenLabsKey`, `googleTTSKey`, `deepgramKey`. Tapping the splash without them
routes to settings instead of the main screen. Deepgram is in that list on
purpose — leave it out and a fresh device reaches a main screen whose entire
reflection half is silently dead.

**Ponder This is a joke, not an error screen.** Pressing back on the splash means
trying to leave the app; `SplashScreen` pushes a history entry and catches the
`popstate`, and instead of exiting you get *"How can a man go back to a place he
has never been?"*

**MainScreen unmounts** when you visit settings or history, and remounts on the
way back, re-initialising the mic. The rendered thinking-sound pool survives this
because it is a module-level singleton (§10), not component state.

---

## 4. State machine

Seven states, collapsing to three visible screens.

| State | Screen | Meaning |
|---|---|---|
| `IDLE` | Listening | initial, before the mic is up |
| `BUFFERING` | Listening | mic hot, capturing |
| `WAITING_FOR_TRANSCRIPT` | Thinking | button pressed, Groq transcribing |
| `REFLECTING` | Thinking | reflections playing, Claude thinking |
| `SYNTHESIZING_SPEECH` | Thinking | rendering Aporius's reply |
| `PLAYING_AUDIO` | Speaking | the reply is playing |
| `ERROR` | Thinking | with a tap-to-dismiss overlay |

Membership is defined by two Sets in `components/screens/mainScreenStates.js`:
`LISTENING_STATES` and `THINKING_STATES`, alongside `statueForState`. The statue
image and the laurel's spin are derived from those, so a state's screen is
decided in one place.

**The button has two labels and they map to state, not to a mode.**
`SPEAK, APORIUS!` shows in listening states; `LISTEN, APORIUS!` shows in every
other state and interrupts whatever is happening.

---

## 5. Anatomy of a turn

This is the part the original design document has no concept of.

**Two independent pipelines run off the same microphone.**

```
                    AudioWorklet (16kHz PCM)
                     │
        ┌────────────┴────────────┐
        │                         │
   local buffer              Deepgram socket
   (accumulates)             (streams live)
        │                         │
   [button press]           sentences, drained on . ? !
        │                         │
   WAV → Groq Whisper        Haiku: perspective swap + score 1-10
        │                         │
   transcript                ElevenLabs render per sentence
        │                         │
   Claude (Opus)             ranked audio list
        │                         │
   reply text                     └──► PLAYS IMMEDIATELY on button press
        │
   ElevenLabs render
        │
   plays after reflections finish
```

The left pipeline is the conversation. The right pipeline is the reflections. They
share only the raw audio chunks; neither waits on the other.

**Where the turn lives.** `MainScreen.jsx` is a 35-line container: it calls
`useTurn` and renders `MainScreenView.jsx`. Everything below is in
`hooks/useTurn.js` (state machine, mic lifecycle, the turn) and
`hooks/useReflections.js` (both background streams and the playback loop), with
`services/retry.js`, `services/ai.js` and `services/tts.js` holding the retry
wrapper, the model routing and the TTS fallback chain respectively.

**Sequence, from `handleSpeakAporius` in `hooks/useTurn.js`:**

1. Mic stops. Deepgram is asked to flush (§7).
2. **Reflection playback starts immediately** — `playReflections` is called
   *before* transcription, not after. Nothing in it needs the transcript; the
   clips were rendered while the user was still talking.
3. Groq transcribes the buffered WAV, concurrently.
4. Claude is fired with the transcript and history, concurrently with reflections
   still playing.
5. Reflections continue until Claude lands. `claudeDone` is both a boolean the loop
   polls and a promise the loop can be woken by.
6. Claude's reply is rendered to speech.
7. The turn is saved; summarisation is checked.
8. `finishReflections()` — the in-flight reflection clip is allowed to finish so the
   reply doesn't talk over it.
9. The reply plays. On `ended`, the mic restarts.

**The race is the design.** If Claude is fast, few reflections play. If Claude is
slow, more play. The first clip always plays regardless, so a turn never starts
in silence — and if no clip is ready yet, a pre-rendered thinking sound covers
exactly that window.

**`abortRef`** is checked after every await. `LISTEN, APORIUS!` sets it, which
unwinds the whole flow wherever it happens to be. It lives in `useTurn.js`, the
only file that may set it; `useReflections.js` receives an `isAborted()` reader
instead of the ref, so the playback loop can stop on the flag but cannot raise it.

---

## 6. Audio capture

`hooks/useAudioCapture.js` and `public/audio-processor.js`.

- **Constraints:** mono, `echoCancellation`, `noiseSuppression`, `autoGainControl`.
- **AudioContext at 16 kHz**, requested directly; if the browser refuses the rate
  it falls back to a default-rate context and the worklet resamples.
- **The worklet** downsamples to 16 kHz by linear interpolation, converts float32
  to int16, and `postMessage`s the buffer with a transfer list — zero-copy.
- **Each chunk fans out twice:** appended to a local array for the Groq WAV, and
  handed to `onAudioChunk`, which feeds the Deepgram socket. The fan-out is
  wrapped in try/catch: the reflection side must never break transcription.
- **On stop,** the chunks are wrapped in a 44-byte RIFF header by `encodeWAV` and
  POSTed to Groq as a single file.

**There is no voice activity detection.** The original design specified a −40 dB
threshold and the worklet's header comment used to claim it did VAD; neither was
ever true. Every sample captured is buffered and sent. The comment now says so.

---

## 7. Stage 1 — live sentence stream

`services/deepgram.js`. Output is a list of strings. Nothing else.

- `wss://api.deepgram.com/v1/listen`, model `nova-3`, `linear16` @ 16 kHz mono,
  `punctuate` and `smart_format` on.
- **`interim_results` is off.** Only finalised text enters the buffer, so an
  emitted sentence can never be rewritten later.
- Finalised text accretes into a string buffer, which is drained on every
  terminal mark (`.` `?` `!`). One message may contain zero, one or many.
- Audio arriving before the socket opens is queued and flushed on `onopen`.

**The flush on stop is load-bearing.** With interim results off, results only
arrive at endpoint boundaries, and a short final sentence never reaches one — it
would simply be lost. `stop()` sends `{"type":"CloseStream"}`, keeps the message
handler attached, and waits for Deepgram's *close* rather than hanging up. Late
finals arrive during that window. Whatever remains in the buffer afterwards is
emitted as the last sentence, terminal mark or not.

---

## 8. Stage 2 — reflection stream

`services/reflectionStream.js`. One sentence in, one ranked entry out.

Each sentence gets **one `claude-haiku-4-5` call** doing three jobs at once:
swap the speaker's perspective to second person, cut filler subtractively, and
score profundity 1–10. `temperature: 0`, `max_tokens: 150`, 3-second ceiling.

The system prompt lives in `services/reflection-prompt.js` and is the single
source shared with `tools/debug.html` and the battery harnesses. It is
byte-identical on every call, so Anthropic's prompt caching applies.

**Single in-flight, FIFO.** Parallel calls were considered and rejected. A slow
or failed call falls back to a whitespace-trimmed original and the queue keeps
moving — one sentence can never stall a turn.

### The validation guard

The model is asked to transform, not to write. The guard enforces that: every
word in the reflected sentence must either appear in the original, or be one of
the pronoun forms the transform legitimately introduces (`BASE_ALLOWED` — the
you-family, the I-family, and expanded copulas), or be part of the user's name.
Anything else means it paraphrased or invented, and the trimmed original is used
instead.

Comparison is apostrophe-insensitive and contraction-aware, so `you're` and
`you are` both pass.

> **`BASE_ALLOWED` is coupled to the prompt's perspective.** The prompt maps the
> speaker to *you/your*. Switch it back to third person without switching that
> set and the guard rejects every single reflection, silently — every sentence
> falls back to the trimmed original and the feature appears to just stop
> working. Change both or neither.

The model's profundity score survives a guard rejection. It is an independent
judgement of the original sentence, not of the rewrite.

### Ranking

`insertSorted` keeps the list sorted by profundity descending, in real time,
while the user is still speaking. Equal scores keep insertion order. **A late
high scorer jumping to the top mid-turn is intended** — nothing guards against
it, and playback re-reads the list before every clip so the jump takes effect.

---

## 9. Stage 2b — the render queue

A **second** single-in-flight FIFO queue, independent of the first, renders each
resolved reflection to audio via an injected `synthesize`.

Because the queues are separate, sentence N+1's Haiku call overlaps sentence N's
TTS render. Each stage stays strictly serial; the pipeline as a whole does not
stall. A render that fails or exceeds its 10-second ceiling means no clip for
that sentence — it stays in the ranked list, it just never reaches the audio
list. A timed-out render that lands later has its object URL revoked so the
abandoned clip doesn't leak.

Two lists are maintained: `reflections` (everything) and `audioReflections`
(only entries with a clip). Playback reads the second.

`waitForAudio()` resolves `true` when a clip lands and `false` once both stages
have drained — the only way a caller learns that no clip is ever coming.

---

## 10. Playback

### The reflection loop

`playReflections` in `hooks/useReflections.js`.

- **Always opens with a thinking sound**, before the first list read, covering
  the window where nothing has rendered yet.
- Re-reads the ranked list before every clip, so a straggler competes at its true
  rank rather than being appended.
- The first reflection clip always plays. After that the loop continues only
  while Claude is still thinking.
- **Profundity gaps get a beat.** If consecutive clips differ by more than
  `THINKING_SOUND_GAP` (1), a thinking sound is dropped between them, so a fall
  from something weighty to something mundane isn't a hard cut. The comparison is
  absolute, not a signed drop — a late high scorer can make the step upward.
- On an empty list it blocks on `waitForAudio()` raced against Claude, rather
  than polling or giving up.

### Thinking sounds

`services/thinkingSounds.js`. Eight phrases — `...Hmmm...`, `...Mmmm...`,
`Let's see...`, `...I see...` and so on — rendered **once per app open** and held
as object URLs.

A **module-level singleton**, deliberately: MainScreen unmounts on every trip to
settings or history, and a component-scoped cache would re-render the pool each
time. Rendering is serial, so the first clip is usable in well under a second
rather than waiting for all eight.

Rotation walks a shuffled order and reshuffles at the end, rejecting any order
that would repeat the phrase just played.

### The reflection player

`services/reflectionPlayer.js`. Everything in the reflection phase — thinking sounds and
reflected sentences alike — plays through one chain: `<audio>` → panner → gain →
speakers. Gain 0.9, playback rate 0.85 with pitch preserved, random pan within
±0.35.

**A lowpass filter was tried here and cut.** Muffling the voice sounded broken
rather than private. Level, pace and placement do the work instead.

The reply itself does *not* go through this chain. It plays at full presence, and
that contrast is what makes the reflection phase read as thinking rather than
talking.

---

## 11. External services

Five providers. All keys are the user's own, held in `localStorage`, sent
directly from the browser.

| Provider | Used for | Model / endpoint |
|---|---|---|
| **Groq Whisper** | batch STT — the transcript | `whisper-large-v3-turbo` |
| **Deepgram** | streaming STT — the reflection sentences | `nova-3` |
| **Anthropic** | the reply, *and* every reflection | `claude-opus-4-6` default; `claude-haiku-4-5` for reflections |
| **ElevenLabs** | the voice | `eleven_turbo_v2_5` |
| **Google Cloud TTS** | fallback voice, on ElevenLabs quota | `en-US-Neural2-D` |

**The voice is fixed.** `s2wvuS7SwITYg8dqsJdn` — "The Highland Sage" — is
hardcoded in `elevenlabs.js` and is not a setting. It is the character, in the
same category as the persona prompt.

Two voice presets share that ID. The reply uses stability 0.5 / similarity 0.75;
the reflection phase uses `REFLECTION_VOICE` — stability 0.9, style 0, similarity
0.4 — which comes out flatter and breathier. He is muttering, not performing.

**Model routing.** `sendToAI()` dispatches on the model name: anything starting
`llama` goes to Groq's chat endpoint, everything else to Anthropic. Both routes
import the same persona from `services/aporius-prompt.js`, so Aporius cannot
sound like a different person depending on which model is selected.

**TTS fallback chain:** ElevenLabs → (on HTTP 402 only) Google → (on total
failure) the browser's own `speechSynthesis`. A non-quota ElevenLabs error is
rethrown rather than falling through, so a transient failure retries against
ElevenLabs instead of silently switching voices.

**`anthropic-dangerous-direct-browser-access: true`** is set on both Anthropic
calls. This is a personal, locally-served app where the user supplies their own
key and no third party is ever exposed to it; the header is a deliberate
trade-off, not an oversight.

---

## 12. Conversation and context

One continuous conversation, surviving refresh, tab close and reopen.

Two localStorage keys. `hooks/useConversation.js` owns the behaviour — reading,
appending, summarising, clearing. The key *names* are exported from
`src/settings.js` alongside the settings key, so the four files that touch this
storage cannot disagree about what it is called:

- `aporius_messages` — recent turns as `{role, content}` objects
- `aporius_summary` — an accumulating prose summary of older turns

**Per turn:** both are read, the new user message is appended, and the array plus
the summary (injected into the system prompt) go to the model. On success the
user message and the reply are appended and written back.

**Summarisation** fires above ~160,000 approximate tokens — about 80% of a 200k
context window, counted as characters÷4. The older half is sent to
`claude-sonnet-4-6` for summarising, the result is *appended* to the existing
summary rather than replacing it, and the summarised messages are dropped.

**Braindrain** — the destructive reset on the settings screen, behind a
confirmation overlay — removes both keys.

---

## 13. Settings and storage

`src/settings.js` is the only module that knows the `aporius_settings` key, and
is also where the two conversation key names are declared (§12) — every
localStorage name in the app is in that one file. `loadSettings` and `loadName`
return safe defaults (`{}` and `'Seeker'`) for both missing and corrupt storage,
so a first run and a mangled blob both land on the settings screen rather than a
white page.

The settings screen holds six fields plus a model dropdown: the display name,
and the five keys — two under a single *"By what right can you hear?"* heading,
since Groq and Deepgram are both listening, at different moments.

**Keys are stored in plaintext localStorage.** For an app that runs locally,
serves no other users, and talks only to the providers whose keys they are, this
is the same trust boundary as a `.env` file on the same machine. It would not be
acceptable in a hosted multi-user product.

---

## 14. Error handling

Errors are spoken where possible — this is a voice-first app, and a silent
failure is indistinguishable from Aporius ignoring you.

| Failure | Behaviour |
|---|---|
| Mic denied / unavailable | Browser TTS speaks it, `ERROR` state, diagnostic in the overlay |
| Groq STT fails | Spoken *"I didn't quite catch that…"*, auto-returns to listening after 2s |
| Empty transcript | Silently restarts listening — not an error |
| Claude fails | 3 attempts, 60s each, then *"my brain is foggy today"*, tap to return |
| ElevenLabs quota (402) | Silent fallback to Google TTS |
| TTS fails entirely | 3 attempts, 15s each, then the turn is **still saved**, and the reply is spoken by browser TTS |
| Audio playback fails | Browser TTS, then restart listening |
| Offline | Detected via `navigator.onLine`; error speech goes straight to browser TTS |

`withRetry(fn, maxRetries, timeoutMs)` races each attempt against a timeout and
waits 1s between attempts.

**Reflection failures are never surfaced.** A failed Haiku call falls back to the
trimmed original; a failed render just means one fewer reflection. The reflection layer
is enhancement, and it degrades quietly by design.

---

## 15. Debug logging

Off by default. Turn it on with:

```js
localStorage.setItem('aporius_debug', '1')  // then reload
```

`src/log.js` gates `debug()` only. `console.warn` (degraded but recovered) and
`console.error` (broken) are always on.

**The split is about privacy, not tidiness.** The trace logs print the
transcript, every reflected sentence, and the whole ranked list — for an app
people use to think out loud about their lives, that is the most sensitive
content in the system, and it does not go to the console unless someone asks for
it.

It is a runtime flag rather than `import.meta.env.DEV` because the Dock app
serves a *build*; build-time stripping would remove these logs from the one place
they actually get read.

---

## 16. Known gaps

Recorded here so the document does not read as more finished than it is.

- **On mobile, reflections play with a tremolo on them.** Broken up, as though
  wobbling. The same code on the desktop build does not do it. Unexplained and
  uninvestigated. The reply audio is not reported as affected — only the
  reflection phase, which is the only audio routed through the Web Audio chain in
  §10 and the only audio played at a reduced rate.
- **No CI.** The suite exists (Vitest, `npm test`, 422 tests, everything mocked) but
  nothing runs it on push, so nothing proves the project builds from a clean clone.
- **Coverage is 97.7% of statements and still blind where it matters most.**
  Nothing in the suite hears anything. It runs with no microphone, no network and
  no audio device, so every property that is actually about *sound* — two voices
  overlapping, a clip cut off mid-word, a gap that reads as dead air — is
  invisible to it. Demonstrated, not assumed: forcing the reflection loop's abort
  check to always report "not aborted" leaves all 62 turn-flow tests passing.
  A green run proves the logic ran in order. It proves nothing about the result.
- **`public/audio-processor.js` has no test coverage at all.** It runs on the
  AudioWorklet thread, which the jsdom environment cannot create. It is verified
  only by talking to the app.
- **Interrupting during a reflection is up to one clip late.** `LISTEN, APORIUS!`
  stops the reply instantly — that element is tracked and paused directly — but a
  reflection clip already playing runs to its end, because the loop only checks
  the abort flag between clips and nothing holds a handle to the current clip.
  Known and accepted, not a bug report.
- **The persona prompt still calls the reflection phase "murmuring".** The word
  was retired from the code, but `services/aporius-prompt.js` is instructions to
  the model, not a name for a function: editing it changes how Aporius speaks and
  no test would catch the difference. Left alone deliberately.
- **No diagrams yet.** The pipeline in §5 wants a real state and flow diagram;
  the ones in `docs/diagrams/` describe the pre-reflection architecture under an
  older project name and should not be trusted.
