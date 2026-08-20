import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withRetry, isOnline } from './retry'

// Layer 1 — retry-with-timeout, the wrapper every network call in a turn goes
// through. Nothing here touches a network: `fn` is a vi.fn and each test dictates
// how it behaves.
//
// Fake timers throughout, because both delays that matter are invisible without
// them: the per-attempt timeout the call races against, and the fixed 1s pause
// between attempts. Until this file existed these were reached only through the
// turn-flow tests, which press a button and cannot single out a hung attempt from
// a failed one.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withRetry', () => {
  it('returns the value and calls once when the first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn, 3, 1000)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure and returns the next attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('second')

    const call = withRetry(fn, 3, 1000)
    await vi.advanceTimersByTimeAsync(1000) // the pause between attempts

    await expect(call).resolves.toBe('second')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetries and throws the LAST error, not the first', async () => {
    // The distinction matters: the message the user hears comes from whatever
    // this throws, so a stale first error would misreport why the turn failed.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'))

    const call = withRetry(fn, 3, 1000)
    const settled = expect(call).rejects.toThrow('third')
    await vi.advanceTimersByTimeAsync(2000)

    await settled
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('times out an attempt that never settles', async () => {
    // The case the whole timeout exists for: a request that neither resolves nor
    // rejects would otherwise hang the turn forever, with the UI stuck mid-state.
    const fn = vi.fn(() => new Promise(() => {}))

    const call = withRetry(fn, 1, 5000)
    const settled = expect(call).rejects.toThrow('Request timed out')
    await vi.advanceTimersByTimeAsync(5000)

    await settled
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('applies the timeout per attempt, so a later attempt can still land', async () => {
    const fn = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {})) // hangs
      .mockResolvedValue('landed')

    const call = withRetry(fn, 2, 5000)
    await vi.advanceTimersByTimeAsync(5000) // first attempt times out
    await vi.advanceTimersByTimeAsync(1000) // the pause before the second

    await expect(call).resolves.toBe('landed')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not pause after the final attempt', async () => {
    // Three attempts means two pauses, not three. Proven by the call settling
    // within 2s: a third pause would hold it to 3s and this would time out.
    const fn = vi.fn().mockRejectedValue(new Error('down'))

    const call = withRetry(fn, 3, 1000)
    const settled = expect(call).rejects.toThrow('down')
    await vi.advanceTimersByTimeAsync(2000)

    await settled
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('runs exactly once when told not to retry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('once'))

    const call = withRetry(fn, 1, 1000)
    const settled = expect(call).rejects.toThrow('once')
    await vi.advanceTimersByTimeAsync(1000)

    await settled
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('isOnline', () => {
  it('is true when the browser reports a connection', () => {
    // test/setup.js stubs navigator.onLine to true for every test.
    expect(isOnline()).toBe(true)
  })

  it('is false when the browser reports none', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(isOnline()).toBe(false)
  })
})
