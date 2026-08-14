import { describe, it, expect, beforeEach, vi } from 'vitest'

// log.js reads the flag ONCE at module load, on purpose — it keeps debug() a
// plain boolean check on a hot path. That makes every test here a fresh import
// with storage already in the state under test; setting the flag after import
// would prove nothing.
async function importLog() {
  vi.resetModules()
  return import('./log')
}

describe('debug', () => {
  let log

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('stays silent by default', () => {
    // The default matters more than the enabled case: these logs print the
    // transcript and every reflected sentence — the most private content in the
    // app. Off unless someone deliberately asks.
    return importLog().then(({ debug }) => {
      debug('a transcript')
      expect(log).not.toHaveBeenCalled()
    })
  })

  it('logs when the flag is set to exactly "1"', async () => {
    localStorage.setItem('aporius_debug', '1')
    const { debug } = await importLog()
    debug('a transcript', 42)
    expect(log).toHaveBeenCalledWith('a transcript', 42)
  })

  it.each(['0', 'true', 'yes', ''])('stays silent for the flag value %o', async (value) => {
    localStorage.setItem('aporius_debug', value)
    const { debug } = await importLog()
    debug('a transcript')
    expect(log).not.toHaveBeenCalled()
  })

  it('stays silent, and does not throw, when storage is unavailable', async () => {
    // Safari in private mode throws on localStorage access. A logger that took
    // the app down with it would be worse than no logger.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { debug } = await importLog()
    expect(() => debug('a transcript')).not.toThrow()
    expect(log).not.toHaveBeenCalled()
  })
})
