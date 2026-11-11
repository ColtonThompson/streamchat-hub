/**
 * renderer/src/components/settings/ChatTab.tsx
 *
 * WHAT: Settings that change how chat is displayed.
 *
 * 1. TIMESTAMPS: Off / 12-hour / 24-hour, plus an optional "show seconds". The preview line shows
 *    exactly how a time will look. (ChatFeed passes the choice to every row; lib/time.ts formats it.)
 *
 * 2. MESSAGE BLACKLIST: messages containing any listed word or phrase are hidden (rules in
 *    lib/blacklist.ts: case-insensitive, matches inside words, only ordinary chat lines).
 *    Hidden messages are not deleted, only filtered out of view, so removing a term brings them back.
 *    The list is saved between launches (settingsStore).
 *
 * The "Clear all" button needs two clicks (and un-arms itself after 3 seconds) so a stray click can't
 * wipe a long list.
 */
import { useEffect, useMemo, useState } from 'react'
import { DURATION_UNITS, formatDuration, splitDuration, toSeconds, type DurationUnit } from '../../../../shared/duration'
import { compileBlacklist } from '../../lib/blacklist'
import { MAX_BLACKLIST_TERMS, MAX_TERM_LENGTH, type TimestampMode } from '../../lib/settings'
import { formatTime, timeStyleOf } from '../../lib/time'
import { useChatStore } from '../../store/chatStore'
import { useSettingsStore, type AddTermResult } from '../../store/settingsStore'

const TIMESTAMP_CHOICES: { id: TimestampMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: '12h', label: '12-hour' },
  { id: '24h', label: '24-hour' }
]

/** What to tell the user when a term can't be added ('added' needs no message). */
const ADD_NOTES: Record<Exclude<AddTermResult, 'added'>, string> = {
  empty: 'Type a word or phrase first.',
  duplicate: 'That is already in the list.',
  'too-long': `Terms can be up to ${MAX_TERM_LENGTH} characters.`,
  full: `The list is full (${MAX_BLACKLIST_TERMS} terms). Remove one to add another.`
}

export function ChatTab() {
  // ---- timestamps ----
  const mode = useSettingsStore((s) => s.timestamps)
  const seconds = useSettingsStore((s) => s.timestampSeconds)
  const setMode = useSettingsStore((s) => s.setTimestamps)
  const setSeconds = useSettingsStore((s) => s.setTimestampSeconds)
  const style = timeStyleOf(mode, seconds)

  // ---- moderation ----
  const timeoutSeconds = useSettingsStore((s) => s.timeoutSeconds)
  const setTimeoutSeconds = useSettingsStore((s) => s.setTimeoutSeconds)
  const split = splitDuration(timeoutSeconds)
  const [amountText, setAmountText] = useState(String(split.amount))
  const [unit, setUnit] = useState<DurationUnit>(split.unit)
  // Keep the boxes in step if the saved length changes from elsewhere (e.g. loaded at startup).
  useEffect(() => {
    const s = splitDuration(timeoutSeconds)
    setAmountText((t) => (toSeconds(Number(t), unit) === timeoutSeconds ? t : String(s.amount)))
    setUnit((u) => (toSeconds(Number(amountText), u) === timeoutSeconds ? u : s.unit))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutSeconds])
  const commitTimeout = (text: string, u: DurationUnit) => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n) && n > 0) setTimeoutSeconds(toSeconds(n, u))
  }

  // ---- mention alerts ----
  const pingAlerts = useSettingsStore((s) => s.pingAlerts)
  const pingSound = useSettingsStore((s) => s.pingSound)
  const pingNames = useSettingsStore((s) => s.pingNames)
  const setPingAlerts = useSettingsStore((s) => s.setPingAlerts)
  const setPingSound = useSettingsStore((s) => s.setPingSound)
  const setPingNames = useSettingsStore((s) => s.setPingNames)
  const myLogin = useChatStore((s) => s.auth.login)
  const [namesText, setNamesText] = useState(pingNames.join(', '))
  const commitNames = () => {
    setPingNames(namesText.split(/[\s,]+/).filter(Boolean))
    setNamesText(useSettingsStore.getState().pingNames.join(', ')) // show what was kept
  }

  // ---- stream info ----
  const showInfo = useSettingsStore((s) => s.showStreamInfo)
  const setShowInfo = useSettingsStore((s) => s.setShowStreamInfo)

  // ---- blacklist ----
  const blacklist = useSettingsStore((s) => s.blacklist)
  const addTerm = useSettingsStore((s) => s.addBlacklistTerm)
  const removeTerm = useSettingsStore((s) => s.removeBlacklistTerm)
  const clearTerms = useSettingsStore((s) => s.clearBlacklist)
  const messages = useChatStore((s) => s.messages)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string>()
  const [confirmClear, setConfirmClear] = useState(false)

  // How many of the messages currently in memory are being hidden (a quick way to see a term working).
  const isHidden = useMemo(() => compileBlacklist(blacklist), [blacklist])
  const hiddenCount = useMemo(() => messages.filter(isHidden).length, [messages, isHidden])

  // Un-arm "Clear all" after 3 seconds.
  useEffect(() => {
    if (!confirmClear) return
    const t = setTimeout(() => setConfirmClear(false), 3000)
    return () => clearTimeout(t)
  }, [confirmClear])

  function add() {
    const result = addTerm(draft)
    if (result === 'added') {
      setDraft('')
      setNote(undefined)
    } else {
      setNote(ADD_NOTES[result])
    }
  }

  return (
    <>
      <section className="setting">
        <h3 className="setting-title">Moderation</h3>
        <p className="setting-help">
          With moderation tools on (Settings → Accounts), click a message to see that person&rsquo;s messages from this session. Press{' '}
          <kbd>T</kbd> to time them out for the length below, <kbd>B</kbd> to ban (press it twice to confirm), <kbd>U</kbd> to unban.
        </p>
        <div className="timeout-setting">
          <label htmlFor="timeout-amount">Timeout length</label>
          <input
            id="timeout-amount"
            className="channels-input timeout-amount"
            type="number"
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value)
              commitTimeout(e.target.value, unit)
            }}
            onBlur={() => setAmountText(String(splitDuration(timeoutSeconds).amount))}
          />
          <select
            className="channels-input timeout-unit"
            aria-label="Timeout unit"
            value={unit}
            onChange={(e) => {
              const u = e.target.value as DurationUnit
              setUnit(u)
              commitTimeout(amountText, u)
            }}
          >
            {DURATION_UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          <span className="timeout-now">= {formatDuration(timeoutSeconds)} (Twitch allows 1 second to 2 weeks)</span>
        </div>
      </section>

      <section className="setting">
        <h3 className="setting-title">Mention alerts</h3>
        <p className="setting-help">
          Get alerted when someone types <code>@yourname</code> in any chat.
          {myLogin ? <> Your Twitch name (<strong>{myLogin}</strong>) is always included.</> : <> Sign in to Twitch to include your Twitch name.</>}
        </p>
        <label className="check">
          <input type="checkbox" checked={pingAlerts} onChange={(e) => setPingAlerts(e.target.checked)} /> Desktop notification when the app is in the background
        </label>
        <label className="check">
          <input type="checkbox" checked={pingSound} onChange={(e) => setPingSound(e.target.checked)} /> Play a sound
        </label>
        <label className="setting-help" htmlFor="ping-names">
          Other names that count as you (for example your YouTube @handle), separated by commas
        </label>
        <input
          id="ping-names"
          className="channels-input"
          type="text"
          value={namesText}
          placeholder="myhandle, othername"
          onChange={(e) => setNamesText(e.target.value)}
          onBlur={commitNames}
          onKeyDown={(e) => e.key === 'Enter' && commitNames()}
        />
      </section>

      <section className="setting">
        <h3 className="setting-title">Stream info</h3>
        <label className="check">
          <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} />
          Show stream title and viewer count
        </label>
        <p className="setting-help">
          Appears above the chat when you are reading just one Twitch channel or one YouTube stream. Turn it off if you would rather
          not see viewer counts; nothing is looked up while it is off. Twitch needs you to be signed in.
        </p>
      </section>

      <section className="setting">
        <h3 className="setting-title">Timestamps</h3>
        <p className="setting-help">Show the time each message was sent, in your local time zone.</p>
        <div className="segmented" role="radiogroup" aria-label="Timestamps">
          {TIMESTAMP_CHOICES.map((c) => (
            <button key={c.id} role="radio" aria-checked={mode === c.id} onClick={() => setMode(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={seconds} disabled={mode === 'off'} onChange={(e) => setSeconds(e.target.checked)} />
          Show seconds
        </label>
        {style !== 'off' && (
          <p className="setting-help">
            Preview: <span className="msg-time">{formatTime(Date.now(), style)}</span>
          </p>
        )}
      </section>

      <section className="setting">
        <h3 className="setting-title">Message blacklist</h3>
        <p className="setting-help">
          Messages containing any of these words or phrases are hidden. Not case-sensitive, and a term also matches inside
          longer words (&ldquo;cat&rdquo; matches &ldquo;category&rdquo;), so use a longer phrase if that&rsquo;s too broad.
          Events and moderator notices are never hidden.
        </p>

        <div className="term-input-row">
          <input
            className="channels-input term-input"
            value={draft}
            maxLength={MAX_TERM_LENGTH}
            placeholder="Add a word or phrase"
            spellCheck={false}
            aria-label="Add a word or phrase to hide"
            onChange={(e) => {
              setDraft(e.target.value)
              setNote(undefined)
            }}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn-accent" onClick={add}>
            Add
          </button>
        </div>
        {note && <p className="account-error">{note}</p>}

        {blacklist.length > 0 && (
          <>
            <ul className="term-list" aria-label="Blacklisted terms">
              {blacklist.map((term) => (
                <li key={term} className="term">
                  <span>{term}</span>
                  <button aria-label={`Remove ${term}`} title="Remove" onClick={() => removeTerm(term)}>
                    &times;
                  </button>
                </li>
              ))}
            </ul>
            <p className="setting-help">
              Hiding {hiddenCount} of the {messages.length} messages currently loaded.
            </p>
            <button
              className="tool term-clear"
              data-on={confirmClear}
              onClick={() => (confirmClear ? (clearTerms(), setConfirmClear(false)) : setConfirmClear(true))}
            >
              {confirmClear ? 'Click again to clear all' : 'Clear all'}
            </button>
          </>
        )}
      </section>
    </>
  )
}
