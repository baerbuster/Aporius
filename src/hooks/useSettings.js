import { useState, useCallback } from 'react'

const SETTINGS_KEY = 'aporius_settings'

function load() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch {
    return {}
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(load)

  const save = useCallback((newSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings))
    setSettings(newSettings)
  }, [])

  const hasAllKeys = !!(
    settings.assemblyaiKey &&
    settings.claudeKey &&
    settings.googleTTSKey
  )

  return { settings, save, hasAllKeys }
}
