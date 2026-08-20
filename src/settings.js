// Settings storage — the one place that knows where settings live.
//
// The name and the five API keys are held in localStorage under a single JSON
// blob. Before this module, App.jsx and ConversationHistory.jsx each declared
// their own SETTINGS_KEY and their own read-and-do-not-crash wrapper, so the key
// name existed twice and renaming it meant remembering both.
//
// Nothing else should reference 'aporius_settings' directly — import from here.
//
// The two conversation keys live here as well, for the same reason: they were
// spelled out by hand in four other files, and one of those kept a second copy
// of the name. The *behaviour* around conversation state still belongs to
// hooks/useConversation.js — only the key names are here. They sit in this file
// rather than with their owner because the test suite replaces that hook
// wholesale, which would leave anything importing the names from it holding
// undefined.

const SETTINGS_KEY = 'aporius_settings'

export const MESSAGES_KEY = 'aporius_messages'
export const SUMMARY_KEY = 'aporius_summary'

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
