/**
 * tests/helpers/timers.ts
 *
 * `fastTimers(100)` makes every setTimeout of 100 ms or more fire 100 times sooner (a 1.2 s reconnect
 * delay becomes 12 ms), so retry/backoff behaviour can be tested in real time without long sleeps.
 * Shorter timers are untouched. Always call the returned function when done (use try/finally).
 */
const realSetTimeout = globalThis.setTimeout

export function fastTimers(factor = 100): () => void {
  const real = realSetTimeout
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    real(fn, ms !== undefined && ms >= 100 ? ms / factor : ms, ...args)) as typeof setTimeout
  return () => {
    globalThis.setTimeout = real
  }
}

/** Resolve after `ms` REAL milliseconds (never sped up, even inside fastTimers). */
export const sleep = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms))
