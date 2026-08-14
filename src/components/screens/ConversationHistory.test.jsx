import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ConversationHistory from './ConversationHistory'

// The scroll. Reads straight from localStorage rather than the conversation hook,
// because it is mounted on its own while MainScreen is unmounted.

const save = (messages) => localStorage.setItem('aporius_messages', JSON.stringify(messages))
const named = (name) => localStorage.setItem('aporius_settings', JSON.stringify({ name }))

const turn = (user, aporius) => [
  { role: 'user', content: user },
  { role: 'assistant', content: aporius },
]

const setup = () => {
  const onBack = vi.fn()
  render(<ConversationHistory onBack={onBack} />)
  return { onBack }
}

beforeEach(() => {
  navigator.share = undefined
  navigator.clipboard = { writeText: vi.fn(async () => {}) }
})

describe('the dialogue', () => {
  it('invites the user in when there is nothing yet', () => {
    setup()
    expect(screen.getByText('The scroll is empty. Begin your inquiry.')).toBeInTheDocument()
  })

  it('pairs messages into turns', () => {
    named('Buster')
    save([...turn('What is virtue?', 'A habit.'), ...turn('Says who?', 'Aristotle.')])

    setup()

    expect(screen.getByText('What is virtue?')).toBeInTheDocument()
    expect(screen.getByText('A habit.')).toBeInTheDocument()
    expect(screen.getByText('Says who?')).toBeInTheDocument()
    expect(screen.getByText('Aristotle.')).toBeInTheDocument()
  })

  it('attributes the user side to their name', () => {
    named('Buster')
    save(turn('What is virtue?', 'A habit.'))

    setup()

    expect(screen.getAllByText('Buster:')).toHaveLength(1)
    expect(screen.getAllByText('Aporius:')).toHaveLength(1)
  })

  it('calls an unnamed user Seeker', () => {
    save(turn('What is virtue?', 'A habit.'))
    setup()
    expect(screen.getAllByText('Seeker:')).toHaveLength(1)
  })

  it('shows a question whose answer never arrived', () => {
    // An odd-length history — the turn was interrupted before Aporius replied.
    save([{ role: 'user', content: 'What is virtue?' }])

    setup()

    expect(screen.getByText('What is virtue?')).toBeInTheDocument()
    expect(screen.queryByText('Aporius:')).not.toBeInTheDocument()
  })

  it('falls back to empty rather than crashing on a corrupt history', () => {
    localStorage.setItem('aporius_messages', '{not json')
    setup()
    expect(screen.getByText('The scroll is empty. Begin your inquiry.')).toBeInTheDocument()
  })

  it('opens at the most recent turn', () => {
    save(turn('What is virtue?', 'A habit.'))
    setup()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' })
  })

  it('goes back', () => {
    const { onBack } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('sharing', () => {
  const share = () => fireEvent.click(screen.getByRole('button', { name: 'Share' }))

  it('uses the native share sheet when there is one', async () => {
    navigator.share = vi.fn(async () => {})
    named('Buster')
    save(turn('What is virtue?', 'A habit.'))

    setup()
    share()

    await waitFor(() => expect(navigator.share).toHaveBeenCalledWith({
      title: 'Buster by Aporius',
      text: 'Buster: What is virtue?\n\nAporius: A habit.',
    }))
  })

  it('copies to the clipboard when there is not', async () => {
    named('Buster')
    save(turn('What is virtue?', 'A habit.'))

    setup()
    share()

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Buster: What is virtue?\n\nAporius: A habit.',
    ))
  })

  it('says so plainly when there is nothing to share', async () => {
    setup()
    share()

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'No conversation yet.',
    ))
  })

  it('leaves out a turn that has no reply', async () => {
    named('Buster')
    save([{ role: 'user', content: 'What is virtue?' }])

    setup()
    share()

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Buster: What is virtue?',
    ))
  })

  it('says nothing when the user cancels the share sheet', async () => {
    // Cancelling is a rejection, not a failure — it must not surface as one.
    navigator.share = vi.fn().mockRejectedValue(new Error('AbortError'))
    save(turn('What is virtue?', 'A habit.'))

    setup()

    expect(() => share()).not.toThrow()
    await waitFor(() => expect(navigator.share).toHaveBeenCalled())
  })

  it('swallows a clipboard the browser refuses', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('NotAllowedError'))
    save(turn('What is virtue?', 'A habit.'))

    setup()

    expect(() => share()).not.toThrow()
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
  })
})
