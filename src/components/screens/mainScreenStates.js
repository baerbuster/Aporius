// ─── App states ────────────────────────────────────────────
// Listening screen: IDLE, BUFFERING
// Thinking screen:  WAITING_FOR_TRANSCRIPT, REFLECTING, SYNTHESIZING_SPEECH, ERROR
// Speaking screen:  PLAYING_AUDIO

export const LISTENING_STATES = new Set(['IDLE', 'BUFFERING'])
export const THINKING_STATES = new Set([
  'WAITING_FOR_TRANSCRIPT',
  'REFLECTING',
  'SYNTHESIZING_SPEECH',
  'ERROR',
])

// ─── Statue images per state ───────────────────────────────
export function statueForState(appState) {
  if (appState === 'PLAYING_AUDIO') return '/exclaimer.png'
  if (THINKING_STATES.has(appState)) return '/thinker.png'
  return '/listener.png'
}
