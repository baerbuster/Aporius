import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import KnowThyself from './KnowThyself'

// The settings screen. Five keys and a name, held in local state until saved —
// so the interesting behaviour is what it prefills, what it emits, and the one
// destructive button on the page.

// Selected by placeholder, not by label: the <label> elements here carry no
// htmlFor and do not wrap their input, so none of these fields has an accessible
// name. Worth fixing in the app one day; noted rather than worked around
// silently.
const byPlaceholder = (placeholder) => document.querySelector(`input[placeholder="${placeholder}"]`)
const name = () => byPlaceholder('Your name')
const key = byPlaceholder

const setup = (settings = {}) => {
  const onSave = vi.fn()
  const onBack = vi.fn()
  render(<KnowThyself settings={settings} onSave={onSave} onBack={onBack} />)
  return { onSave, onBack }
}

const filled = {
  name: 'Buster',
  groqKey: 'gsk_1',
  claudeKey: 'sk-ant-1',
  elevenLabsKey: 'sk_1',
  googleTTSKey: 'AIza1',
  deepgramKey: 'dg1',
  model: 'claude-sonnet-4-6',
}

describe('prefilling', () => {
  it('shows what is already saved', () => {
    setup(filled)

    expect(name()).toHaveValue('Buster')
    expect(key('gsk_...')).toHaveValue('gsk_1')
    expect(key('sk-ant-...')).toHaveValue('sk-ant-1')
    expect(key('sk_...')).toHaveValue('sk_1')
    expect(key('AIza...')).toHaveValue('AIza1')
    expect(key('40-character hex key')).toHaveValue('dg1')
    expect(screen.getByRole('combobox')).toHaveValue('claude-sonnet-4-6')
  })

  it('starts blank on a first run', () => {
    setup()
    expect(name()).toHaveValue('')
    expect(key('gsk_...')).toHaveValue('')
  })

  it('defaults the model to Opus', () => {
    setup()
    expect(screen.getByRole('combobox')).toHaveValue('claude-opus-4-6')
  })

  it('masks every key but not the name', () => {
    // These are live billable credentials, typed on a phone in public.
    setup(filled)
    expect(name()).toHaveAttribute('type', 'text')
    for (const placeholder of ['gsk_...', 'sk-ant-...', 'sk_...', 'AIza...', '40-character hex key']) {
      expect(key(placeholder)).toHaveAttribute('type', 'password')
    }
  })

  it('offers both Groq models, which are the ones routed away from Claude', () => {
    setup()
    const values = [...screen.getByRole('combobox').options].map((o) => o.value)
    expect(values).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ])
  })
})

describe('saving', () => {
  it('emits the whole form, edits included', () => {
    const { onSave } = setup(filled)

    fireEvent.change(name(), { target: { value: 'Socrates' } })
    fireEvent.change(key('gsk_...'), { target: { value: 'gsk_2' } })
    fireEvent.click(screen.getByRole('button', { name: 'SO IT IS WRITTEN' }))

    expect(onSave).toHaveBeenCalledWith({ ...filled, name: 'Socrates', groqKey: 'gsk_2' })
  })

  it('emits a model change', () => {
    const { onSave } = setup(filled)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'llama-3.1-8b-instant' } })
    fireEvent.click(screen.getByRole('button', { name: 'SO IT IS WRITTEN' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'llama-3.1-8b-instant' }),
    )
  })

  it('saves nothing on its own — the parent owns storage', () => {
    setup(filled)
    fireEvent.change(name(), { target: { value: 'Socrates' } })

    expect(localStorage.getItem('aporius_settings')).toBeNull()
  })

  it('goes back without saving', () => {
    const { onBack, onSave } = setup(filled)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onBack).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('BRAINDRAIN', () => {
  const braindrain = () => fireEvent.click(screen.getByRole('button', { name: 'BRAINDRAIN' }))

  it('asks before it wipes anything', () => {
    localStorage.setItem('aporius_messages', '[{"role":"user","content":"Hi."}]')
    setup(filled)

    braindrain()

    expect(screen.getByText(/It cannot be undone/)).toBeInTheDocument()
    expect(localStorage.getItem('aporius_messages')).not.toBeNull()
  })

  it('wipes both the history and the summary when confirmed', () => {
    localStorage.setItem('aporius_messages', '[{"role":"user","content":"Hi."}]')
    localStorage.setItem('aporius_summary', 'They dislike Kant.')
    setup(filled)

    braindrain()
    fireEvent.click(screen.getByRole('button', { name: 'WIPE IT' }))

    expect(localStorage.getItem('aporius_messages')).toBeNull()
    expect(localStorage.getItem('aporius_summary')).toBeNull()
    expect(screen.queryByText(/It cannot be undone/)).not.toBeInTheDocument()
  })

  it('leaves everything alone when cancelled', () => {
    localStorage.setItem('aporius_messages', '[{"role":"user","content":"Hi."}]')
    setup(filled)

    braindrain()
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))

    expect(localStorage.getItem('aporius_messages')).not.toBeNull()
    expect(screen.queryByText(/It cannot be undone/)).not.toBeInTheDocument()
  })

  it('leaves the API keys alone — it drains the brain, not the credentials', () => {
    localStorage.setItem('aporius_settings', JSON.stringify(filled))
    setup(filled)

    braindrain()
    fireEvent.click(screen.getByRole('button', { name: 'WIPE IT' }))

    expect(localStorage.getItem('aporius_settings')).not.toBeNull()
  })
})
