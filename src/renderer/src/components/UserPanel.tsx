/**
 * renderer/src/components/UserPanel.tsx   (a moderator's view of one person)
 *
 * WHAT: Click a chat message (moderation tools on) and this panel opens over the chat with that person's messages
 *       from this session, newest at the bottom, and the moderation buttons. It replaces the old hover toolbar.
 *
 *   HOTKEYS (while the panel is open)
 *     T  time them out for the length set in Settings -> Chat -> Moderation
 *     B  ban them. The first press arms it ("Confirm ban"), pressing B again confirms; it disarms after 3 seconds
 *     U  lift a ban or timeout (shown when they were banned/timed out, or the panel was opened from such a note)
 *     Esc  close
 *   Each message in the list also has its own Delete button.
 *
 * IT ONLY SENDS REQUESTS: `window.api.moderate(...)`. The chat updates when Twitch announces the action (see
 * lib/moderation.ts); a refusal (e.g. you are not a moderator there) appears as a toast and the panel stays open.
 * After a ban, timeout or unban succeeds the panel closes, so the next click can go straight to the next message.
 *
 * The rules (who is clickable, which messages belong, what a key means) are in lib/modpanel.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { channelTag } from '../../../shared/channels'
import { formatDuration } from '../../../shared/duration'
import type { ModerationCommand, RemovedReason } from '../../../shared/types'
import { modKeyAction, userHistory, userStatus } from '../lib/modpanel'
import { formatTime, timeStyleOf } from '../lib/time'
import { useChatStore } from '../store/chatStore'
import { useModStore } from '../store/modStore'
import { useSettingsStore } from '../store/settingsStore'
import { Part } from './MessageRow'

const STATE_LABEL: Record<RemovedReason, string> = { deleted: 'deleted', timeout: 'timed out', ban: 'banned' }

export function UserPanel() {
  const target = useModStore((s) => s.target)
  const close = useModStore((s) => s.close)
  const canModerate = useChatStore((s) => s.auth.canModerate)
  const me = useChatStore((s) => s.auth.login)?.toLowerCase()
  const messages = useChatStore((s) => s.messages)
  const showToast = useChatStore((s) => s.showToast)
  const timeoutSeconds = useSettingsStore((s) => s.timeoutSeconds)
  const timestamps = useSettingsStore((s) => s.timestamps)
  const timestampSeconds = useSettingsStore((s) => s.timestampSeconds)

  const [armed, setArmed] = useState(false) // true after the first B press / Ban click
  const [busy, setBusy] = useState(false) // a request is in flight (stops double sends)
  const dialog = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const history = useMemo(() => (target ? userHistory(messages, target) : []), [messages, target])
  const status = userStatus(history)
  const readOnly = !!target?.readOnly
  const offerUnban = !!target && !readOnly && (status !== undefined || !!target.fromNote)

  // A new person (or closing) starts from a clean state; focus moves into the panel, and back to the row on close.
  useEffect(() => {
    setArmed(false)
    setBusy(false)
    if (!target) return
    dialog.current?.focus()
    return () => useModStore.getState().returnFocus?.focus?.()
  }, [target])

  // Moderation tools switched off (e.g. signed out) while the panel is open: nothing it offers would work.
  useEffect(() => {
    if (target && !canModerate) close()
  }, [target, canModerate, close])

  // Un-arm Ban after 3 s.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  // Newest message in view whenever the list changes.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [history.length, target])

  /** Send a command. On failure show Twitch's reason; on success of a person-level action, say so and close. */
  async function run(command: ModerationCommand, successText?: string) {
    setBusy(true)
    try {
      const result = await window.api.moderate(command)
      if (!result.ok) {
        showToast(result.error ?? 'That did not work.', 'error')
        return
      }
      if (successText) showToast(successText, 'info')
      if (command.action !== 'delete') close()
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  const base = target ? { platform: target.platform, channel: target.channelId } : undefined
  const actions = {
    timeout: () => {
      if (!target || !base || busy || readOnly) return
      void run({ ...base, action: 'timeout', userId: target.userId, durationSec: timeoutSeconds }, `Timed out ${target.name} for ${formatDuration(timeoutSeconds)}`)
    },
    ban: () => {
      if (!target || !base || busy || readOnly) return
      if (!armed) setArmed(true)
      else void run({ ...base, action: 'ban', userId: target.userId }, `Banned ${target.name}`)
    },
    unban: () => {
      if (!target || !base || busy || !offerUnban) return
      void run({ ...base, action: 'unban', userId: target.userId }, `Unbanned ${target.name}`)
    }
  }

  // Hotkeys. The listener is registered once per open panel and always calls the latest actions.
  const latest = useRef(actions)
  latest.current = actions
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const action = modKeyAction(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation() // the Settings panel also closes on Esc: this panel is on top, so it takes the key
      if (e.repeat) return // holding a key must not confirm a ban
      if (action === 'close') close()
      else latest.current[action]()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [target, close])

  if (!target || !canModerate) return null

  const style = timeStyleOf(timestamps, timestampSeconds)
  const timeStyle = style === 'off' ? '12h' : style

  return (
    <div
      className="mp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div ref={dialog} className="mp" role="dialog" aria-modal="true" aria-labelledby="mp-title" tabIndex={-1}>
        <header className="mp-head">
          <h2 id="mp-title" className="mp-title">
            {target.name}
          </h2>
          <span className="mp-where">{channelTag({ platform: target.platform, channelId: target.channelId })}</span>
          {status && <span className="mp-status" data-status={status}>{status === 'banned' ? 'Banned' : 'Timed out'}</span>}
          <span className="mp-count">
            {history.length} {history.length === 1 ? 'message' : 'messages'} this session
          </span>
        </header>

        <ul ref={list} className="mp-list" aria-label={`Messages from ${target.name} this session`}>
          {history.length === 0 && <li className="mp-empty">No messages from {target.name} yet in this session.</li>}
          {history.map((m) => (
            <li key={m.id} className="mp-msg" data-removed={m.removed || undefined}>
              <time className="mp-time">{formatTime(m.timestamp, timeStyle)}</time>
              <span className="mp-text">
                {m.parts.map((p, i) => (
                  <Part key={i} part={p} me={me} />
                ))}
              </span>
              {readOnly ? null : m.removed ? (
                <span className="mp-state">{STATE_LABEL[m.removed]}</span>
              ) : (
                <button
                  className="mp-del"
                  disabled={busy}
                  title="Delete this message"
                  onClick={() => base && void run({ ...base, action: 'delete', messageId: m.id })}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>

        {readOnly && <p className="mp-hint" data-info="true">This is {target.name.toLowerCase() === me ? 'you' : 'the channel owner'}, so there are no ban or timeout options.</p>}
        {armed && <p className="mp-hint" role="status">Press B again, or click, to confirm the ban. It cancels itself in 3 seconds.</p>}

        <footer className="mp-actions">
          {!readOnly && <button className="mp-btn" disabled={busy} onClick={actions.timeout} title={`Time ${target.name} out for ${formatDuration(timeoutSeconds)} (change in Settings → Chat)`}>
            Timeout {formatDuration(timeoutSeconds)} <kbd>T</kbd>
          </button>}
          {!readOnly && <button className="mp-btn" data-danger="true" data-armed={armed} disabled={busy} onClick={actions.ban} title={`Permanently ban ${target.name}`}>
            {armed ? 'Confirm ban' : 'Ban'} <kbd>B</kbd>
          </button>}
          {offerUnban && (
            <button className="mp-btn" disabled={busy} onClick={actions.unban} title={`Lift the ban or timeout on ${target.name}`}>
              Unban <kbd>U</kbd>
            </button>
          )}
          <button className="mp-btn mp-close" onClick={close}>
            Close <kbd>Esc</kbd>
          </button>
        </footer>
      </div>
    </div>
  )
}
