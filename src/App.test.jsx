import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import App from './App'

// MainScreen owns the microphone and five network services; the routing tested
// here does not care what it does, only that it is the thing on screen. Every
// other screen renders for real.
vi.mock('./components/screens/MainScreen', () => ({
  default: ({ onOpenHistory, onOpenSettings }) => (
    <div>
      <span>MAIN SCREEN</span>
      <button onClick={onOpenHistory}>go history</button>
      <button onClick={onOpenSettings}>go settings</button>
    </div>
  ),
}))

const allKeys = {
  groqKey: 'gsk',
  claudeKey: 'sk-ant',
  elevenLabsKey: 'sk_11',
  googleTTSKey: 'AIza',
  deepgramKey: 'dg',
}

const saveKeys = (settings) =>
  localStorage.setItem('aporius_settings', JSON.stringify(settings))

const tapSplash = () => fireEvent.click(screen.getByRole('button', { name: /unexamined life/ }))

const onMain = () => screen.queryByText('MAIN SCREEN')
const onSettings = () => screen.queryByRole('heading', { name: 'Know Thyself' })
const onSplash = () => screen.queryByRole('heading', { name: 'Aporius.' })

describe('the gate', () => {
  it('opens on the splash screen', () => {
    render(<App />)
    expect(onSplash()).toBeInTheDocument()
  })

  it('goes straight to the main screen when every key is present', () => {
    saveKeys(allKeys)
    render(<App />)

    tapSplash()

    expect(onMain()).toBeInTheDocument()
  })

  it('sends a fresh install to settings instead', () => {
    render(<App />)
    tapSplash()
    expect(onSettings()).toBeInTheDocument()
  })

  it.each(Object.keys(allKeys))('sends the user to settings when %s is missing', (missing) => {
    // Deepgram is in the gate on purpose: without it the reflection half of the
    // app is silently dead rather than visibly broken.
    saveKeys({ ...allKeys, [missing]: '' })
    render(<App />)

    tapSplash()

    expect(onSettings()).toBeInTheDocument()
    expect(onMain()).not.toBeInTheDocument()
  })

  it('re-reads storage on the tap, not at mount', () => {
    // The keys may have been entered on this device a moment ago in another tab.
    render(<App />)
    saveKeys(allKeys)

    tapSplash()

    expect(onMain()).toBeInTheDocument()
  })
})

describe('settings', () => {
  it('saves and lands on the main screen', () => {
    render(<App />)
    tapSplash()

    // By placeholder — the settings labels carry no htmlFor, so the fields have
    // no accessible name to query by.
    fireEvent.change(document.querySelector('input[placeholder="Your name"]'), {
      target: { value: 'Buster' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'SO IT IS WRITTEN' }))

    expect(onMain()).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('aporius_settings')).name).toBe('Buster')
  })

  it('returns to the splash screen when that is where it came from', () => {
    render(<App />)
    tapSplash()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onSplash()).toBeInTheDocument()
  })

  it('returns to the main screen when that is where it came from', () => {
    saveKeys(allKeys)
    render(<App />)
    tapSplash()

    fireEvent.click(screen.getByRole('button', { name: 'go settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onMain()).toBeInTheDocument()
  })
})

describe('the other screens', () => {
  it('opens the history and comes back', () => {
    saveKeys(allKeys)
    render(<App />)
    tapSplash()

    fireEvent.click(screen.getByRole('button', { name: 'go history' }))
    expect(screen.getByText('by Aporius')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onMain()).toBeInTheDocument()
  })

  it('reaches the riddle with the back button and comes back', () => {
    render(<App />)

    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(screen.getByRole('heading', { name: 'Ponder This...' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onSplash()).toBeInTheDocument()
  })
})
