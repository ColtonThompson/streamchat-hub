/**
 * renderer/src/components/ActivityPanel.tsx   (live poll and prediction cards)
 *
 * WHAT: Shows the polls and predictions running in YOUR Twitch channel as cards above the chat,
 *       updating live as votes come in:
 *   - POLL:       each choice with a bar, vote count and percentage, plus a countdown while voting.
 *   - PREDICTION: each outcome with a bar (share of Channel Points), points, viewers and payout; after the
 *                 result, the winner is marked and the top winners are listed.
 * Finished cards stay for two minutes so the result can be read, or can be closed with the x.
 *
 * It renders NOTHING when there is nothing to show, so it takes no space the rest of the time.
 *
 * DATA: `activities` in the chat store, filled from the main process (twitch/eventsub.ts ->
 * twitch/activity.ts -> bus). The numbers and words come from lib/activity.ts; the look is in styles.css
 * (search "ACTIVITY").
 *
 * The clock: a 1-second timer runs ONLY while some card has a countdown or an expiring result.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { ChannelActivity } from '../../../shared/types'
import { activityVisible, fmt, needsClock, pollRows, pollStatusText, predictionRows, predictionStatusText } from '../lib/activity'
import { activityKey, useChatStore } from '../store/chatStore'

type Poll = Extract<ChannelActivity, { kind: 'poll' }>
type Prediction = Extract<ChannelActivity, { kind: 'prediction' }>

/** The current time, refreshed every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function Card({ a, status, onClose, children }: { a: ChannelActivity; status: string; onClose: () => void; children: ReactNode }) {
  return (
    <article className="activity" data-kind={a.kind} data-status={a.status}>
      <header className="activity-head">
        <span className="activity-tag">{a.kind === 'poll' ? 'Poll' : 'Prediction'}</span>
        <span className="activity-status">{status}</span>
        <button className="activity-close" onClick={onClose} aria-label={`Close this ${a.kind}`} title="Close">
          ×
        </button>
      </header>
      <h4 className="activity-title">{a.title}</h4>
      {children}
    </article>
  )
}

function PollCard({ a, now, onClose }: { a: Poll; now: number; onClose: () => void }) {
  const { rows, total } = pollRows(a)
  return (
    <Card a={a} status={pollStatusText(a, now)} onClose={onClose}>
      <ul className="activity-rows">
        {rows.map((r) => (
          // --pct sizes the bar behind the row (see .activity-row in styles.css).
          <li key={r.id} className="activity-row" data-leading={r.leading} style={{ ['--pct' as string]: `${r.pct}%` }}>
            <span className="activity-label">{r.title}</span>
            <span className="activity-value">
              {fmt(r.votes)} · {r.pct}%
            </span>
          </li>
        ))}
      </ul>
      <p className="activity-foot">{fmt(total)} votes</p>
    </Card>
  )
}

function PredictionCard({ a, now, onClose }: { a: Prediction; now: number; onClose: () => void }) {
  const { rows, totalPoints, totalUsers } = predictionRows(a)
  const winner = rows.find((r) => r.winner)
  const winners = winner?.topPredictors.filter((p) => p.pointsWon).slice(0, 3) ?? []
  return (
    <Card a={a} status={predictionStatusText(a, now)} onClose={onClose}>
      <ul className="activity-rows">
        {rows.map((r) => (
          <li
            key={r.id}
            className="activity-row"
            data-color={r.color}
            data-winner={r.winner}
            style={{ ['--pct' as string]: `${r.pct}%` }}
          >
            <span className="activity-label">
              {r.winner && <span aria-label="Winner">✓ </span>}
              {r.title}
            </span>
            <span className="activity-value">
              {fmt(r.points)} pts · {fmt(r.users)} {r.users === 1 ? 'viewer' : 'viewers'} · {r.payout}
            </span>
          </li>
        ))}
      </ul>
      {winners.length > 0 && (
        <p className="activity-foot">Top winners: {winners.map((p) => `${p.name} +${fmt(p.pointsWon ?? 0)}`).join(' · ')}</p>
      )}
      <p className="activity-foot">
        {fmt(totalPoints)} points from {fmt(totalUsers)} viewers
      </p>
    </Card>
  )
}

export function ActivityPanel() {
  const activities = useChatStore((s) => s.activities)
  const dismiss = useChatStore((s) => s.dismissActivity)
  const all = Object.values(activities)
  const now = useNow(all.some(needsClock))

  const shown = all.filter((a) => activityVisible(a, now)).sort((x, y) => x.startedAt - y.startedAt)
  if (shown.length === 0) return null

  return (
    <section className="activity-panel" aria-label="Polls and predictions" aria-live="polite">
      {shown.map((a) =>
        a.kind === 'poll' ? (
          <PollCard key={activityKey(a)} a={a} now={now} onClose={() => dismiss(activityKey(a))} />
        ) : (
          <PredictionCard key={activityKey(a)} a={a} now={now} onClose={() => dismiss(activityKey(a))} />
        )
      )}
    </section>
  )
}
