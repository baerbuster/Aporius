import { SYSTEM_PROMPT } from './aporius-prompt.js'

// The persona lives in ./aporius-prompt.js so this route and the Groq route
// can never speak with different voices. {summary} is injected below.
export async function sendToClaude({ apiKey, model = 'claude-opus-4-6', messages, summary = '' }) {
  const systemPrompt = SYSTEM_PROMPT.replace(
    '{summary}',
    summary || '(No prior conversation history.)',
  )

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: systemPrompt,
      messages,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Claude API error: ${response.status}`)
  }

  const data = await response.json()
  return data.content[0].text
}

export async function summarizeConversation({
  apiKey,
  model = 'claude-opus-4-6',
  messages,
  existingSummary = '',
}) {
  const historyText = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Aporius'}: ${m.content}`)
    .join('\n\n')

  const prompt = existingSummary
    ? `Previous summary:\n${existingSummary}\n\nNew conversation to add:\n${historyText}\n\nCreate an updated, comprehensive summary. Preserve key facts, decisions, names, emotional context, and any commitments made. Be thorough but concise.`
    : `Summarize this conversation. Preserve key facts, decisions, names, emotional context, and commitments. Be thorough but concise.\n\n${historyText}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) throw new Error('Summarization failed')
  const data = await response.json()
  return data.content[0].text
}
