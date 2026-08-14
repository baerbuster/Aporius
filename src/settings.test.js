import { describe, it, expect } from 'vitest'
import { loadSettings, saveSettings, loadName } from './settings'

// The storage key is deliberately not imported — it is module-private, and a test
// that reached for it would pass even if the app started writing somewhere else.
// Spelling the literal out here means renaming the key breaks this file, which is
// exactly the alarm you want: everything already saved would be orphaned.
const KEY = 'aporius_settings'

describe('loadSettings', () => {
  it('returns an empty object on a first run', () => {
    expect(loadSettings()).toEqual({})
  })

  it('returns what was stored', () => {
    localStorage.setItem(KEY, JSON.stringify({ name: 'Buster', claudeKey: 'sk-x' }))
    expect(loadSettings()).toEqual({ name: 'Buster', claudeKey: 'sk-x' })
  })

  it('returns an empty object rather than throwing on a mangled blob', () => {
    // The whole reason for the try/catch: a corrupt blob must land the user on
    // the settings screen, not a white page.
    localStorage.setItem(KEY, '{not json')
    expect(loadSettings()).toEqual({})
  })

  it('returns an empty object when the stored value is literal null', () => {
    // JSON.parse('null') succeeds and yields null, so the `|| {}` is doing the
    // work here rather than the catch.
    localStorage.setItem(KEY, 'null')
    expect(loadSettings()).toEqual({})
  })
})

describe('saveSettings', () => {
  it('round-trips through loadSettings', () => {
    const settings = { name: 'Buster', groqKey: 'gsk', model: 'claude-opus-4-6' }
    saveSettings(settings)
    expect(loadSettings()).toEqual(settings)
  })

  it('replaces the whole blob rather than merging into it', () => {
    saveSettings({ name: 'Buster', claudeKey: 'sk-x' })
    saveSettings({ name: 'Buster' })
    expect(loadSettings()).toEqual({ name: 'Buster' })
  })
})

describe('loadName', () => {
  it('returns the stored name', () => {
    saveSettings({ name: 'Buster' })
    expect(loadName()).toBe('Buster')
  })

  it('falls back to Seeker when nothing is stored', () => {
    expect(loadName()).toBe('Seeker')
  })

  it('falls back to Seeker when the name was saved blank', () => {
    saveSettings({ name: '' })
    expect(loadName()).toBe('Seeker')
  })
})
