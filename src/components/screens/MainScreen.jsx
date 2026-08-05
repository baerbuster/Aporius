import { useState, useEffect, useRef, useCallback } from 'react'
import LaurelWreath from '../icons/LaurelWreath'
import HistoryScroll from '../icons/HistoryScroll'
import { useAudioCapture } from '../../hooks/useAudioCapture'
import { useConversation } from '../../hooks/useConversation'
import { sendToClaude } from '../../services/claude'
import { sendToGroq } from '../../services/groq'
import {
  synthesizeSpeech as elevenLabsSynthesize,
  ElevenLabsQuotaError,
  REFLECTION_VOICE,
} from '../../services/elevenlabs'
import { synthesizeSpeech as googleSynthesize, base64ToAudioBlob, speakWithBrowserTTS } from '../../services/googleTTS'
import { createLiveSentenceStream } from '../../services/deepgram'
import { createReflectionStream } from '../../services/reflectionStream'
import {
  prime as primeThinkingSounds,
  next as nextThinkingSound,
} from '../../services/thinkingSounds'
import { playMurmur } from '../../services/murmurPlayer'
import { debug } from '../../log'

// ─── App states ────────────────────────────────────────────
// Listening screen: IDLE, BUFFERING
// Thinking screen:  WAITING_FOR_TRANSCRIPT, REFLECTING, SYNTHESIZING_SPEECH, ERROR
// Speaking screen:  PLAYING_AUDIO

// A profundity gap wider than this earns a beat of thought between the two clips.
// 0 = a sound between every clip; a large number = openers only.
const THINKING_SOUND_GAP = 1

const LISTENING_STATES = new Set(['IDLE', 'BUFFERING'])
const THINKING_STATES = new Set([
  'WAITING_FOR_TRANSCRIPT',
  'REFLECTING',
  'SYNTHESIZING_SPEECH',
  'ERROR',
])

// ─── Helpers ───────────────────────────────────────────────

async function withRetry(fn, maxRetries, timeoutMs) {
  let lastErr
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out')), timeoutMs),
        ),
      ])
    } catch (err) {
      lastErr = err
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }
  throw lastErr
}

function isOnline() {
  return navigator.onLine
}

// ─── LLM routing: Claude or Groq based on model ────────────
function sendToAI({ claudeKey, groqKey, model, messages, summary }) {
  if (model.startsWith('llama')) {
    return sendToGroq({ apiKey: groqKey, model, messages, summary })
  }
  return sendToClaude({ apiKey: claudeKey, model, messages, summary })
}

// ─── TTS: ElevenLabs → Google fallback ─────────────────────
async function synthesizeSpeech({ elevenLabsKey, googleTTSKey, text, voiceSettings }) {
  try {
    const blob = await elevenLabsSynthesize({ apiKey: elevenLabsKey, text, voiceSettings })
    return { blob, url: URL.createObjectURL(blob) }
  } catch (err) {
    if (!(err instanceof ElevenLabsQuotaError)) throw err
    console.warn('[TTS] ElevenLabs quota exceeded, falling back to Google TTS')
    const base64 = await googleSynthesize({ apiKey: googleTTSKey, text })
    const blob = base64ToAudioBlob(base64)
    return { blob, url: URL.createObjectURL(blob) }
  }
}

// ─── Statue images per state ───────────────────────────────
function statueForState(appState) {
  if (appState === 'PLAYING_AUDIO') return '/exclaimer.png'
  if (THINKING_STATES.has(appState)) return '/thinker.png'
  return '/listener.png'
}

// ─── Main component ────────────────────────────────────────

export default function MainScreen({ settings, onOpenHistory, onOpenSettings }) {
  const [appState, setAppState] = useState('IDLE')
  const [errorMsg, setErrorMsg] = useState(null)
  const [micError, setMicError] = useState(false)

  const audioRef = useRef(null)
  const audioUrlRef = useRef(null)
  const abortRef = useRef(false)

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

  const { addTurn, checkAndSummarize, refresh } = useConversation()

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

  const { startCapture, stopCaptureAndGetTranscript, cleanup } = useAudioCapture({
    groqKey: settings.groqKey,
    onAudioChunk: (chunk) => liveRef.current.sendAudio(chunk),
  })

  // ── Mount: start mic ────────────────────────────────────
  useEffect(() => {
    abortRef.current = false
    refresh()

    // Render the thinking sounds once per app open, in the background. The
    // singleton makes this free on remount, so revisiting settings or history
    // costs nothing. Never released here — these clips are app-lifetime.
    primeThinkingSounds({
      synthesize: (text, voiceSettings) =>
        synthesizeSpeech({
          elevenLabsKey: settings.elevenLabsKey,
          googleTTSKey: settings.googleTTSKey,
          text,
          voiceSettings,
        }),
    })

    const init = async () => {
      try {
        startLive()
        await startCapture()
        setAppState('BUFFERING')
      } catch (err) {
        handleMicError(err)
      }
    }
    init()

    return () => {
      abortRef.current = true
      stopLive()
      reflectionRef.current.release()
      cleanup()
      stopAudio()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop any playing audio ──────────────────────────────
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }

  // ── True mic error (permission denied, device unavailable) ─
  const handleMicError = (err) => {
    console.error('Mic error:', err)
    setMicError(true)
    setErrorMsg(
      "I can't hear you! You'll have to change your mic permissions! " +
      `[diag: ${err?.name || 'Unknown'} — ${err?.message || String(err)}]`
    )
    speakWithBrowserTTS("I can't hear you! You'll have to change your mic permissions!", () => {})
    setAppState('ERROR')
  }

  // ── Speak an error message ──────────────────────────────
  const speakError = async (text) => {
    setErrorMsg(text)
    if (!isOnline()) { speakWithBrowserTTS(text, () => {}); return }
    try {
      const { url } = await synthesizeSpeech({ elevenLabsKey: settings.elevenLabsKey, googleTTSKey: settings.googleTTSKey, text })
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.play().catch(() => speakWithBrowserTTS(text, () => {}))
    } catch {
      speakWithBrowserTTS(text, () => {})
    }
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

  // ── Main flow: user pressed "SPEAK, APORIUS!" ───────────
  const handleSpeakAporius = async () => {
    if (!LISTENING_STATES.has(appState)) return

    abortRef.current = false
    setErrorMsg(null)
    setAppState('WAITING_FOR_TRANSCRIPT')

    const listenStart = performance.now()
    clickAtRef.current = listenStart
    firstReadyLoggedRef.current = false
    firstPlayLoggedRef.current = false

    // ── 1. Stop mic ────────────────────────────────────────
    stopLive()

    // ── 2. Reflections start NOW ───────────────────────────
    // In parallel with transcription, not after it. The clips are already
    // rendered and none of this needs the transcript — that dependency belonged
    // to Path A, which is gone. claudeDone doubles as the stop signal: the
    // boolean for the loop's checks, the promise so a waiting loop can be woken
    // the instant the response lands.
    let claudeDone = false
    let signalClaudeDone
    const claudeDonePromise = new Promise((r) => { signalClaudeDone = r })
    const markClaudeDone = () => { claudeDone = true; signalClaudeDone() }

    setAppState('REFLECTING')
    const reflectionPromise = playPathBReflections(() => claudeDone, claudeDonePromise)

    // Reflections now outlive the step that starts them, so every exit below
    // has to stop the loop and let the current clip finish — otherwise its
    // audio plays over whatever comes next.
    const finishReflections = async () => {
      markClaudeDone()
      await reflectionPromise
    }

    // ── 3. Transcribe (concurrent with the reflections above) ──
    let transcript = ''
    try {
      transcript = await stopCaptureAndGetTranscript()
    } catch (err) {
      console.error('STT error:', err)
      await finishReflections()
      await speakError("I didn't quite catch that, could you repeat yourself?")
      setAppState('ERROR')
      setTimeout(async () => {
        if (abortRef.current) return
        setErrorMsg(null)
        await restartListening()
      }, 2000)
      return
    }

    if (abortRef.current) return

    if (!transcript.trim()) {
      await finishReflections()
      await restartListening()
      return
    }

    debug('[Transcript → Claude]', transcript)
    debug(`[Listen stage] ${((performance.now() - listenStart) / 1000).toFixed(2)}s`)

    // ── 4. Fire Claude immediately in background ───────────
    const currentMessages = JSON.parse(localStorage.getItem('aporius_messages') || '[]')
    const currentSummary = localStorage.getItem('aporius_summary') || ''
    const claudeMessages = [...currentMessages, { role: 'user', content: transcript }]

    const claudeStart = performance.now()
    const model = settings.model || 'claude-opus-4-6'
    const claudePromise = withRetry(
      () => sendToAI({
        claudeKey: settings.claudeKey,
        groqKey: settings.groqKey,
        model,
        messages: claudeMessages,
        summary: currentSummary,
      }),
      3,
      60000,
    )
    claudePromise.then(markClaudeDone).catch(markClaudeDone)

    // ── 5. Await Claude's result (reflections still playing) ──
    let claudeResponse = ''
    try {
      claudeResponse = await claudePromise
    } catch (err) {
      console.error('Claude error:', err)
      await finishReflections()
      await speakError("I'm sorry, my brain is foggy today. You should call Anthropic.")
      setAppState('ERROR')
      return
    }

    debug(`[Claude stage] ${((performance.now() - claudeStart) / 1000).toFixed(2)}s`)

    if (abortRef.current) return

    // ── 6. Synthesize Claude's response ───────────────────
    setAppState('SYNTHESIZING_SPEECH')
    const ttsStart = performance.now()
    let ttsResult = null
    let usedBrowserTTS = false

    try {
      ttsResult = await withRetry(
        () => synthesizeSpeech({
          elevenLabsKey: settings.elevenLabsKey,
          googleTTSKey: settings.googleTTSKey,
          text: claudeResponse,
        }),
        3,
        15000,
      )
    } catch (err) {
      console.error('TTS error:', err)
      addTurn(transcript, claudeResponse)
      await checkAndSummarize({ apiKey: settings.claudeKey, model: 'claude-sonnet-4-6' })
      setErrorMsg('Aporius has a frog in his throat. ElevenLabs TTS failure.')
      setAppState('PLAYING_AUDIO')
      await finishReflections()
      speakWithBrowserTTS(claudeResponse, async () => {
        if (abortRef.current) return
        setErrorMsg(null)
        await restartListening()
      })
      usedBrowserTTS = true
    }

    if (abortRef.current) return
    if (usedBrowserTTS) return

    // ── 7. Save turn ───────────────────────────────────────
    addTurn(transcript, claudeResponse)
    await checkAndSummarize({ apiKey: settings.claudeKey, model: 'claude-sonnet-4-6' })

    debug(`[Pre-speaking stage] ${((performance.now() - ttsStart) / 1000).toFixed(2)}s`)

    // Claude's render overlapped the tail reflection; let that clip finish
    // before speaking over it.
    await finishReflections()
    if (abortRef.current) return

    // ── 8. Play Claude's response ──────────────────────────
    setAppState('PLAYING_AUDIO')

    const { url } = ttsResult
    audioUrlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio

    audio.onended = async () => {
      stopAudio()
      if (abortRef.current) return
      await restartListening()
    }

    audio.onerror = async () => {
      console.error('Audio playback error')
      stopAudio()
      setErrorMsg('Aporius has a frog in his throat.')
      if (abortRef.current) return
      await restartListening()
    }

    audio.play().catch(async () => {
      stopAudio()
      speakWithBrowserTTS(claudeResponse, async () => {
        if (abortRef.current) return
        await restartListening()
      })
    })
  }

  // ── User pressed "LISTEN, APORIUS!" — interrupt instantly ─
  const handleListenAporius = async () => {
    abortRef.current = true
    stopAudio()
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    setErrorMsg(null)
    setMicError(false)
    stopLive()
    await cleanup()
    abortRef.current = false
    await restartListening()
  }

  // ── Restart mic ────────────────────────────────────────
  const restartListening = async () => {
    try {
      startLive() // socket opens while the mic spins up; early audio queues
      await startCapture()
      setAppState('BUFFERING')
    } catch (err) {
      handleMicError(err)
    }
  }

  // ── Derive visual screen ────────────────────────────────
  const isListening = LISTENING_STATES.has(appState)
  const isThinking = THINKING_STATES.has(appState)
  const isSpeaking = appState === 'PLAYING_AUDIO'
  const isSpinning = isThinking || isSpeaking

  const statue = statueForState(appState)

  return (
    <div className="main-screen">
      <img src="/background.jpg" alt="" className="main-screen__bg" draggable={false} />
      <img src={statue} alt="" className="main-screen__statue" draggable={false} />

      <div className="main-screen__topbar">
        <button className="main-screen__icon-btn" onClick={onOpenHistory} aria-label="Conversation History">
          <HistoryScroll size={51} />
        </button>
        <button className="main-screen__icon-btn" onClick={onOpenSettings} aria-label="Settings">
          <LaurelWreath spinning={isSpinning} size={46} />
        </button>
      </div>

      {errorMsg && (
        <div
          className="main-screen__error-overlay"
          onClick={() => {
            if (appState === 'ERROR') {
              setErrorMsg(null)
              setMicError(false)
              restartListening()
            }
          }}
        >
          {errorMsg}
          {appState === 'ERROR' && !micError && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>Tap to return</div>
          )}
        </div>
      )}

      <div className="main-screen__bottom">
        {isListening ? (
          <button className="main-screen__action-btn" onClick={handleSpeakAporius}>
            SPEAK, APORIUS!
          </button>
        ) : (
          <button className="main-screen__action-btn" onClick={handleListenAporius}>
            LISTEN, APORIUS!
          </button>
        )}
      </div>
    </div>
  )
}
