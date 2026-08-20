import { useTurn } from '../../hooks/useTurn'
import { LISTENING_STATES, THINKING_STATES, statueForState } from './mainScreenStates'
import MainScreenView from './MainScreenView'

// ─── Main component ────────────────────────────────────────

export default function MainScreen({ settings, onOpenHistory, onOpenSettings }) {
  const { appState, errorMsg, micError, handleSpeakAporius, handleListenAporius, dismissError } =
    useTurn({ settings })

  // ── Derive visual screen ────────────────────────────────
  const isListening = LISTENING_STATES.has(appState)
  const isThinking = THINKING_STATES.has(appState)
  const isSpeaking = appState === 'PLAYING_AUDIO'
  const isSpinning = isThinking || isSpeaking

  const statue = statueForState(appState)

  const showTapToReturn = appState === 'ERROR' && !micError

  return (
    <MainScreenView
      statue={statue}
      isListening={isListening}
      isSpinning={isSpinning}
      errorMsg={errorMsg}
      showTapToReturn={showTapToReturn}
      onOpenHistory={onOpenHistory}
      onOpenSettings={onOpenSettings}
      onSpeak={handleSpeakAporius}
      onListen={handleListenAporius}
      onDismissError={dismissError}
    />
  )
}
