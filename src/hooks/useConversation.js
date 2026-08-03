import { useState, useCallback } from 'react'
import { summarizeConversation } from '../services/claude'

const SUMMARY_KEY = 'aporius_summary'
const MESSAGES_KEY = 'aporius_messages'

// Trigger summarization at ~80% of claude-opus-4-6's 200k context window
const SUMMARIZE_TOKEN_THRESHOLD = 160000

function loadState() {
  try {
    return {
      summary: localStorage.getItem(SUMMARY_KEY) || '',
      messages: JSON.parse(localStorage.getItem(MESSAGES_KEY)) || [],
    }
  } catch {
    return { summary: '', messages: [] }
  }
}

// Rough token approximation: ~4 chars per token
function approximateTokens(messages) {
  return messages.reduce((total, m) => total + Math.ceil(m.content.length / 4), 0)
}

export function useConversation() {
  const [state, setState] = useState(loadState)

  const addTurn = useCallback((userText, aporiusText) => {
    setState((prev) => {
      const updated = [
        ...prev.messages,
        { role: 'user', content: userText },
        { role: 'assistant', content: aporiusText },
      ]
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(updated))
      return { ...prev, messages: updated }
    })
  }, [])

  const checkAndSummarize = useCallback(async ({ apiKey, model }) => {
    const current = loadState()
    if (approximateTokens(current.messages) < SUMMARIZE_TOKEN_THRESHOLD) return

    const splitAt = Math.floor(current.messages.length / 2)
    const toSummarize = current.messages.slice(0, splitAt)
    const toKeep = current.messages.slice(splitAt)

    try {
      const newSummary = await summarizeConversation({
        apiKey,
        model,
        messages: toSummarize,
        existingSummary: current.summary,
      })
      const combined = current.summary
        ? `${current.summary}\n\n${newSummary}`
        : newSummary

      localStorage.setItem(SUMMARY_KEY, combined)
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(toKeep))
      setState({ summary: combined, messages: toKeep })
    } catch (e) {
      console.error('Summarization failed:', e)
    }
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem(SUMMARY_KEY)
    localStorage.removeItem(MESSAGES_KEY)
    setState({ summary: '', messages: [] })
  }, [])

  // Reload state from localStorage (e.g. after returning to main screen)
  const refresh = useCallback(() => {
    setState(loadState())
  }, [])

  return {
    summary: state.summary,
    messages: state.messages,
    addTurn,
    checkAndSummarize,
    reset,
    refresh,
  }
}
