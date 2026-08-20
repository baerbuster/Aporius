import { useState, useEffect, useRef } from 'react'
import { useAudioCapture } from './useAudioCapture'
import { useConversation } from './useConversation'
import { useReflections } from './useReflections'
import { withRetry, isOnline } from '../services/retry'
import { sendToAI } from '../services/ai'
import { synthesizeSpeech } from '../services/tts'
import { speakWithBrowserTTS } from '../services/googleTTS'
import { prime as primeThinkingSounds } from '../services/thinkingSounds'
import { LISTENING_STATES } from '../components/screens/mainScreenStates'
import { debug } from '../log'

export function useTurn({ settings }) {
  const [appState, setAppState] = useState('IDLE')
  const [errorMsg, setErrorMsg] = useState(null)
  const [micError, setMicError] = useState(false)

  const audioRef = useRef(null)
  const audioUrlRef = useRef(null)
  const abortRef = useRef(false)

  const { addTurn, checkAndSummarize, refresh } = useConversation()

  const { startLive, stopLive, release, sendAudio, playPathBReflections, markClick } =
    useReflections({ settings, abortRef })

  const { startCapture, stopCaptureAndGetTranscript, cleanup } = useAudioCapture({
    groqKey: settings.groqKey,
    onAudioChunk: (chunk) => sendAudio(chunk),
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
      release()
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

  // ── Main flow: user pressed "SPEAK, APORIUS!" ───────────
  const handleSpeakAporius = async () => {
    if (!LISTENING_STATES.has(appState)) return

    abortRef.current = false
    setErrorMsg(null)
    setAppState('WAITING_FOR_TRANSCRIPT')

    const listenStart = performance.now()
    markClick(listenStart)

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

  const dismissError = () => {
    if (appState === 'ERROR') {
      setErrorMsg(null)
      setMicError(false)
      restartListening()
    }
  }

  return { appState, errorMsg, micError, handleSpeakAporius, handleListenAporius, dismissError }
}
