import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLiveSentenceStream } from './deepgram'

// Layer 1 — the sentence drain.
//
// `drain` is a closure inside the factory, so it is tested the way the app uses
// it: through a fake socket. Nothing here is a source change, and the tests
// exercise the real accretion path rather than a lifted-out copy of it.

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances = []

  constructor(url, protocols) {
    this.url = url
    this.protocols = protocols
    this.readyState = FakeSocket.CONNECTING
    this.sent = []
    this.closed = false
    FakeSocket.instances.push(this)
  }

  send(data) {
    if (this.throwOnSend) throw new Error('socket died')
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = FakeSocket.CLOSED
  }

  // ── Test drivers ────────────────────────────────────────
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  // A finalized Deepgram result, in the shape the app actually unwraps.
  final(transcript) {
    this.raw(JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript }] } }))
  }

  interim(transcript) {
    this.raw(JSON.stringify({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript }] } }))
  }

  raw(data) {
    this.onmessage?.({ data })
  }

  serverClose() {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.()
  }
}

const socket = () => FakeSocket.instances.at(-1)

// Start a stream and get its socket to the open state, which is where every
// drain test begins.
async function connected(onSentence) {
  const stream = createLiveSentenceStream({ apiKey: 'dg-key', onSentence })
  const started = stream.start()
  socket().open()
  await started
  return stream
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sentence drain', () => {
  it('emits a sentence on a terminal mark', async () => {
    const onSentence = vi.fn()
    const stream = await connected(onSentence)

    socket().final('Hello world.')

    expect(onSentence).toHaveBeenCalledWith('Hello world.')
    expect(stream.getSentences()).toEqual(['Hello world.'])
  })

  it.each(['.', '?', '!'])('treats %s as a terminal', async (mark) => {
    const stream = await connected()
    socket().final(`Hello world${mark}`)
    expect(stream.getSentences()).toEqual([`Hello world${mark}`])
  })

  it('holds text with no terminal in the buffer', async () => {
    const onSentence = vi.fn()
    const stream = await connected(onSentence)

    socket().final('Hello world')

    expect(onSentence).not.toHaveBeenCalled()
    expect(stream.getSentences()).toEqual([])
  })

  it('accretes across messages and emits once the terminal arrives', async () => {
    const onSentence = vi.fn()
    const stream = await connected(onSentence)

    socket().final('I have been')
    socket().final('thinking about this')
    socket().final('for a while.')

    expect(stream.getSentences()).toEqual(['I have been thinking about this for a while.'])
    expect(onSentence).toHaveBeenCalledTimes(1)
  })

  it('joins accreted fragments with a single space', async () => {
    const stream = await connected()
    socket().final('Hello ')
    socket().final('world.')
    // The existing buffer already ends in a space, so no second one is added.
    expect(stream.getSentences()).toEqual(['Hello world.'])
  })

  it('cuts several sentences out of one message', async () => {
    const onSentence = vi.fn()
    const stream = await connected(onSentence)

    socket().final('First one. Second one? Third one!')

    expect(stream.getSentences()).toEqual(['First one.', 'Second one?', 'Third one!'])
    expect(onSentence).toHaveBeenCalledTimes(3)
  })

  it('keeps the tail of a multi-sentence message as the seed of the next', async () => {
    const stream = await connected()

    socket().final('Done. And then I')
    expect(stream.getSentences()).toEqual(['Done.'])

    socket().final('kept going.')
    expect(stream.getSentences()).toEqual(['Done.', 'And then I kept going.'])
  })

  it('emits the unterminated tail on stop', async () => {
    const onSentence = vi.fn()
    const stream = await connected(onSentence)

    socket().final('A short thought with no full stop')
    const stopped = stream.stop()
    socket().serverClose()

    await expect(stopped).resolves.toEqual(['A short thought with no full stop'])
    expect(onSentence).toHaveBeenCalledWith('A short thought with no full stop')
  })

  it('accepts finals that arrive during the flush', async () => {
    // The reason stop() waits for the close rather than hanging up: with
    // interim_results off, the tail of a quick sentence has not been finalized
    // when the button is pressed. CloseStream asks for it, and it lands here.
    const stream = await connected()

    socket().final('Already finalized.')
    const stopped = stream.stop()
    socket().final('Flushed on the way out.')
    socket().serverClose()

    await expect(stopped).resolves.toEqual(['Already finalized.', 'Flushed on the way out.'])
  })

  it('emits nothing extra when the buffer is empty at stop', async () => {
    const onSentence = vi.fn()
    const stream = await connected(onSentence)

    socket().final('All done.')
    onSentence.mockClear()

    const stopped = stream.stop()
    socket().serverClose()

    await expect(stopped).resolves.toEqual(['All done.'])
    expect(onSentence).not.toHaveBeenCalled()
  })

  it('emits a lone terminal mark as its own sentence', async () => {
    // Current behaviour, pinned rather than endorsed: a doubled mark leaves a
    // "." in the buffer, and "." is a truthy string, so it is emitted. Harmless
    // downstream (it becomes one wasted reflection call) and Deepgram's
    // smart_format makes it rare. Documented so a future change here is a
    // decision rather than a surprise.
    const stream = await connected()
    socket().final('Hi.. there.')
    expect(stream.getSentences()).toEqual(['Hi.', '.', 'there.'])
  })
})

describe('what never enters the buffer', () => {
  it('ignores interim hypotheses', async () => {
    // Interims are never requested and never consumed, which is what makes an
    // emitted sentence impossible to rewrite.
    const stream = await connected()
    socket().interim('Hello world.')
    expect(stream.getSentences()).toEqual([])
  })

  it('ignores messages that are not Results', async () => {
    const stream = await connected()
    socket().raw(JSON.stringify({ type: 'Metadata', is_final: true }))
    expect(stream.getSentences()).toEqual([])
  })

  it('ignores binary frames', async () => {
    const stream = await connected()
    socket().onmessage({ data: new ArrayBuffer(8) })
    expect(stream.getSentences()).toEqual([])
  })

  it('ignores unparseable JSON without throwing', async () => {
    const stream = await connected()
    expect(() => socket().raw('{not json')).not.toThrow()
    expect(stream.getSentences()).toEqual([])
  })

  it('ignores an empty transcript', async () => {
    const stream = await connected()
    socket().final('')
    socket().final('Real text.')
    expect(stream.getSentences()).toEqual(['Real text.'])
  })

  it('ignores a result with no alternatives', async () => {
    const stream = await connected()
    socket().raw(JSON.stringify({ type: 'Results', is_final: true, channel: {} }))
    expect(stream.getSentences()).toEqual([])
  })
})

describe('start', () => {
  it('refuses to connect without a key', async () => {
    const stream = createLiveSentenceStream({ apiKey: '' })
    await expect(stream.start()).resolves.toBe(false)
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('passes the key as a subprotocol and asks for no interim results', async () => {
    await connected()
    expect(socket().protocols).toEqual(['token', 'dg-key'])
    expect(socket().url).toContain('interim_results=false')
    expect(socket().url).toContain('model=nova-3')
    expect(socket().url).toContain('sample_rate=16000')
  })

  it('does not open a second socket when one is already live', async () => {
    const stream = await connected()
    await expect(stream.start()).resolves.toBe(true)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('resolves false when the constructor throws', async () => {
    vi.stubGlobal('WebSocket', function () {
      throw new Error('blocked')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stream = createLiveSentenceStream({ apiKey: 'dg-key' })
    await expect(stream.start()).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('resolves false when the socket errors before opening', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stream = createLiveSentenceStream({ apiKey: 'dg-key' })
    const started = stream.start()
    socket().onerror(new Error('handshake failed'))
    await expect(started).resolves.toBe(false)
  })

  it('clears the previous turn sentences', async () => {
    const stream = await connected()
    socket().final('From the last turn.')
    expect(stream.getSentences()).toHaveLength(1)

    const restarted = stream.stop()
    socket().serverClose()
    await restarted

    const restart = stream.start()
    socket().open()
    await restart

    expect(stream.getSentences()).toEqual([])
  })
})

describe('sendAudio', () => {
  it('queues chunks while connecting and flushes them on open', async () => {
    const stream = createLiveSentenceStream({ apiKey: 'dg-key' })
    const started = stream.start()

    stream.sendAudio('chunk-1')
    stream.sendAudio('chunk-2')
    expect(socket().sent).toEqual([])

    socket().open()
    await started

    expect(socket().sent).toEqual(['chunk-1', 'chunk-2'])
  })

  it('sends straight through once open', async () => {
    const stream = await connected()
    stream.sendAudio('chunk')
    expect(socket().sent).toEqual(['chunk'])
  })

  it('drops chunks when there is no key', () => {
    const stream = createLiveSentenceStream({ apiKey: '' })
    expect(() => stream.sendAudio('chunk')).not.toThrow()
  })

  it('drops chunks after stop', async () => {
    const stream = await connected()
    const stopped = stream.stop()
    socket().serverClose()
    await stopped

    stream.sendAudio('chunk')
    expect(socket().sent).toEqual([JSON.stringify({ type: 'CloseStream' })])
  })

  it('swallows a send that throws mid-stream', async () => {
    // A socket dying between the readyState check and the send is not
    // load-bearing — the murmur path degrades, the turn continues.
    const stream = await connected()
    socket().throwOnSend = true
    expect(() => stream.sendAudio('chunk')).not.toThrow()
  })
})

describe('stop', () => {
  it('asks the server to flush before closing', async () => {
    const stream = await connected()
    stream.stop()
    expect(socket().sent).toEqual([JSON.stringify({ type: 'CloseStream' })])
    expect(socket().closed).toBe(false)
  })

  it('closes the socket once the server has closed', async () => {
    const stream = await connected()
    const stopped = stream.stop()
    socket().serverClose()
    await stopped
    expect(socket().closed).toBe(true)
  })

  it('settles on a socket error instead of hanging', async () => {
    const stream = await connected()
    socket().final('Said before the socket died.')
    const stopped = stream.stop()
    socket().onerror(new Error('dropped'))
    await expect(stopped).resolves.toEqual(['Said before the socket died.'])
  })

  it('settles once, even if close and error both fire', async () => {
    const stream = await connected()
    const stopped = stream.stop()
    socket().serverClose()
    socket().onerror(new Error('and then this'))
    await expect(stopped).resolves.toEqual([])
  })

  it('resolves immediately when the send throws', async () => {
    const stream = await connected()
    socket().throwOnSend = true
    await expect(stream.stop()).resolves.toEqual([])
  })

  it('resolves immediately when there is no socket', async () => {
    const stream = createLiveSentenceStream({ apiKey: 'dg-key' })
    await expect(stream.stop()).resolves.toEqual([])
  })

  it('resolves immediately when the socket never opened', async () => {
    const stream = createLiveSentenceStream({ apiKey: 'dg-key' })
    stream.start()
    await expect(stream.stop()).resolves.toEqual([])
    expect(socket().closed).toBe(true)
  })
})
