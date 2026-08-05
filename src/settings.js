// Settings storage — the one place that knows where settings live.
//
// The name and the five API keys are held in localStorage under a single JSON
// blob. Before this module, App.jsx and ConversationHistory.jsx each declared
// their own SETTINGS_KEY and their own read-and-do-not-crash wrapper, so the key
// name existed twice and renaming it meant remembering both.
//
// Nothing else should reference 'aporius_settings' directly — import from here.
//
// Conversation state (aporius_messages / aporius_summary) is deliberately NOT
// handled here. It has its own owner in hooks/useConversation.js, though raw
// string literals for those keys still appear in MainScreen.jsx and
// KnowThyself.jsx.

const SETTINGS_KEY = 'aporius_settings'

// Missing or corrupt storage yields an empty object rather than throwing, so a
// first run and a mangled blob both land on the settings screen instead of a
// white page.
export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch {
    return {}
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

// The display name, with the fallback the history screen has always used.
export function loadName() {
  return loadSettings().name || 'Seeker'
}
