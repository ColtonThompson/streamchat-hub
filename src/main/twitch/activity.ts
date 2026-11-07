/**
 * main/twitch/activity.ts   (Twitch poll and prediction events -> app data)
 *
 * WHAT: Converts the events Twitch sends about polls and predictions into
 *   - a `ChannelActivity`: the LIVE STATE of that poll/prediction, shown as a card above the chat
 *     (renderer/src/components/ActivityPanel.tsx), replaced by each newer update with the same id; and
 *   - sometimes a `ChatMessage` ROW for the feed ("Poll started...", "Prediction resolved: Yes won"),
 *     for the moments worth keeping in the history: start and end of a poll; start, lock and end of a
 *     prediction. Every vote ("progress") only updates the card; it would flood the feed.
 *
 * It is PURE (no network, no timers), so it is easy to test with saved samples.
 *
 * WHERE THE EVENTS COME FROM: Twitch's "EventSub" service (twitch/eventsub.ts). The event names handled:
 *     channel.poll.begin / .progress / .end
 *     channel.prediction.begin / .progress / .lock / .end
 *
 * Like the YouTube parser, every field is read defensively: a missing or oddly shaped field becomes a
 * sensible default instead of a crash.
 */
import type { ChannelActivity, ChatMessage, PollChoice, PredictionOutcome } from '../../shared/types'

/** The event names we subscribe to. */
export const ACTIVITY_EVENTS = [
  'channel.poll.begin',
  'channel.poll.progress',
  'channel.poll.end',
  'channel.prediction.begin',
  'channel.prediction.progress',
  'channel.prediction.lock',
  'channel.prediction.end'
] as const

export interface ActivityUpdate {
  activity: ChannelActivity
  /** A feed row to add as well, for the moments listed above. */
  row?: ChatMessage
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : undefined)
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec).filter((x): x is Rec => !!x) : [])
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
/** An ISO timestamp ("2026-01-01T12:00:00Z") -> ms since 1970, or undefined. */
const time = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : undefined
}
const n = (v: number) => v.toLocaleString('en-US')

/** A feed row for an activity moment. The id is stable per stage, so the same moment can't appear twice. */
function row(a: ChannelActivity, stage: string, title: string, timestamp: number): ChatMessage {
  return {
    id: `activity-${a.kind}-${a.id}-${stage}`,
    platform: 'twitch',
    channelId: a.channelId,
    author: { name: '', badges: [] },
    parts: [],
    timestamp,
    event: { type: a.kind, title }
  }
}

// ------------------------------------------------------------------------------------- polls

const POLL_STATUS = { completed: 'completed', terminated: 'terminated', archived: 'archived' } as const

/** "A won with 55% (123 votes)", "Tie between A and B", or "no votes". */
function pollResult(choices: PollChoice[]): string {
  const total = choices.reduce((sum, c) => sum + c.votes, 0)
  if (total === 0) return 'no votes were cast'
  const top = Math.max(...choices.map((c) => c.votes))
  const winners = choices.filter((c) => c.votes === top)
  if (winners.length > 1) return `tie between ${winners.map((w) => w.title).join(' and ')} (${n(top)} votes each)`
  return `${winners[0].title} won with ${Math.round((top / total) * 100)}% (${n(top)} of ${n(total)} votes)`
}

function parsePoll(stage: 'begin' | 'progress' | 'end', e: Rec): ActivityUpdate | undefined {
  const id = str(e.id)
  if (!id) return undefined
  const choices: PollChoice[] = list(e.choices).map((c) => ({
    id: str(c.id) ?? '',
    title: str(c.title) ?? '',
    // `votes` is the total over every voting method; fall back to adding the parts if it is missing.
    votes: num(c.votes) ?? (num(c.channel_points_votes) ?? 0) + (num(c.bits_votes) ?? 0)
  }))
  const ended = stage === 'end'
  const activity: ChannelActivity = {
    kind: 'poll',
    id,
    channelId: (str(e.broadcaster_user_login) ?? '').toLowerCase(),
    title: str(e.title) ?? 'Poll',
    choices,
    status: ended ? (POLL_STATUS[str(e.status) as keyof typeof POLL_STATUS] ?? 'completed') : 'active',
    startedAt: time(e.started_at) ?? Date.now(),
    endsAt: ended ? undefined : time(e.ends_at),
    endedAt: ended ? (time(e.ended_at) ?? Date.now()) : undefined
  }
  if (stage === 'begin') {
    return { activity, row: row(activity, 'begin', `Poll started: “${activity.title}” — ${choices.map((c) => c.title).join(' · ')}`, activity.startedAt) }
  }
  if (ended) {
    const ts = activity.endedAt as number
    const title =
      activity.status === 'archived'
        ? `Poll archived: “${activity.title}”`
        : `Poll ${activity.status === 'terminated' ? 'ended early' : 'ended'}: “${activity.title}” — ${pollResult(choices)}`
    return { activity, row: row(activity, 'end', title, ts) }
  }
  return { activity } // progress: update the card only
}

// ------------------------------------------------------------------------------- predictions

function parsePrediction(stage: 'begin' | 'progress' | 'lock' | 'end', e: Rec): ActivityUpdate | undefined {
  const id = str(e.id)
  if (!id) return undefined
  const outcomes: PredictionOutcome[] = list(e.outcomes).map((o) => ({
    id: str(o.id) ?? '',
    title: str(o.title) ?? '',
    color: str(o.color) ?? 'blue',
    users: num(o.users) ?? 0,
    points: num(o.channel_points) ?? 0,
    // Twitch lists up to 10 predictors; the card only has room for a few. `channel_points_won` is null until resolved.
    topPredictors: list(o.top_predictors)
      .slice(0, 5)
      .map((p) => ({
        name: str(p.user_name) ?? str(p.user_login) ?? 'someone',
        pointsUsed: num(p.channel_points_used) ?? 0,
        pointsWon: num(p.channel_points_won)
      }))
  }))

  let status: Extract<ChannelActivity, { kind: 'prediction' }>['status'] = 'active'
  if (stage === 'lock') status = 'locked'
  if (stage === 'end') status = str(e.status) === 'canceled' ? 'canceled' : 'resolved'

  const activity: ChannelActivity = {
    kind: 'prediction',
    id,
    channelId: (str(e.broadcaster_user_login) ?? '').toLowerCase(),
    title: str(e.title) ?? 'Prediction',
    outcomes,
    status,
    startedAt: time(e.started_at) ?? Date.now(),
    locksAt: status === 'active' ? time(e.locks_at) : undefined,
    endedAt: stage === 'end' ? (time(e.ended_at) ?? Date.now()) : undefined,
    winningOutcomeId: stage === 'end' && status === 'resolved' ? str(e.winning_outcome_id) : undefined
  }

  switch (stage) {
    case 'begin':
      return { activity, row: row(activity, 'begin', `Prediction started: “${activity.title}” — ${outcomes.map((o) => o.title).join(outcomes.length === 2 ? ' vs ' : ' · ')}`, activity.startedAt) }
    case 'lock':
      return { activity, row: row(activity, 'lock', `Prediction locked: “${activity.title}” — no more predictions`, time(e.locked_at) ?? Date.now()) }
    case 'end': {
      const ts = activity.endedAt as number
      if (status === 'canceled') return { activity, row: row(activity, 'end', `Prediction canceled: “${activity.title}” — points refunded`, ts) }
      const winner = outcomes.find((o) => o.id === activity.winningOutcomeId)
      return { activity, row: row(activity, 'end', `Prediction resolved: “${activity.title}” — ${winner ? `${winner.title} won` : 'result in'}`, ts) }
    }
    default:
      return { activity } // progress: update the card only
  }
}

// ------------------------------------------------------------------------------- entry point

/** One EventSub event -> its update, or undefined for an unknown type or an unusable payload. */
export function parseActivityEvent(type: string, event: unknown): ActivityUpdate | undefined {
  const e = rec(event)
  if (!e) return undefined
  switch (type) {
    case 'channel.poll.begin':
      return parsePoll('begin', e)
    case 'channel.poll.progress':
      return parsePoll('progress', e)
    case 'channel.poll.end':
      return parsePoll('end', e)
    case 'channel.prediction.begin':
      return parsePrediction('begin', e)
    case 'channel.prediction.progress':
      return parsePrediction('progress', e)
    case 'channel.prediction.lock':
      return parsePrediction('lock', e)
    case 'channel.prediction.end':
      return parsePrediction('end', e)
    default:
      return undefined
  }
}
