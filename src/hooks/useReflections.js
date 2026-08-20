import { useRef } from 'react'
import { REFLECTION_VOICE } from '../services/elevenlabs'
import { createLiveSentenceStream } from '../services/deepgram'
import { createReflectionStream } from '../services/reflectionStream'
import { next as nextThinkingSound } from '../services/thinkingSounds'
import { playMurmur } from '../services/murmurPlayer'
import { synthesizeSpeech } from '../services/tts'
import { debug } from '../log'

// A profundity gap wider than this earns a beat of thought between the two clips.
// 0 = a sound between every clip; a large number = openers only.
const THINKING_SOUND_GAP = 1

export function useReflections({ settings, abortRef }) {
  // ── Path B timing probe ─────────────────────────────────
  // clickAtRef is stamped the instant "SPEAK, APORIUS!" is pressed and zeroed
  // when listening restarts, so a straggler clip landing in the NEXT turn can't
  // be measured against the previous turn's click. Two logs, each once per turn:
  //   READY   — a clip existed to play (fires even when playback found none)
  //   PLAYING — play() was actually called on the first clip
  // When Path B bails, only READY fires, and its number is the gap that bail cost.
  const clickAtRef = useRef(0)
  const firstReadyLoggedRef = useRef(false)
  const firstPlayLoggedRef = useRef(false)

  const sinceClick = () => ((performance.now() - clickAtRef.current) / 1000).toFixed(2)

  // ── Stage 2: LLM reflection stream (one Claude Haiku call per sentence),
  //    then Stage 2b: one TTS render per reflection, on its own serial queue.
  const reflectionRef = useRef(null)
  if (!reflectionRef.current) {
    reflectionRef.current = createReflectionStream({
      apiKey: settings.claudeKey,
      userName: settings.name,
      synthesize: (text) =>
        synthesizeSpeech({
          elevenLabsKey: settings.elevenLabsKey,
          googleTTSKey: settings.googleTTSKey,
          text,
          voiceSettings: REFLECTION_VOICE,
        }),
      onReflected: (entry) =>
        debug(`[Reflect ${entry.index}] p=${entry.profundity} "${entry.reflected}"`),
      onAudioReady: (entry) => {
        debug(`[Reflect ${entry.index}] audio ready, p=${entry.profundity}`)
        if (clickAtRef.current && !firstReadyLoggedRef.current) {
          firstReadyLoggedRef.current = true
          debug(`[Path B] first clip READY ${sinceClick()}s after click`)
        }
      },
    })
  }

  // ── Stage 1: live sentence list (murmur side, independent of Groq) ──
  const liveRef = useRef(null)
  if (!liveRef.current) {
    liveRef.current = createLiveSentenceStream({
      apiKey: settings.deepgramKey,
      onSentence: (s) => reflectionRef.current.submit(s),
    })
  }

  // Stage 2 starts with Stage 1 so the two lists reset together and stay
  // index-aligned across every turn of the conversation. sessionRef marks which
  // listening session those lists belong to.
  const sessionRef = useRef(0)

  const startLive = () => {
    clickAtRef.current = 0
    sessionRef.current++
    reflectionRef.current.start()
    liveRef.current.start().catch(() => {})
  }

  // Stage 2 is stopped only once Stage 1 has flushed, not before: Deepgram's
  // final results for the tail of the utterance arrive during that flush, and
  // marking Stage 2 as stopping first would reject them. Until then Stage 2
  // stays open and playback sits on waitForAudio, so a late sentence still
  // becomes a clip.
  //
  // Nothing else waits on the drain. Playback reads the live list, which is
  // already populated from rendering during listening; stragglers land in it
  // mid-playback and are picked up on the next pull.
  const stopLive = () => {
    const session = sessionRef.current
    liveRef.current
      .stop()
      .then(() => {
        // A new session may have started while Deepgram was flushing — stopping
        // Stage 2 now would stop the wrong turn's stream.
        if (sessionRef.current !== session) return null
        return reflectionRef.current.stop()
      })
      .then((withAudio) => {
        if (!withAudio) return
        debug('[Reflection list]', reflectionRef.current.getReflections())
        debug('[Reflection list — with audio]', withAudio)
      })
      .catch(() => {})
  }

  // ── One thinking sound, if the pool has rendered ────────
  // Cached, so this is instant. `label` is logged before playback starts, so the
  // timing reads as the moment sound began rather than the moment it ended.
  const playThinkingSound = async (label) => {
    const url = nextThinkingSound()
    if (!url) return false
    if (label) debug(`[Path B] ${label} ${sinceClick()}s after click`)
    await playMurmur(url)
    return true
  }

  // ── Path B reflection: play the clips rendered while listening ──
  // Starts the instant the button is pressed, alongside transcription — the
  // clips were rendered from Deepgram's sentences while the user spoke, so the
  // top of the ranked list is already playable and nothing here needs the
  // transcript.
  //
  // The list is re-read before every clip rather than snapshotted, so a straggler
  // that renders mid-playback is in contention for the next slot at its true rank.
  // URLs are not revoked here — the stream owns them and releases them on the
  // next start().
  const playPathBReflections = async (isClaudeDone, claudeDonePromise) => {
    const played = new Set()
    let first = true
    let lastProfundity = null

    // Always open with a thinking sound. It runs before the first list read, so
    // it covers exactly the window where nothing has rendered yet — the reason a
    // short utterance used to start in silence.
    await playThinkingSound('opener PLAYING')

    while (!abortRef.current) {
      const next = reflectionRef.current
        .getAudioReflections()
        .find((e) => !played.has(e.index))

      if (!next) {
        // Empty right now doesn't mean empty for good — a render may be in
        // flight. Block on the stream's own signal rather than giving up, and
        // race it against Claude so a finished response is never held up by a
        // clip that hasn't landed. waitForAudio resolves false once both stages
        // drain, which is the only way we learn no clip is ever coming.
        if (isClaudeDone()) break
        const arrived = await Promise.race([
          reflectionRef.current.waitForAudio(),
          claudeDonePromise.then(() => false),
        ])
        if (!arrived) {
          if (first) debug('[Path B] no clip to play')
          break
        }
        continue
      }
      // The first clip always plays. Beyond that, only keep going while Claude
      // is still thinking.
      if (!first && isClaudeDone()) break

      // A wide swing in profundity gets a beat of thought between the clips.
      // Absolute difference, not a signed drop: the list is sorted descending so
      // consecutive picks usually fall, but a late high scorer can jump to the
      // top mid-playback and make the next step an upward one.
      if (
        lastProfundity !== null &&
        Math.abs(lastProfundity - next.profundity) > THINKING_SOUND_GAP
      ) {
        debug(`[Path B] gap ${lastProfundity}→${next.profundity}, thinking`)
        await playThinkingSound()
        if (abortRef.current) break
      }

      played.add(next.index)
      if (!firstPlayLoggedRef.current) {
        firstPlayLoggedRef.current = true
        debug(`[Path B] first clip PLAYING ${sinceClick()}s after click`)
      }
      debug(`[Path B] playing p=${next.profundity} "${next.reflected}"`)
      await playMurmur(next.audio.url)
      lastProfundity = next.profundity
      first = false
    }
  }

  const release = () => reflectionRef.current.release()

  const sendAudio = (chunk) => liveRef.current.sendAudio(chunk)

  const markClick = (t) => {
    clickAtRef.current = t
    firstReadyLoggedRef.current = false
    firstPlayLoggedRef.current = false
  }

  return { startLive, stopLive, release, sendAudio, playPathBReflections, markClick }
}
