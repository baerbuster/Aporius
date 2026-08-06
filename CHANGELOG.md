# Changelog

Aporius was built between February and August 2026, but it only entered git on
2026-08-03 — as a single squashed commit of the finished application. The commit
history therefore shows none of how it was made.

This file is that record, reconstructed from dated artifacts: the surviving design
documents, file timestamps, working notes, and the frozen research harnesses still in
`reflection-bias-test/`. **Where a date is inferred rather than recorded, it says so.**
Nothing here is invented to fill a gap; where the record is thin, it stays thin.

Current version: **0.1.0** — not a stable release.

---

## February 2026 — it started as something else

The project began as **LETME**, a plain voice chat app: microphone in, speech-to-text,
chatbot, text-to-speech, back out to your ear. Two buttons — **SEND** to submit, and
**LETME** to interrupt.

Three artifacts survive, kept in [`docs/diagrams/`](docs/diagrams/): the system flow
diagram, the state diagram, and the state-transition table (dated 2026-02-04, the
earliest dated thing in the project).

Nothing of LETME's architecture remains. One thing does: the **LETME** button — the one
that stops the machine talking and puts you straight back to being heard — survives
today as **LISTEN, APORIUS!**

## March 2026 — Aporius designed, then built

A full design document was written before implementation:
[`docs/original-design.md`](docs/original-design.md), preserved unedited. It specifies
AssemblyAI streaming speech-to-text, Google Cloud TTS as the voice, three external APIs,
hosting on Vercel, and a −40 dB voice activity detector.

Almost none of that survived contact with the build. The document is kept precisely
because the distance between it and the shipped app is the clearest record of what
happened.

**Mar 4** — the skeleton: `index.html`, `main.jsx`, the splash screen, Ponder This, the
conversation store, and the four statue and background assets that still ship.

**Mar 10** — the AudioWorklet (`public/audio-processor.js`), resampling microphone input
to 16 kHz PCM, and the laurel wreath and history scroll icons as SVG components.

**Mar 14** — Google Cloud TTS wired up.

### Mar 14 — AssemblyAI abandoned, and the idea that became the murmurs

Streaming transcription was dropped for accuracy: *"bone"* came back as *"bomb"*,
*"jumps over"* as *"jump so with"*. Streaming models trade accuracy for speed, and this
app is push-to-talk — audio can be collected locally and sent as one batch when the
button is pressed, so the speed was being paid for nothing.

The replacement plan, recorded the same day, contains the first version of the idea the
whole project now rests on:

> Add reflection layer: a small model produces a brief acknowledgment
> (*"Hmm… hippopotamuses… african sahara…"*) immediately after the transcript arrives,
> played via TTS while the full response runs in parallel — masks latency entirely.

That is the murmur pipeline in embryo. It took until late July to become what it is now.

## July 2026 — the pipeline

**Jul 4** — the macOS Dock app bundle (`Aporius.app`).

**Jul 17** — the deploy pipeline. The Dock icon cannot read the Desktop project (macOS
blocks Dock-launched apps from it), so it serves a *copy* from
`~/Library/Application Support/Aporius`. `npm run build` gained an automatic sync step
so the copy can never silently go stale, and the service worker was gated behind
`build:phone` after precaching started serving yesterday's build during testing. Audio
capture was reworked the same day.

### The perspective transform, three ways

**Jul 19 — classical NLP.** The reflection stage was built with part-of-speech tagging:
`pos.js`, a `posTagger.worker.js` web worker, and the `wink-pos-tagger` dependency,
doing the pronoun swap by grammatical rule.

**Jul 22 — replaced by one LLM call per sentence.** The POS approach was deleted
entirely in favour of a single model call that does three things at once: switch the
speaker's perspective, cut filler subtractively, and score profundity 1–10.

It started on Groq's `llama-3.1-8b-instant`, which **could not do the bidirectional
pronoun swap at all** — it kept turning the addressee's "you" into "they" no matter how
many examples were added. That was a capability ceiling, not a prompt problem. Moving to
`llama-3.3-70b` fixed it.

Then the free tier ran out. One conversational turn is 5–7 sentences and therefore 5–7
calls; the daily cap was reached almost immediately. The reflection call moved to
Anthropic's `claude-haiku-4-5`, on the same key the main conversation uses.

### Jul 22–24 — the you→they bug, and what actually fixed it

On declarative second-person sentences the transform inverted the referent:
*"You are wrong about everything."* came back as *"They are wrong about everything."*
Baseline failure rate on a pure second-person set was **14 of 15**.

Four hypotheses were tested and ruled out empirically — the prompt's framing, the
ordering of the rules, the validation guard in code, and adding counter-examples. None
moved the number.

**The rules themselves were the cause.** Deleting the numbered perspective-switch rule
block — keeping only the examples — took it to **24 of 28**. The rigid pronoun-mapping
rules were teaching the very heuristic they were meant to prevent.

The last four failures were reported-speech frames (*"You promised you would change."*),
and the fix was stranger still: **deleting the profundity anchors.** They were
unlabelled example sentences belonging to a completely different task in the same
prompt, five of six in the first person, and the model was resolving the ambiguous
subject toward them. Section headings are not firewalls — it is one forward pass over
one blob of text.

The general lesson, confirmed twice in both directions: **on out-of-distribution input a
stated rule beats examples.** When a failure survives two or three rounds of added
examples, look for a rule causing it rather than adding a fourth.

### Jul 24 — the convergence loop

With the bug fixed, the prompt was tuned by a deliberate method: run ~30 unseen
sentences, take the stable failures, hand-write the correct output, paste those in
verbatim as new examples, then **burn the suite and write 30 entirely new sentences** —
because promoted sentences can no longer measure generalisation.

Stable failures per round, across ten rounds:

```
5 → 7 → 6 → 5 → 3 → 2 → 1 → 2 → 4 → 3
```

Called at round 10, ~90%, with 69 examples. One round was wasted by stacking a suite
toward a known failure class — the resulting 11 failures were not comparable to the 2
before them, and the convergence read was ruined. Suites must be constant difficulty.

The harnesses are all still in [`reflection-bias-test/`](reflection-bias-test/) —
`battery2` through `battery13`, every one burned.

**Accepted residual failures**, recorded rather than fixed: third-party pronouns pulled
into the speaker slot; long sentences summarised instead of reflected; inconsistent
`we`/`our`; quoted material transformed rather than left alone; and profundity
saturating at 9–10 on elevated prose, which collapses the ranked list into a tie.

**Jul 28** — Deepgram streaming transcription added as a second, independent pipeline:
live sentences drained on terminal punctuation while the speaker is still talking, so
the reflections can be prepared before the button is even pressed.

**Jul 29** — ElevenLabs became the voice, with Google TTS demoted to the quota fallback.
The murmur playback chain was built. **A lowpass filter was tried and cut** — muffling
the voice sounded broken rather than private; level, pace and placement do the work
instead.

The same day, the older reflection path — a regex-swap mechanism in `groq.js` — was
deleted, and the LLM stream became what you actually hear. And the whole perspective was
flipped: the speaker now maps to **you/your**, not *they/their*, with the validation
guard's allow-set swapped to match. (Change one without the other and the guard rejects
every reflection, silently.)

## August 2026

**Aug 3** — first commit. The application enters git as one squashed import of 49 files.

Its message describes the architecture as *"speech out via Google TTS"* — wrong by then,
and ElevenLabs goes unmentioned. It is baked in and cannot be corrected without
rewriting history, so the correction lives here: **ElevenLabs is the voice. Google Cloud
TTS is the fallback when ElevenLabs quota runs out.**

**Aug 5–6** — a full repository audit and cleanup, in 24 commits. The repo was flattened
to its root, spaces removed from every path, one naming convention applied throughout,
dead code and an unused dependency deleted, both duplicated prompts unified into single
modules, settings access consolidated, and trace logging put behind a runtime flag —
the last because those logs printed the user's own transcript, which is the most private
content in the system.

The March design document was split from a new as-built specification rather than
overwritten. A README was written. ESLint and Prettier were configured, Node's minimum
version stated, and the project's identity filled in — at which point the version was
corrected from `1.0.0`, which had never moved through any of the above, to **`0.1.0`**.

---

## On the accuracy of this file

**Firm:** everything dated from a working note or a design document, and every
architectural claim, which is checked against the code as it stands.

**Inferred:** the March and July day-level dates come from file modification times.
Those are real but fragile — an unrelated later edit resets one. Treat the clustering as
reliable and any individual day as approximate.

**Gone for good:** `pos.js`, `posTagger.worker.js`, and the original reflection path
were deleted before the first commit. Git never held them and no copy survives. They are
described here from working notes; the code itself is not recoverable.
