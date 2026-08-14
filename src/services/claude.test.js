import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sendToClaude, summarizeConversation } from './claude'
import { SYSTEM_PROMPT } from './aporius-prompt.js'

// Layer 2 — the Claude route against a fake network. No key, no call, no cost.

const reply = (text) => ({
  ok: true,
  json: async () => ({ content: [{ text }] }),
})

const failure = (status, body) => ({
  ok: false,
  status,
  json: async () => {
    if (body === undefined) throw new Error('not json')
    return body
  },
})

// The JSON body of the last fetch, which is what every request-shape test reads.
const sentBody = () => JSON.parse(fetch.mock.calls.at(-1)[1].body)
const sentHeaders = () => fetch.mock.calls.at(-1)[1].headers

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('sendToClaude', () => {
  const messages = [{ role: 'user', content: 'What is virtue?' }]

  it('returns the text of the reply', async () => {
    fetch.mockResolvedValue(reply('Virtue is a habit.'))
    await expect(sendToClaude({ apiKey: 'sk-x', messages })).resolves.toBe('Virtue is a habit.')
  })

  it('posts to the messages endpoint with the browser-access header', async () => {
    // Without `anthropic-dangerous-direct-browser-access` the call is blocked by
    // CORS, and this app has no server to proxy through.
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', messages })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(sentHeaders()).toMatchObject({
      'x-api-key': 'sk-x',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
  })

  it('sends the messages and a 300-token ceiling', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', messages })
    expect(sentBody()).toMatchObject({ messages, max_tokens: 300 })
  })

  it('defaults to Opus', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', messages })
    expect(sentBody().model).toBe('claude-opus-4-6')
  })

  it('uses the model it is given', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', model: 'claude-sonnet-4-6', messages })
    expect(sentBody().model).toBe('claude-sonnet-4-6')
  })

  it('injects the summary into the persona prompt', async () => {
    // The {summary} token is a placeholder, not prose. If a prompt edit ever
    // drops it, history silently stops being injected — this catches that.
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', messages, summary: 'They dislike Kant.' })

    const { system } = sentBody()
    expect(system).toContain('They dislike Kant.')
    expect(system).not.toContain('{summary}')
    expect(system).toContain('You are Aporius')
  })

  it('says so explicitly when there is no history', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', messages })

    const { system } = sentBody()
    expect(system).toContain('(No prior conversation history.)')
    expect(system).not.toContain('{summary}')
  })

  it('leaves the rest of the persona untouched', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await sendToClaude({ apiKey: 'sk-x', messages, summary: 'x' })
    expect(sentBody().system).toBe(SYSTEM_PROMPT.replace('{summary}', 'x'))
  })

  it("throws the API's own message when it gives one", async () => {
    fetch.mockResolvedValue(failure(400, { error: { message: 'credit balance is too low' } }))
    await expect(sendToClaude({ apiKey: 'sk-x', messages })).rejects.toThrow(
      'credit balance is too low',
    )
  })

  it('falls back to the status code when the error body is unreadable', async () => {
    fetch.mockResolvedValue(failure(529))
    await expect(sendToClaude({ apiKey: 'sk-x', messages })).rejects.toThrow('Claude API error: 529')
  })

  it('lets a network failure through', async () => {
    // MainScreen's withRetry is what handles this; the service must not swallow it.
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(sendToClaude({ apiKey: 'sk-x', messages })).rejects.toThrow('Failed to fetch')
  })
})

describe('summarizeConversation', () => {
  const messages = [
    { role: 'user', content: 'I think free will is an illusion.' },
    { role: 'assistant', content: 'Then who is doing the thinking?' },
  ]

  it('returns the summary text', async () => {
    fetch.mockResolvedValue(reply('They doubt free will.'))
    await expect(summarizeConversation({ apiKey: 'sk-x', messages })).resolves.toBe(
      'They doubt free will.',
    )
  })

  it('labels each speaker in the transcript it sends', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await summarizeConversation({ apiKey: 'sk-x', messages })

    const prompt = sentBody().messages[0].content
    expect(prompt).toContain('User: I think free will is an illusion.')
    expect(prompt).toContain('Aporius: Then who is doing the thinking?')
  })

  it('asks for a fresh summary when there is no prior one', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await summarizeConversation({ apiKey: 'sk-x', messages })

    const prompt = sentBody().messages[0].content
    expect(prompt).toContain('Summarize this conversation.')
    expect(prompt).not.toContain('Previous summary:')
  })

  it('folds an existing summary into the new one', async () => {
    fetch.mockResolvedValue(reply('ok'))
    await summarizeConversation({ apiKey: 'sk-x', messages, existingSummary: 'They dislike Kant.' })

    const prompt = sentBody().messages[0].content
    expect(prompt).toContain('Previous summary:\nThey dislike Kant.')
    expect(prompt).toContain('Create an updated, comprehensive summary.')
  })

  it('carries no persona and a much larger ceiling', async () => {
    // Summarizing is not Aporius speaking, so it deliberately goes out without
    // the persona prompt — and needs far more room than a spoken reply.
    fetch.mockResolvedValue(reply('ok'))
    await summarizeConversation({ apiKey: 'sk-x', messages })

    const body = sentBody()
    expect(body.system).toBeUndefined()
    expect(body.max_tokens).toBe(2048)
  })

  it('throws a generic error on any failure status', async () => {
    fetch.mockResolvedValue(failure(500, { error: { message: 'ignored' } }))
    await expect(summarizeConversation({ apiKey: 'sk-x', messages })).rejects.toThrow(
      'Summarization failed',
    )
  })
})
