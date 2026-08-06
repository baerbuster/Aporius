# Aporius

A voice-only philosophical interlocutor. You talk out loud to a Greek philosopher who lives in a browser tab, and he answers in a voice.

---

## The problem this is actually built around

An LLM takes seconds to answer. In text that's a spinner. In a voice conversation it's dead air — and dead air after someone has just finished saying something difficult reads as *nobody is there.*

So Aporius doesn't wait in silence. While he's thinking, **he murmurs your own sentences back at you, in his own voice** — turned into second person, ranked by how substantial they were, most substantial first, with half-vocalised thinking sounds between them.

> You say: *"I keep starting things and abandoning them, and I don't know if that's fear or just boredom."*
>
> While Claude is still thinking, you hear, quietly, in his voice: *"...Hmmm... you keep starting things and abandoning them... you don't know if that's fear or just boredom."*
>
> Then he answers.

Everything architecturally unusual in this codebase exists to serve that one effect.

## How a turn works

Two independent speech-to-text pipelines run off the same microphone, and they race.

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
   plays after the murmurs finish
```

The left pipeline is the conversation. The right pipeline is the murmurs. They share only the raw audio chunks, and neither waits on the other.

**The race is the design.** Fast reply, few murmurs. Slow reply, more murmurs. The first clip always plays, so a turn never opens in silence — and if nothing has rendered yet, a pre-rendered thinking sound covers exactly that gap.

Full mechanism — the validation guard, the two serial queues, the profundity-gap rule, Deepgram's flush-on-close — is in **[docs/tech-spec.md](docs/tech-spec.md)**.

## Running it

Node 18+ (the `.mjs` harnesses need global `fetch`).

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | |
|---|---|
| `npm run dev` | dev server; also serves the prompt bench at `/tools/debug.html` |
| `npm run build` | production build, then syncs it to the macOS Dock app |
| `npm run build:phone` | full PWA — installable, offline |

It normally runs as a **local macOS Dock app**, not a website — see [docs/dock-app.md](docs/dock-app.md). There is no server and no backend. Every API call goes from your browser straight to the provider with your own key.

## You need five API keys

There's no hosted version and no shared key. On first run you land on a settings screen asking for all five, and the app won't start without them. Here's what each one is actually for:

| Provider | Does what | Notes |
|---|---|---|
| **Groq** | Whisper `large-v3-turbo` — transcribes your finished thought | Generous free tier |
| **Deepgram** | `nova-3` streaming — hears you *as you speak*, feeds the murmurs | Free credit on signup. Leave this out and the whole reflection half is silently dead |
| **Anthropic** | The reply (Opus 4.6) **and** every reflection (Haiku 4.5) | One key, three paths. See cost below |
| **ElevenLabs** | His voice | The main recurring cost, billed per character |
| **Google Cloud TTS** | Fallback voice, only when ElevenLabs quota runs out | Effectively free at this volume |

**On cost.** Anthropic list prices are $5/$25 per million tokens for Opus 4.6, $1/$5 for Haiku 4.5, and $3/$15 for Sonnet 4.6 (used only for summarisation). The reply is capped at 300 output tokens, so per-turn LLM cost is small — but note that **one turn fires 5–7 Haiku calls**, one per sentence you spoke, each carrying a ~2,000-token system prompt. That's the token line item people don't expect.

In practice **ElevenLabs dominates**, because the reflection stage renders every ranked sentence to audio whether or not it ends up playing. Check current pricing with each provider before a long session; this is a personal-scale app, not a free one.

## Design decisions that look like mistakes

Three things a reviewer flags on sight. All three are deliberate.

**`anthropic-dangerous-direct-browser-access: true`** appears in two files. This app has no backend by design — it's served locally, it talks to Anthropic with *your* key, and there is no third party who could ever be exposed to it. The header is the correct trade-off for that shape. It would not be acceptable in a hosted, multi-user product.

**API keys are stored in plaintext `localStorage`.** Same reasoning: the trust boundary here is identical to a `.env` file on the same machine. Nobody else's keys are involved and nothing leaves the device except calls to the five providers whose keys they are.

**The ElevenLabs voice ID is hardcoded and is not a setting.** "The Highland Sage" isn't a preference, it's the character — the same category as the persona prompt. Five keys are configurable and the voice isn't, on purpose.

One more, in the other direction: **trace logging is off by default** (`localStorage.setItem('aporius_debug', '1')` turns it on). Not tidiness — those logs print your transcript, every reflected sentence, and the full ranked list. For an app people use to think out loud about their lives, that's the most private content in the system, and it doesn't go to the console unless somebody asks for it.

## Layout

```
src/
  components/screens/   Splash, Main, KnowThyself, ConversationHistory, PonderThis
  services/             deepgram · groq · claude · elevenlabs · googleTTS
                        reflectionStream · thinkingSounds · murmurPlayer
                        reflection-prompt · aporius-prompt   ← single sources
  hooks/                useAudioCapture · useConversation
public/audio-processor.js   AudioWorklet — resamples to 16kHz
tools/debug.html            prompt-tuning bench (dev server only)
reflection-bias-test/       research log — see below
docs/                       tech spec, original design doc, dock app
```

**`reflection-bias-test/` is a research log, not a test suite.** Fourteen harnesses that need live keys and make real paid calls; they're the instrument the reflection prompt was converged with over ten rounds. Good work, wrong category — don't mistake them for tests.

## Status

Personal project, actively used. Honest gaps, also recorded in [tech-spec.md §16](docs/tech-spec.md):

- **No automated tests yet.** No framework, no CI.
- `MainScreen.jsx` is 615 lines and owns more than it should.
- No linter configured.

And one that no test suite would ever cover: whether a "hmmm" lands in a natural place, whether the pause feels like thinking, whether what he says back is any good. That stays a listening judgement.
