import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sendToAI } from './ai'
import { sendToClaude } from './claude'
import { sendToGroq } from './groq'

// Layer 2 — the one decision this module makes: which provider gets the turn.
// Both providers are faked, so what is pinned here is the routing rule and the
// key that travels with it, not either provider's own behaviour.

vi.mock('./claude', () => ({ sendToClaude: vi.fn() }))
vi.mock('./groq', () => ({ sendToGroq: vi.fn() }))

// restoreMocks does not reach vi.fn()s declared inside a mock factory — they are
// module-level and carry call history between tests, which would silently defeat
// every not.toHaveBeenCalled() below.
beforeEach(() => {
  sendToClaude.mockReset()
  sendToGroq.mockReset()
})

const args = {
  claudeKey: 'sk-ant-key',
  groqKey: 'gsk-key',
  messages: [{ role: 'user', content: 'Hello.' }],
  summary: 'They dislike Kant.',
}

describe('sendToAI', () => {
  it('sends a llama model to Groq, with the Groq key', () => {
    sendToAI({ ...args, model: 'llama-3.3-70b-versatile' })

    expect(sendToGroq).toHaveBeenCalledWith({
      apiKey: 'gsk-key',
      model: 'llama-3.3-70b-versatile',
      messages: args.messages,
      summary: args.summary,
    })
    expect(sendToClaude).not.toHaveBeenCalled()
  })

  it('sends a Claude model to Claude, with the Anthropic key', () => {
    sendToAI({ ...args, model: 'claude-opus-4-6' })

    expect(sendToClaude).toHaveBeenCalledWith({
      apiKey: 'sk-ant-key',
      model: 'claude-opus-4-6',
      messages: args.messages,
      summary: args.summary,
    })
    expect(sendToGroq).not.toHaveBeenCalled()
  })

  it('routes on the model name alone — the wrong key does not redirect it', () => {
    // Both keys are always in hand, so nothing about which one is present can
    // decide the route. Only the model prefix does.
    sendToAI({ ...args, claudeKey: '', model: 'claude-haiku-4-5-20251001' })

    expect(sendToClaude).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: '', model: 'claude-haiku-4-5-20251001' }),
    )
    expect(sendToGroq).not.toHaveBeenCalled()
  })

  it('sends anything that is not a llama to Claude', () => {
    // The rule is a llama prefix, not a list of known models. An unrecognised
    // name lands on Claude rather than throwing.
    sendToAI({ ...args, model: 'some-future-model' })

    expect(sendToClaude).toHaveBeenCalledTimes(1)
    expect(sendToGroq).not.toHaveBeenCalled()
  })

  it('matches the llama prefix, not the word anywhere in the name', () => {
    sendToAI({ ...args, model: 'claude-llama-lookalike' })

    expect(sendToClaude).toHaveBeenCalledTimes(1)
    expect(sendToGroq).not.toHaveBeenCalled()
  })

  it('returns the provider’s own promise untouched', async () => {
    // The caller wraps this in withRetry, so the result has to pass straight
    // through rather than being awaited and re-wrapped here.
    sendToClaude.mockResolvedValue('a considered reply')
    await expect(sendToAI({ ...args, model: 'claude-opus-4-6' })).resolves.toBe(
      'a considered reply',
    )
  })

  it('lets a provider failure propagate', async () => {
    sendToGroq.mockRejectedValue(new Error('groq down'))
    await expect(sendToAI({ ...args, model: 'llama-3.1-8b-instant' })).rejects.toThrow(
      'groq down',
    )
  })
})
