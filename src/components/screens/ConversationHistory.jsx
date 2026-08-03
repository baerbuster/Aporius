import { useEffect, useRef } from 'react'

const MESSAGES_KEY = 'aporius_messages'
const SETTINGS_KEY = 'aporius_settings'

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(MESSAGES_KEY)) || []
  } catch {
    return []
  }
}

function loadName() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY))?.name || 'Seeker'
  } catch {
    return 'Seeker'
  }
}

// Pair up messages into turns: [user, assistant] pairs
function buildTurns(messages) {
  const turns = []
  for (let i = 0; i < messages.length; i += 2) {
    const user = messages[i]
    const aporius = messages[i + 1]
    if (user) turns.push({ user: user.content, aporius: aporius?.content })
  }
  return turns
}

export default function ConversationHistory({ onBack }) {
  const messages = loadMessages()
  const name = loadName()
  const turns = buildTurns(messages)
  const bottomRef = useRef(null)

  // Auto-scroll to bottom (most recent) on open
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [])

  const handleShare = async () => {
    const text =
      turns
        .flatMap((t) => [
          t.user ? `${name}: ${t.user}` : null,
          t.aporius ? `Aporius: ${t.aporius}` : null,
        ])
        .filter(Boolean)
        .join('\n\n') || 'No conversation yet.'

    const shareData = {
      title: `${name} by Aporius`,
      text,
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // user cancelled or not supported
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(text).catch(() => {})
    }
  }

  return (
    <div className="screen history">
      {/* Top bar */}
      <div className="history__topbar">
        <button className="screen__back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="history__spacer" />
        <button className="history__share-btn" onClick={handleShare} aria-label="Share">
          ↑
        </button>
      </div>

      {/* Header */}
      <div className="history__header">
        <h1 className="history__name">{name}</h1>
        <p className="history__by">by Aporius</p>
        <p className="history__translated">Translated by North Star Intelligences</p>
      </div>

      <div className="divider" />

      {/* Dialogue */}
      <div className="history__scroll">
        {turns.length === 0 ? (
          <p className="history__empty">The scroll is empty. Begin your inquiry.</p>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className="history__turn">
              {turn.user && (
                <p>
                  <span className="history__speaker">{name}:</span> {turn.user}
                </p>
              )}
              {turn.aporius && (
                <p style={{ marginTop: turn.user ? '8px' : 0 }}>
                  <span className="history__speaker">Aporius:</span> {turn.aporius}
                </p>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
