/**
 * shared/zoom.ts
 *
 * WHAT: The rules for the chat text-size ("zoom") feature, shared by the main process (which spots the
 *       keyboard shortcuts) and the UI (which stores and applies the size).
 *
 * The size is a whole-number percentage of the normal chat text: 100 = as designed, 150 = one and a
 * half times as big. It only scales the chat rows, not the buttons and settings around them.
 */

export const ZOOM_DEFAULT = 100
export const ZOOM_MIN = 50
export const ZOOM_MAX = 250
export const ZOOM_STEP = 10

/** Turn anything into a valid zoom percentage: whole number, within the limits, 100 if unusable. */
export function clampZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ZOOM_DEFAULT
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)))
}

export type ZoomAction = 'in' | 'out' | 'reset'

/** The bits of a keyboard event we look at (Electron's `Input` and the browser's `KeyboardEvent` both fit). */
export interface ZoomKeyInput {
  key: string
  control?: boolean
  meta?: boolean
  alt?: boolean
  type?: string
}

/**
 * Which zoom action (if any) a key press means: Ctrl/Cmd and "+" (or "="), "-" or "0".
 * "=" counts as "+" because they are the same physical key on most keyboards, and people press
 * Ctrl+= without Shift.
 */
export function zoomActionForKey(input: ZoomKeyInput): ZoomAction | undefined {
  if (input.type && input.type !== 'keyDown') return undefined
  if (!(input.control || input.meta) || input.alt) return undefined
  if (input.key === '+' || input.key === '=') return 'in'
  if (input.key === '-' || input.key === '_') return 'out'
  if (input.key === '0') return 'reset'
  return undefined
}

/** The new zoom after an action (always valid). */
export function applyZoomAction(current: number, action: ZoomAction): number {
  if (action === 'reset') return ZOOM_DEFAULT
  const base = clampZoom(current)
  return clampZoom(base + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP))
}
