# Work order: split `MainScreen.jsx`

You are implementing a **mechanical, behaviour-preserving refactor**. Nothing about
how this app behaves may change. Code moves between files; that is all.

Read this document to the end before touching anything.

---

## 1. Why

`src/components/screens/MainScreen.jsx` is 615 lines doing six jobs at once: the
state machine, the microphone lifecycle, both audio pipelines, retry logic, the
text-to-speech fallback chain, and rendering. It is listed as a known gap in
`docs/tech-spec.md` §16.

This job separates those six jobs into eight files. It does not improve any of
them.

---

## 2. The rules

These are non-negotiable. Violating any one of them fails the job.

1. **Move only.** No behaviour changes. No bug fixes. No tidying. No renaming of
   existing functions, variables, constants, or debug strings. If you spot
   something wrong, leave it alone — §9 already records the known ones.
2. **Comments travel with their code, verbatim.** Do not reword, shorten, or
   "modernise" them. They document real hazards. This includes comments that use
   the obsolete term "Path B" — retiring that name is deliberately out of scope.
3. **Do not touch `src/components/screens/MainScreen.test.jsx`.** Not one line.
   Those 62 tests are the proof this refactor was safe. They only press buttons
   and check results, so a faithful move leaves every one of them passing.
   A failing test means you broke something — fix your code, never the test.
4. **Do not add, remove, or change any `vi.mock` anywhere.** Every module the
   tests mock stays exactly where it is.
5. **Do not commit.** Stop when §8 is satisfied and report. The user commits after
   verifying by ear.
6. **Do not push.**

---

## 3. Baseline — confirm before you start

Run these first. If any of them does not match, stop and report rather than
proceeding.

```
npm test          →  18 test files, 395 tests, all passing
npm run lint      →  clean, no output
```

`npx vitest run src/components/screens/MainScreen.test.jsx` → 62 tests passing.

These same numbers are the finish line in §8.

---

## 4. Target file layout

Files are organised **by kind**, matching the project's existing convention. Do
not create new folders.

| New file | Holds |
|---|---|
| `src/services/retry.js` | retry-with-timeout, online check |
| `src/services/ai.js` | Claude-or-Groq routing |
| `src/services/tts.js` | ElevenLabs → Google fallback |
| `src/hooks/useReflections.js` | both background streams and the reflection playback loop |
| `src/hooks/useTurn.js` | state machine, mic lifecycle, the full turn |
| `src/components/screens/mainScreenStates.js` | state Sets and the statue lookup |
| `src/components/screens/MainScreenView.jsx` | the rendering, and nothing else |
| `src/components/screens/MainScreen.jsx` | container: wires the hook to the view |

No test files are created in this job. The file count stays at 18.

---

## 5. The map

Line numbers refer to `src/components/screens/MainScreen.jsx` as it stands at the
time of writing. **Read the real file — do not trust these ranges blindly.** If a
range does not contain what this table says it contains, stop and report.

### `src/services/retry.js`

| Lines | What |
|---|---|
| 42–60 | `withRetry` — export it |
| 62–64 | `isOnline` — export it |

No imports needed.

### `src/services/ai.js`

| Lines | What |
|---|---|
| 66 | the routing comment |
| 67–72 | `sendToAI` — export it |

Imports `sendToClaude` from `./claude` and `sendToGroq` from `./groq` (currently
lines 6–7).

### `src/services/tts.js`

| Lines | What |
|---|---|
| 74 | the fallback-chain comment |
| 75–86 | `synthesizeSpeech` — export it, **keeping this exact name** |

Imports from `./elevenlabs`: `synthesizeSpeech as elevenLabsSynthesize` and
`ElevenLabsQuotaError` (part of lines 8–12).
Imports from `./googleTTS`: `synthesizeSpeech as googleSynthesize` and
`base64ToAudioBlob` (part of line 13).

Note: `REFLECTION_VOICE` and `speakWithBrowserTTS` are **not** used by this
function. They belong to `useReflections.js` and `useTurn.js` respectively.

Yes, this file now has three things called `synthesizeSpeech` in scope, aliased
apart. That is exactly the situation today, preserved deliberately. See §9.

### `src/components/screens/mainScreenStates.js`

| Lines | What |
|---|---|
| 23–26 | the app-states comment block |
| 32–38 | `LISTENING_STATES`, `THINKING_STATES` — export both |
| 88 | the statue comment |
| 89–93 | `statueForState` — export it |

`THINKING_SOUND_GAP` (lines 28–30) does **not** go here — it goes to
`useReflections.js`, its only consumer.

### `src/hooks/useReflections.js`

Signature: `export function useReflections({ settings, abortRef })`

| Lines | What |
|---|---|
| 28–30 | `THINKING_SOUND_GAP` and its comment |
| 106–117 | the timing probe: `clickAtRef`, `firstReadyLoggedRef`, `firstPlayLoggedRef`, `sinceClick`, and the whole comment block |
| 121–145 | the reflection stream construction |
| 147–154 | the live sentence stream construction |
| 156–159 | `sessionRef` and its comment |
| 161–166 | `startLive` |
| 168–193 | `stopLive` and its comment block |
| 278–287 | `playThinkingSound` and its comment |
| 289–358 | `playPathBReflections` and its comment block |

Returns exactly:

```js
{ startLive, stopLive, release, sendAudio, playPathBReflections, markClick }
```

- `release()` — calls `reflectionRef.current.release()` (needed by line 232)
- `sendAudio(chunk)` — calls `liveRef.current.sendAudio(chunk)` (needed by line 197)
- `markClick(t)` — see §6.2. This is the one genuinely new function in the job.

Imports it needs: `createReflectionStream`, `createLiveSentenceStream`,
`nextThinkingSound`, `playMurmur`, `REFLECTION_VOICE`, `debug`, and
`synthesizeSpeech` from the new `../services/tts`.

### `src/hooks/useTurn.js`

Signature: `export function useTurn({ settings })`

| Lines | What |
|---|---|
| 98–100 | `appState`, `errorMsg`, `micError` |
| 102–104 | `audioRef`, `audioUrlRef`, `abortRef` |
| 119 | `useConversation` |
| 195–198 | `useAudioCapture` |
| 200–236 | the mount effect, including the eslint-disable on line 236 |
| 238–250 | `stopAudio` |
| 252–262 | `handleMicError` |
| 264–276 | `speakError` |
| 360–536 | `handleSpeakAporius` |
| 538–549 | `handleListenAporius` |
| 551–560 | `restartListening` |
| 587–593 | the body of the error-overlay click handler, as a new `dismissError` — see §6.3 |

Returns exactly:

```js
{ appState, errorMsg, micError, handleSpeakAporius, handleListenAporius, dismissError }
```

Imports it needs: `useAudioCapture`, `useConversation`, `withRetry`, `isOnline`,
`sendToAI`, `synthesizeSpeech` (from the new `../services/tts`),
`speakWithBrowserTTS`, `primeThinkingSounds`, `LISTENING_STATES`, `debug`, and
`useReflections`.

### `src/components/screens/MainScreenView.jsx`

| Lines | What |
|---|---|
| 570–614 | the JSX |

Props, exactly these ten:

```
statue, isListening, isSpinning, errorMsg, showTapToReturn,
onOpenHistory, onOpenSettings, onSpeak, onListen, onDismissError
```

Imports `LaurelWreath` and `HistoryScroll` (currently lines 2–3). It imports
nothing else and holds no state, no refs, and no effects.

Two substitutions inside the JSX:

- Line 587–593's inline handler becomes `onClick={onDismissError}`.
- Line 596's `appState === 'ERROR' && !micError` becomes `showTapToReturn`.

### `src/components/screens/MainScreen.jsx` (rewritten)

Keeps its current signature (line 97):
`export default function MainScreen({ settings, onOpenHistory, onOpenSettings })`

It calls `useTurn({ settings })`, computes the derived values from lines 563–568
plus `showTapToReturn`, and renders `MainScreenView`. Nothing else. It should end
up around 30–40 lines.

Note that `isThinking` (line 564) is **not** dead — it feeds `isSpinning` on line
566. Keep both.

---

## 6. The three seams

### 6.1 The abort switch

One boolean ref, `abortRef`, currently means "drop everything." It is written by
the turn flow (lines 202, 230, 364, 540, 547) and read by the reflection playback
loop (lines 309, 345).

**`useTurn` owns it. It creates the ref and passes it into `useReflections` as a
parameter. `useReflections` only ever reads `abortRef.current` — it must never
write to it.**

Do not create a second flag. Do not replace this with a callback or an event. The
arrangement is deliberately identical to today's, just crossing a file boundary.

### 6.2 The timing probe

The debug probe measuring click-to-first-murmur is written on **both** sides:
stamped on button press (turn flow, lines 369–371) and zeroed on restart
(reflection side, line 162), then read on the reflection side.

Because the reflection side both reads and writes it, it cannot be lent read-only
the way the abort switch is. So:

**`useReflections` owns all three probe refs.** `useTurn` signals the click by
calling `markClick(listenStart)`, which does exactly what lines 369–371 do today:

```js
const markClick = (t) => {
  clickAtRef.current = t
  firstReadyLoggedRef.current = false
  firstPlayLoggedRef.current = false
}
```

`useTurn` still computes `listenStart` itself at line 368, because it also uses
that value for its own log on line 424.

### 6.3 The error dismissal

Lines 587–593 currently put logic inside the JSX: check the state, then clear the
message, clear the mic error, and restart listening. That logic moves into
`useTurn` as `dismissError`, keeping the `if (appState === 'ERROR')` guard
**inside** the function. The view calls it unconditionally.

---

## 7. Hazards

These will bite you if you are careless. They are the reason this is a map and
not a free hand.

1. **Declaration order matters.** Several functions reference ones declared
   further down: the mount effect (line 224) calls `handleMicError` (line 253);
   the effect's cleanup (line 234) calls `stopAudio` (line 239);
   `handleSpeakAporius` (line 410) calls `restartListening` (line 552). These are
   `const` arrow functions, so they are not hoisted — this only works because
   they are *called* later than they are *defined*, at runtime. **Preserve the
   relative order of every declaration inside `useTurn`.** Reordering them will
   throw at runtime in ways the tests may not catch.

2. **`useReflections` must be called before `useAudioCapture` inside `useTurn`**,
   because `onAudioChunk` (line 197) closes over the live stream.

3. **Keep the lazy-init pattern exactly as written.** Lines 123–124 and 148–149
   use `if (!ref.current) { ref.current = create(...) }`. Do not convert this to
   `useMemo`, `useState`, or a `useEffect`. The current form runs during render
   and the tests depend on that timing.

4. **Keep the empty dependency array and its eslint-disable comment** on line 236
   exactly as they are. The effect deliberately runs once.

5. **Settings are captured at first render** inside the stream constructors
   (lines 126–127, 130–131, 151). That is existing behaviour. Do not add
   dependency arrays or refs to "fix" it.

6. **Destructure the reflection hook's return** so call sites stay literally
   unchanged:
   ```js
   const { startLive, stopLive, release, sendAudio, playPathBReflections, markClick } =
     useReflections({ settings, abortRef })
   ```
   Every existing call to `startLive()`, `stopLive()`, and
   `playPathBReflections(...)` then reads exactly as it does today. Line 232's
   `reflectionRef.current.release()` becomes `release()`; line 197's
   `liveRef.current.sendAudio(chunk)` becomes `sendAudio(chunk)`.

7. **The tests mock ten modules by path** — `useAudioCapture`, `useConversation`,
   `claude`, `groq`, `deepgram`, `reflectionStream`, `thinkingSounds`,
   `murmurPlayer`, `googleTTS`, `elevenlabs`. **None of these move in this job.**
   Your new files are unmocked and will run for real, calling down into those
   mocks. That is precisely why the frozen tests still work. If you find yourself
   wanting to add a mock, you have gone wrong.

---

## 8. Definition of done

All of the following, in order:

```
npm run lint     →  clean, no output
npm test         →  18 test files, 395 tests, all passing
npm run build    →  succeeds (this also syncs the dock app copy — required,
                    otherwise there is nothing for the user to test)
```

`src/components/screens/MainScreen.test.jsx` must be byte-identical to how you
found it. Verify with `git diff --stat` — that file must not appear.

Then **stop**. Do not commit. Report:

- the eight files and their line counts
- confirmation the test file is untouched
- anything in §5's line ranges that did not match what you found

The user then verifies by having a real conversation with the app, checking:

- murmurs begin shortly after pressing SPEAK, APORIUS!
- murmurs finish cleanly before the reply starts speaking — no overlap, no cut-off
- pressing LISTEN, APORIUS! mid-reply kills everything at once
- an interruption followed by a new turn behaves normally

None of that is covered by the test suite, which runs fully mocked with no real
microphone, network, or audio. A green run proves the logic survived; it does not
prove the audio timing did.

The user commits if satisfied.

---

## 9. Out of scope — do not do these

Recorded so they are not lost. **Every item here is explicitly forbidden in this
job.** They are separate pieces of work, each to be done on its own with a green
test run either side.

**Cleanups the split exposes**

1. `MainScreen.jsx` lines 427–428 type the storage keys `aporius_messages` and
   `aporius_summary` by hand, instead of going through `useConversation`, which
   owns them. `KnowThyself.jsx` has the same problem.
2. Three different things are called `synthesizeSpeech` — the ElevenLabs one, the
   Google one, and the fallback wrapper. Renaming the wrapper to
   `synthesizeWithFallback` would end the aliasing for good.
3. The fallback wrapper is passed *into* the thinking sounds (lines 208–216) and
   the reflection stream (lines 128–134) as a callback. Once it is a module they
   could import it directly — but that changes the wiring the tests rely on, so it
   needs its own pass.
4. `public/audio-processor.js` line 2 claims to do voice activity detection. It
   does not.
5. `src/services/googleTTS.js` line 2 claims an `en-GB-Wavenet-B` British voice.
   The constant beneath it is `en-US-Neural2-D`.
6. Retire the name "Path B" from comments, debug log strings, and
   `playPathBReflections`. It refers to a Path A that was deleted, so it now names
   nothing.

**Follow-up work after this lands**

7. Replace `MainScreen.test.jsx` with tests matching the new shape — but keep some
   whole-journey tests among them. Per-file tests cannot cover a complete turn
   running in order, which is what those 62 currently do.
8. Reconsider seam 6.1: whether each file should own its own stop switch rather
   than the reflection side reading the turn flow's. Cleaner in principle,
   deliberately not done here because it is a redesign, not a move.
9. Update `docs/tech-spec.md` §16. Two bullets go stale the moment this lands:
   the one saying `MainScreen.jsx` is 615 lines, and the one claiming the retry
   timeouts, the `stopLive` session guard, and the Deepgram fan-out have no test —
   they are covered at `MainScreen.test.jsx:888`, `:945`, and `:990`. The test
   count in §16 is also out of date: it says 380, the suite has 395.
