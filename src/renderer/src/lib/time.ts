/**
 * renderer/src/lib/time.ts
 *
 * WHAT: Formats the optional timestamp shown at the start of each message ("3:45 PM", "15:45:07").
 *
 * HOW IT WORKS: the browser's built-in `Intl.DateTimeFormat` does the formatting in the user's local
 * time zone and system language. Creating one is comparatively slow, so each distinct style gets one
 * formatter that is built on first use and reused for every row afterwards.
 *
 * `TimeStyle` is the user's two timestamp settings (mode + "show seconds") folded into one value, so
 * a row only needs a single prop. `'off'` means "show no time". See `timeStyleOf`.
 *
 * HOW IT FITS: ChatFeed calls `timeStyleOf` with the settings and passes the result to each row;
 * MessageRow and the Chat settings preview call `formatTime`.
 */
import type { TimestampMode } from './settings'

export type TimeStyle = 'off' | '12h' | '12h-seconds' | '24h' | '24h-seconds'

/** Combine the two saved settings into one style. */
export function timeStyleOf(mode: TimestampMode, seconds: boolean): TimeStyle {
  if (mode === 'off') return 'off'
  if (mode === '12h') return seconds ? '12h-seconds' : '12h'
  return seconds ? '24h-seconds' : '24h'
}

/** One formatter per (locale, style), created lazily. */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(style: Exclude<TimeStyle, 'off'>, locale?: string): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${style}`
  let f = formatters.get(key)
  if (!f) {
    const is24 = style.startsWith('24h')
    f = new Intl.DateTimeFormat(locale, {
      hour: is24 ? '2-digit' : 'numeric',
      minute: '2-digit',
      second: style.endsWith('seconds') ? '2-digit' : undefined,
      // hourCycle (not hour12) so 24-hour time shows "00:05", never "24:05", just after midnight.
      hourCycle: is24 ? 'h23' : 'h12'
    })
    formatters.set(key, f)
  }
  return f
}

/**
 * `ms` is a time in milliseconds since 1970 (what `ChatMessage.timestamp` holds). Returns '' for the
 * 'off' style or an unusable number, so callers never have to guard.
 * `locale` is only for tests; normally omitted so the user's system language is used.
 */
export function formatTime(ms: number, style: TimeStyle, locale?: string): string {
  if (style === 'off' || !Number.isFinite(ms)) return ''
  return formatterFor(style, locale).format(ms)
}
