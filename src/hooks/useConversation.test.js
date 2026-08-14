import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useConversation } from './useConversation'
import { summarizeConversation } from '../services/claude'

vi.mock('../services/claude', () => ({ summarizeConversation: vi.fn() }))

const MESSAGES_KEY = 'aporius_messages'
const SUMMARY_KEY = 'aporius_summary'

const stored = () => JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]')

const turn = (user, aporius) => [
  { role: 'user', content: user },
  { role: 'assistant', content: aporius },
]

// ~4 chars per token, and summarization triggers at 160k tokens — so a message
// this size on its own is enough to cross the line.
const huge = (n) => 'x'.repeat(n)
const overThreshold = [
  { role: 'user', content: huge(400_000) },
  { role: 'assistant', content: huge(400_000) },
]

beforeEach(() => {
  summarizeConversation.mockReset()
})

describe('loading', () => {
  it('starts empty on a first run', () => {
    const { result } = renderHook(() => useConversation())
    expect(result.current.messages).toEqual([])
    expect(result.current.summary).toBe('')
  })

  it('restores what was saved', () => {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(turn('Hello.', 'Hello yourself.')))
    localStorage.setItem(SUMMARY_KEY, 'They greet politely.')

    const { result } = renderHook(() => useConversation())

    expect(result.current.messages).toEqual(turn('Hello.', 'Hello yourself.'))
    expect(result.current.summary).toBe('They greet politely.')
  })

  it('starts empty rather than crashing on a corrupt blob', () => {
    localStorage.setItem(MESSAGES_KEY, '{not json')
    const { result } = renderHook(() => useConversation())
    expect(result.current.messages).toEqual([])
  })
})

describe('addTurn', () => {
  it('appends the pair in speaking order', () => {
    const { result } = renderHook(() => useConversation())

    act(() => result.current.addTurn('What is virtue?', 'A habit.'))

    expect(result.current.messages).toEqual(turn('What is virtue?', 'A habit.'))
  })

  it('persists immediately', () => {
    // MainScreen reads localStorage directly when building the next Claude call,
    // so a turn that lived only in React state would be invisible to it.
    const { result } = renderHook(() => useConversation())

    act(() => result.current.addTurn('What is virtue?', 'A habit.'))

    expect(stored()).toEqual(turn('What is virtue?', 'A habit.'))
  })

  it('accumulates across turns', () => {
    const { result } = renderHook(() => useConversation())

    act(() => result.current.addTurn('One?', 'First.'))
    act(() => result.current.addTurn('Two?', 'Second.'))

    expect(result.current.messages).toHaveLength(4)
    expect(stored()).toHaveLength(4)
  })
})

describe('checkAndSummarize', () => {
  it('does nothing while the history is small', async () => {
    const { result } = renderHook(() => useConversation())
    act(() => result.current.addTurn('Short.', 'Also short.'))

    await act(() => result.current.checkAndSummarize({ apiKey: 'sk-x', model: 'm' }))

    expect(summarizeConversation).not.toHaveBeenCalled()
    expect(stored()).toHaveLength(2)
  })

  it('summarizes the older half and keeps the newer half', async () => {
    // The point of the split: the recent turns stay verbatim so Aporius still has
    // the immediate thread, while everything older collapses into prose.
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(overThreshold))
    summarizeConversation.mockResolvedValue('They talked at length.')

    const { result } = renderHook(() => useConversation())
    await act(() => result.current.checkAndSummarize({ apiKey: 'sk-x', model: 'm' }))

    expect(summarizeConversation).toHaveBeenCalledWith({
      apiKey: 'sk-x',
      model: 'm',
      messages: [overThreshold[0]],
      existingSummary: '',
    })
    expect(stored()).toEqual([overThreshold[1]])
  })

  it('publishes the new summary to state and storage', async () => {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(overThreshold))
    summarizeConversation.mockResolvedValue('They talked at length.')

    const { result } = renderHook(() => useConversation())
    await act(() => result.current.checkAndSummarize({ apiKey: 'sk-x', model: 'm' }))

    await waitFor(() => expect(result.current.summary).toBe('They talked at length.'))
    expect(localStorage.getItem(SUMMARY_KEY)).toBe('They talked at length.')
  })

  it('appends to an existing summary rather than replacing it', async () => {
    // Summaries accumulate across the life of the conversation; overwriting would
    // silently drop everything from before the previous compaction.
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(overThreshold))
    localStorage.setItem(SUMMARY_KEY, 'Earlier: they dislike Kant.')
    summarizeConversation.mockResolvedValue('Later: they came round on Kant.')

    const { result } = renderHook(() => useConversation())
    await act(() => result.current.checkAndSummarize({ apiKey: 'sk-x', model: 'm' }))

    expect(localStorage.getItem(SUMMARY_KEY)).toBe(
      'Earlier: they dislike Kant.\n\nLater: they came round on Kant.',
    )
    expect(summarizeConversation).toHaveBeenCalledWith(
      expect.objectContaining({ existingSummary: 'Earlier: they dislike Kant.' }),
    )
  })

  it('leaves the history untouched when summarizing fails', async () => {
    // The failure mode that would actually hurt: dropping half the conversation
    // and having nothing to show for it.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(overThreshold))
    summarizeConversation.mockRejectedValue(new Error('API down'))

    const { result } = renderHook(() => useConversation())
    await act(() => result.current.checkAndSummarize({ apiKey: 'sk-x', model: 'm' }))

    expect(stored()).toEqual(overThreshold)
    expect(localStorage.getItem(SUMMARY_KEY)).toBeNull()
  })

  it('reads storage rather than stale state', async () => {
    // It re-loads inside the call, so a turn written by another component since
    // this hook rendered is still counted.
    const { result } = renderHook(() => useConversation())
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(overThreshold))
    summarizeConversation.mockResolvedValue('Summary.')

    await act(() => result.current.checkAndSummarize({ apiKey: 'sk-x', model: 'm' }))

    expect(summarizeConversation).toHaveBeenCalled()
  })
})

describe('reset', () => {
  it('clears both keys and the state', () => {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(turn('Hi.', 'Hi.')))
    localStorage.setItem(SUMMARY_KEY, 'Something.')

    const { result } = renderHook(() => useConversation())
    act(() => result.current.reset())

    expect(result.current.messages).toEqual([])
    expect(result.current.summary).toBe('')
    expect(localStorage.getItem(MESSAGES_KEY)).toBeNull()
    expect(localStorage.getItem(SUMMARY_KEY)).toBeNull()
  })
})

describe('refresh', () => {
  it('picks up a change made while the screen was away', () => {
    // MainScreen calls this on mount, because the history screen can clear the
    // conversation while it is unmounted.
    const { result } = renderHook(() => useConversation())
    expect(result.current.messages).toEqual([])

    localStorage.setItem(MESSAGES_KEY, JSON.stringify(turn('Hi.', 'Hello.')))
    act(() => result.current.refresh())

    expect(result.current.messages).toEqual(turn('Hi.', 'Hello.'))
  })
})
