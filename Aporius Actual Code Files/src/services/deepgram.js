// Stage 1 — Live STT → list of sentence strings.
//
// Deepgram streaming WebSocket. Finalized text accretes into an app-owned
// buffer string; the buffer is drained on every terminal mark (. ? !) into a
// plain array of sentence strings. Interim results are never requested and
// never consumed, so an emitted sentence can never be rewritten.
//
// Output is only a list of strings. Nothing downstream (POS, pronouns,
// perspective, TTS, ranking) belongs here.

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen'

const TERMINALS = new Set(['.', '?', '!'])

function buildUrl() {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    punctuate: 'true',
    smart_format: 'true',
    interim_results: 'false',
  })
  return `${DEEPGRAM_URL}?${params}`
}

export function createLiveSentenceStream({ apiKey, onSentence } = {}) {
  let socket = null
  let buffer = ''
  let sentences = []
  let queued = []

  // Cut every completed sentence out of the buffer, keeping the remainder as
  // the seed of the next one. One message may hold zero, one, or many marks.
  const drain = () => {
    for (;;) {
      let idx = -1
      for (let i = 0; i < buffer.length; i++) {
        if (TERMINALS.has(buffer[i])) { idx = i; break }
      }
      if (idx === -1) break

      const sentence = buffer.slice(0, idx + 1).trim()
      buffer = buffer.slice(idx + 1)

      if (sentence) {
        sentences.push(sentence)
        onSentence?.(sentence)
      }
    }
  }

  const handleMessage = (event) => {
    if (typeof event.data !== 'string') return

    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }

    if (msg.type !== 'Results') return
    if (!msg.is_final) return // interim hypotheses never enter the buffer

    const text = msg.channel?.alternatives?.[0]?.transcript
    if (!text) return

    buffer += buffer && !buffer.endsWith(' ') ? ` ${text}` : text
    drain()
  }

  const start = () => {
    if (!apiKey) return Promise.resolve(false)
    if (socket) return Promise.resolve(true)

    buffer = ''
    sentences = []
    queued = []

    return new Promise((resolve) => {
      let ws
      try {
        ws = new WebSocket(buildUrl(), ['token', apiKey])
      } catch (err) {
        console.warn('[Deepgram] connect failed:', err)
        resolve(false)
        return
      }

      ws.binaryType = 'arraybuffer'
      socket = ws

      ws.onopen = () => {
        for (const chunk of queued) ws.send(chunk)
        queued = []
        resolve(true)
      }

      ws.onmessage = handleMessage

      ws.onerror = (err) => {
        console.warn('[Deepgram] socket error:', err)
        resolve(false)
      }

      ws.onclose = () => {
        if (socket === ws) socket = null
      }
    })
  }

  // Audio fans out here from the existing capture path — same 16kHz PCM the
  // Groq batch transcript is built from.
  const sendAudio = (chunk) => {
    if (!apiKey) return
    if (!socket) return
    if (socket.readyState === WebSocket.CONNECTING) {
      queued.push(chunk)
      return
    }
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(chunk)
    } catch {
      /* socket died mid-send; nothing here is load-bearing */
    }
  }

  // Listening stopped. Resolves once Deepgram has flushed, with the full
  // sentence list.
  //
  // The tail of a short utterance has usually not been finalized yet when the
  // button is pressed — with interim_results off, results only arrive at
  // endpoint boundaries, and a quick sentence never reaches one. CloseStream
  // asks the server to finalize what it still holds and send those results
  // before it closes, so this waits for that close instead of hanging up on the
  // flush it just requested. Whatever is in the buffer afterwards is the last
  // sentence, terminal mark or not.
  const stop = () => {
    const ws = socket
    socket = null
    queued = []

    const finish = () => {
      const leftover = buffer.trim()
      if (leftover) {
        sentences.push(leftover)
        onSentence?.(leftover)
      }
      buffer = ''
      return sentences
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      try { ws?.close() } catch { /* ignore */ }
      return Promise.resolve(finish())
    }

    return new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        try { ws.close() } catch { /* ignore */ }
        resolve(finish())
      }

      ws.onmessage = handleMessage // keep accepting finals through the flush
      ws.onclose = done            // Deepgram closes once it has sent them all
      ws.onerror = done

      try {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        done()
      }
    })
  }

  const getSentences = () => sentences

  return { start, stop, sendAudio, getSentences }
}
