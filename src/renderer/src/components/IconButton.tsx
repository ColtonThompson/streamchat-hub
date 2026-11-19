/**
 * renderer/src/components/IconButton.tsx   (a square icon button with a tooltip)
 *
 * WHAT: The top bar's small tools (pin on top, clear, settings) are icons only, to keep the bar uncluttered. The
 * `label` is both the tooltip (shown on hover and keyboard focus, drawn by CSS from `data-tip`) and the accessible name
 * that screen readers announce. `pressed` makes it a toggle. `align="end"` keeps the tooltip inside the window for a
 * button at the right edge.
 */
import type { ReactNode } from 'react'

interface Props {
  label: string
  onClick: () => void
  children: ReactNode
  /** Makes it an on/off button; true draws it as "on". Leave undefined for a plain button. */
  pressed?: boolean
  align?: 'start' | 'end'
  /** A small dot on the corner (used for "an update is waiting"). */
  dot?: string
}

export function IconButton({ label, onClick, children, pressed, align = 'start', dot }: Props) {
  return (
    <button className="icon-btn" type="button" data-tip={label} data-tip-align={align} data-on={pressed} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      {children}
      {dot && <span className="update-dot icon-btn-dot" role="img" aria-label={dot} />}
    </button>
  )
}
