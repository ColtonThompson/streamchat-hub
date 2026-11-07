/**
 * renderer/src/lib/activity.ts   (what the poll/prediction cards show)
 *
 * WHAT: Pure helpers that turn a `ChannelActivity` (shared/types.ts) into the numbers and words the cards
 *       display: percentages, odds, countdown text, status labels, and whether a card should still be shown.
 *       No React here, so it is easy to test.
 *
 * HOW IT FITS: components/ActivityPanel.tsx calls these on every render.
 */
import type { ChannelActivity, PollChoice, PredictionOutcome } from '../../../shared/types'

type Poll = Extract<ChannelActivity, { kind: 'poll' }>
type Prediction = Extract<ChannelActivity, { kind: 'prediction' }>

/** How long a finished poll/prediction stays on screen so the result can be read. */
export const RESULT_VISIBLE_MS = 2 * 60_000
/** An "active" poll this long past its end time is assumed stale (we missed its end event) and is hidden. */
const STALE_AFTER_MS = 2 * 60_000

/** Whether a card should be on screen at time `now`. */
export function activityVisible(a: ChannelActivity, now: number): boolean {
  if (a.endedAt) return now - a.endedAt < RESULT_VISIBLE_MS
  // A poll that should have ended minutes ago but never said so: we probably lost the end event.
  if (a.kind === 'poll' && a.endsAt && now - a.endsAt > STALE_AFTER_MS) return false
  return true
}

/** Does this card need a ticking clock (a live countdown, or a result that will expire)? */
export function needsClock(a: ChannelActivity): boolean {
  return !!a.endedAt || (a.kind === 'poll' ? !!a.endsAt : a.status === 'active' && !!a.locksAt)
}

/** 83000 -> "1:23", 3725000 -> "1:02:05". Returns '' once the time has passed. */
export function countdown(target: number | undefined, now: number): string {
  if (!target) return ''
  const total = Math.ceil((target - now) / 1000)
  if (total <= 0) return ''
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v: number) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Percent of `part` in `total`, whole number; 0 when there is nothing yet. */
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0)

// -------------------------------------------------------------------------------------- polls

export interface PollRow extends PollChoice {
  pct: number
  /** The choice in front (or tied for the lead). False for everyone while there are no votes. */
  leading: boolean
}

export function pollRows(a: Poll): { rows: PollRow[]; total: number } {
  const total = a.choices.reduce((sum, c) => sum + c.votes, 0)
  const top = Math.max(0, ...a.choices.map((c) => c.votes))
  return { total, rows: a.choices.map((c) => ({ ...c, pct: pct(c.votes, total), leading: top > 0 && c.votes === top })) }
}

export function pollStatusText(a: Poll, now: number): string {
  switch (a.status) {
    case 'completed':
      return 'Final results'
    case 'terminated':
      return 'Ended early'
    case 'archived':
      return 'Archived'
    default: {
      const left = countdown(a.endsAt, now)
      return left ? `Voting · ${left}` : 'Voting'
    }
  }
}

// ------------------------------------------------------------------------------- predictions

export interface PredictionRow extends PredictionOutcome {
  /** Share of all Channel Points, whole percent. */
  pct: number
  /** What a winning point returns, e.g. "2.4x" ("-" while nobody has bet on this side). */
  payout: string
  winner: boolean
}

export function predictionRows(a: Prediction): { rows: PredictionRow[]; totalPoints: number; totalUsers: number } {
  const totalPoints = a.outcomes.reduce((sum, o) => sum + o.points, 0)
  const totalUsers = a.outcomes.reduce((sum, o) => sum + o.users, 0)
  return {
    totalPoints,
    totalUsers,
    rows: a.outcomes.map((o) => ({
      ...o,
      pct: pct(o.points, totalPoints),
      payout: o.points > 0 ? `${(totalPoints / o.points).toFixed(totalPoints / o.points >= 10 ? 0 : 1)}x` : '-',
      winner: a.status === 'resolved' && o.id === a.winningOutcomeId
    }))
  }
}

export function predictionStatusText(a: Prediction, now: number): string {
  switch (a.status) {
    case 'locked':
      return 'Locked · waiting for the result'
    case 'resolved':
      return 'Resolved'
    case 'canceled':
      return 'Canceled · points refunded'
    default: {
      const left = countdown(a.locksAt, now)
      return left ? `Open · locks in ${left}` : 'Open'
    }
  }
}

/** A number with thousands separators, e.g. 12345 -> "12,345". */
export const fmt = (v: number) => v.toLocaleString('en-US')
