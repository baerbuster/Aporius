import { sendToClaude } from './claude'
import { sendToGroq } from './groq'

// ─── LLM routing: Claude or Groq based on model ────────────
export function sendToAI({ claudeKey, groqKey, model, messages, summary }) {
  if (model.startsWith('llama')) {
    return sendToGroq({ apiKey: groqKey, model, messages, summary })
  }
  return sendToClaude({ apiKey: claudeKey, model, messages, summary })
}
