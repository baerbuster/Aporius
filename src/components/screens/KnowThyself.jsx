import { useState } from 'react'

export default function KnowThyself({ settings, onSave, onBack }) {
  const [form, setForm] = useState({
    name: settings.name || '',
    groqKey: settings.groqKey || '',
    claudeKey: settings.claudeKey || '',
    elevenLabsKey: settings.elevenLabsKey || '',
    googleTTSKey: settings.googleTTSKey || '',
    deepgramKey: settings.deepgramKey || '',
    model: settings.model || 'claude-opus-4-6',
  })

  const [showBraindrain, setShowBraindrain] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSave = () => {
    onSave(form)
  }

  const handleBraindrainConfirm = () => {
    localStorage.removeItem('aporius_summary')
    localStorage.removeItem('aporius_messages')
    setShowBraindrain(false)
  }

  return (
    <div className="screen settings">
      {/* Header */}
      <div className="settings__header">
        <button className="screen__back" onClick={onBack} aria-label="Back">
          ←
        </button>
      </div>

      <div className="divider" />
      <h1 className="settings__title">Know Thyself</h1>
      <div className="divider" />

      {/* Fields */}
      <div className="settings__body">
        <div className="settings__field">
          <label className="settings__label">Who seeks wisdom? [Name]</label>
          <input
            className="settings__input"
            type="text"
            placeholder="Your name"
            value={form.name}
            onChange={set('name')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label">
            By what right can you hear? [Groq API Key]
          </label>
          <input
            className="settings__input"
            type="password"
            placeholder="gsk_..."
            value={form.groqKey}
            onChange={set('groqKey')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label">
            By what right can you think? [Claude Sonnet API Key]
          </label>
          <input
            className="settings__input"
            type="password"
            placeholder="abcd..."
            value={form.claudeKey}
            onChange={set('claudeKey')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label">
            By what right can you speak? [ElevenLabs API Key]
          </label>
          <input
            className="settings__input"
            type="password"
            placeholder="sk_..."
            value={form.elevenLabsKey}
            onChange={set('elevenLabsKey')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label">
            Fallback voice [Google Cloud TTS API Key]
          </label>
          <input
            className="settings__input"
            type="password"
            placeholder="abcd..."
            value={form.googleTTSKey}
            onChange={set('googleTTSKey')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label">
            By what right can you murmur? [Deepgram API Key]
          </label>
          <input
            className="settings__input"
            type="password"
            placeholder="abcd..."
            value={form.deepgramKey}
            onChange={set('deepgramKey')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label">Model</label>
          <select
            className="settings__input"
            value={form.model}
            onChange={set('model')}
          >
            <option value="claude-opus-4-6">Claude Opus 4.6 (default)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Groq)</option>
            <option value="llama-3.1-8b-instant">Llama 3.1 8B (Groq, fastest)</option>
          </select>
        </div>

        {/* Braindrain — destructive reset */}
        <button
          className="settings__braindrain-btn"
          onClick={() => setShowBraindrain(true)}
        >
          BRAINDRAIN
        </button>
      </div>

      <div className="settings__footer">
        <button className="btn-primary" onClick={handleSave}>
          SO IT IS WRITTEN
        </button>
      </div>

      {/* Braindrain confirmation overlay */}
      {showBraindrain && (
        <div className="braindrain-overlay">
          <p>This will erase all conversation history with Aporius. It cannot be undone.</p>
          <div className="braindrain-overlay__actions">
            <button
              className="braindrain-overlay__cancel"
              onClick={() => setShowBraindrain(false)}
            >
              CANCEL
            </button>
            <button
              className="braindrain-overlay__confirm"
              onClick={handleBraindrainConfirm}
            >
              WIPE IT
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
