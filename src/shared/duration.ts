/**
 * shared/duration.ts
 *
 * WHAT: Timeout lengths: the limits Twitch allows, how to show one ("1h 30m"), and how to turn the
 *       "amount + unit" pair in Settings into seconds and back. Shared by the main process (which checks the
 *       length before asking Twitch) and the UI.
 */

/** Twitch allows timeouts from 1 second to 2 weeks. */
export const TIMEOUT_MIN = 1
export const TIMEOUT_MAX = 1_209_600
/** What the T key uses until the user picks something else: 10 minutes. */
export const TIMEOUT_DEFAULT = 600

/** Any value -> a valid whole number of seconds between the limits (the default when it is not a usable number). */
export function clampTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TIMEOUT_DEFAULT
  return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(value)))
}

/** 5400 -> "1h 30m". Shows at most the two largest units. */
export function formatDuration(seconds: number): string {
  const units: [number, string][] = [[604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']]
  const out: string[] = []
  let rest = seconds
  for (const [size, label] of units) {
    const n = Math.floor(rest / size)
    if (n > 0) {
      out.push(`${n}${label}`)
      rest -= n * size
    }
    if (out.length === 2) break
  }
  return out.join(' ') || '0s'
}

export type DurationUnit = 's' | 'm' | 'h' | 'd'

/** The units offered in Settings, smallest first. */
export const DURATION_UNITS: { id: DurationUnit; label: string; seconds: number }[] = [
  { id: 's', label: 'seconds', seconds: 1 },
  { id: 'm', label: 'minutes', seconds: 60 },
  { id: 'h', label: 'hours', seconds: 3600 },
  { id: 'd', label: 'days', seconds: 86400 }
]

/** 600 -> { amount: 10, unit: 'm' }: the largest unit that divides the length evenly (so 90 s stays "90 seconds"). */
export function splitDuration(seconds: number): { amount: number; unit: DurationUnit } {
  const s = clampTimeout(seconds)
  for (const u of [...DURATION_UNITS].reverse()) {
    if (s % u.seconds === 0) return { amount: s / u.seconds, unit: u.id }
  }
  return { amount: s, unit: 's' } // not reachable (1 divides everything), but keeps the types honest
}

/** 10 + 'm' -> 600, kept within Twitch's limits. */
export function toSeconds(amount: number, unit: DurationUnit): number {
  const size = DURATION_UNITS.find((u) => u.id === unit)?.seconds ?? 1
  return clampTimeout(amount * size)
}
