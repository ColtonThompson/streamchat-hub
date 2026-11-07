/**
 * renderer/src/components/ModToolbar.tsx   (the hover buttons for moderators)
 *
 * WHAT: A small floating toolbar on the right of a message row, visible only while hovering (or
 *       keyboard-focusing) that row. CSS controls the showing/hiding (see `.mod-toolbar` in styles.css).
 *
 *   On a chat line:       [Delete]  |  [1m] [10m] [1h]  |  [Ban]
 *   On a "was banned/timed out" note:  [Undo]  (lifts the ban/timeout)
 *
 * IT ONLY SENDS REQUESTS. Pressing a button calls `window.api.moderate(...)`. The screen does NOT
 * change from that call; when Twitch accepts the action it announces it on chat, which arrives as a
 * ModerationEvent and updates the row (see lib/moderation.ts). If Twitch refuses (e.g. you aren't a
 * moderator there), the reason appears as a toast.
 *
 * WHO SEES IT: only when moderation tools are enabled for the signed-in account, the row is a Twitch
 * message from someone else (not you, not the broadcaster), and it hasn't already been removed.
 *
 * BAN NEEDS TWO CLICKS: the first turns the button red ("Confirm ban"); it resets after 3 seconds.
 *
 * CHANGE IT WHEN: you want other timeout lengths (edit TIMEOUT_PRESETS) or more actions.
 */
import { useEffect, useState } from 'react'
import type { ChatMessage, ModerationCommand } from '../../../shared/types'
import { useChatStore } from '../store/chatStore'

/** The timeout buttons shown. `label` is the button text; `seconds` is how long (Twitch allows 1 to 1,209,600). */
const TIMEOUT_PRESETS = [
  { label: '1m', seconds: 60 },
  { label: '10m', seconds: 600 },
  { label: '1h', seconds: 3600 }
]

export function ModToolbar({ msg }: { msg: ChatMessage }) {
  const auth = useChatStore((s) => s.auth)
  const showToast = useChatStore((s) => s.showToast)
  const [armed, setArmed] = useState(false) // true after the first click on Ban
  const [busy, setBusy] = useState(false) // true while a request is in flight (prevents double clicks)

  // Un-arm the Ban button after 3 s. The returned function cancels the timer if we un-arm earlier.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  // ---- should anything be shown at all? (hooks above must run first, hence the check down here) ----
  if (!auth.canModerate || msg.platform !== 'twitch') return null

  const isNote = msg.event?.type === 'moderation' && !!msg.event.target?.userId
  const isRegularMessage =
    !msg.event &&
    !msg.removed &&
    !!msg.author.id &&
    msg.author.id !== auth.userId && // never offer to ban yourself
    !msg.author.badges.some((b) => b.id.startsWith('broadcaster/')) // or the channel owner
  if (!isNote && !isRegularMessage) return null

  /** Send a command; show Twitch's reason as a toast if it fails. */
  async function run(command: ModerationCommand, successText?: string) {
    setBusy(true)
    try {
      const result = await window.api.moderate(command)
      if (!result.ok) showToast(result.error ?? 'That did not work.', 'error')
      else if (successText) showToast(successText, 'info')
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  const base = { platform: msg.platform, channel: msg.channelId }

  // A "was banned / timed out" note: offer to undo it.
  if (isNote) {
    const target = msg.event!.target!
    return (
      <div className="mod-toolbar">
        <button
          className="mod-btn"
          disabled={busy}
          title={`Lift the ban or timeout on ${target.login}`}
          onClick={() => void run({ ...base, action: 'unban', userId: target.userId! }, `Unbanned ${target.login}`)}
        >
          Undo
        </button>
      </div>
    )
  }

  // A normal chat line: delete / timeout presets / ban.
  return (
    <div className="mod-toolbar">
      <button className="mod-btn" disabled={busy} title="Delete this message" onClick={() => void run({ ...base, action: 'delete', messageId: msg.id })}>
        Delete
      </button>
      <span className="mod-sep" />
      {TIMEOUT_PRESETS.map((p) => (
        <button
          key={p.label}
          className="mod-btn"
          disabled={busy}
          title={`Time ${msg.author.name} out for ${p.label}`}
          onClick={() => void run({ ...base, action: 'timeout', userId: msg.author.id!, durationSec: p.seconds })}
        >
          {p.label}
        </button>
      ))}
      <span className="mod-sep" />
      <button
        className="mod-btn"
        data-danger="true"
        data-armed={armed}
        disabled={busy}
        title={`Permanently ban ${msg.author.name}`}
        onClick={() => (armed ? void run({ ...base, action: 'ban', userId: msg.author.id! }) : setArmed(true))}
      >
        {armed ? 'Confirm ban' : 'Ban'}
      </button>
    </div>
  )
}
