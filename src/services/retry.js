export async function withRetry(fn, maxRetries, timeoutMs) {
  let lastErr
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out')), timeoutMs),
        ),
      ])
    } catch (err) {
      lastErr = err
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }
  throw lastErr
}

export function isOnline() {
  return navigator.onLine
}
