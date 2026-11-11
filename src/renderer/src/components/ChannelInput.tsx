/**
 * renderer/src/components/ChannelInput.tsx
 *
 * WHAT: The text box where you say what to read for ONE platform: Twitch channel names, or YouTube
 *       @handles / stream links. PlatformBar shows one box per platform that has a real adapter.
 *
 * You type freely ("mychannel, friend") into a local `draft`; the cleaned list is saved to the store
 * only when you press Enter or click away. This avoids reconnecting on every keystroke. The store
 * saves it to localStorage and, if the platform is on, applies it live (joins/leaves channels).
 * "Cleaned" uses `parseSources` (shared/channels.ts), which has the right rules for each platform.
 *
 * TWITCH CHECKLIST: the Twitch box has a dropdown that is a CHECKLIST of channels. Checked rows (at the top) are the
 * channels in the feed now; below them are the live channels you follow (needs the go-live permission, Settings ->
 * Accounts), unchecked. Click a row to add that channel, click a checked row to take it out of the feed. The list
 * stays open so several can be ticked in a row, and every click is saved at once (it joins or leaves right away if
 * Twitch is on). You can still type: typing filters the list, and Enter always means "use what I typed".
 *   - Up/Down arrows move through the rows, Enter ticks/unticks the highlighted one, Esc closes, Tab takes the top match
 *   - the button on the right ("N live") opens and closes the list
 * The row logic is in lib/suggest.ts (`buildChecklist`, `toggleChannel`).
 *
 * TO ADD A BOX FOR ANOTHER PLATFORM: add its label/placeholder to `COPY` below and render
 * `<ChannelInput platform="..." />` in PlatformBar.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { parseSources } from '../../../shared/channels'
import type { Platform } from '../../../shared/types'
import { buildChecklist, toggleChannel, tokenAt } from '../lib/suggest'
import { useChatStore } from '../store/chatStore'
import { useLiveStore } from '../store/liveStore'

/** The wording for each box. */
const COPY: Partial<Record<Platform, { label: string; placeholder: string; hint: string }>> = {
  twitch: {
    label: 'Twitch channels',
    placeholder: 'your_channel, another_channel',
    hint: 'Twitch channel names, separated by commas or spaces'
  },
  youtube: {
    label: 'YouTube streams',
    placeholder: '@yourhandle, or paste a stream link',
    hint: 'An @handle follows that channel whenever it is live; a stream link or video id reads that one stream. Handles need the @.'
  }
}

/** 1234 -> "1.2K", 15300 -> "15K". */
function viewers(n: number): string {
  if (n < 1000) return String(n)
  return n < 10_000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n / 1000)}K`
}

export function ChannelInput({ platform }: { platform: Platform }) {
  const saved = useChatStore((s) => s.channels[platform])
  const status = useChatStore((s) => s.status[platform])
  const setChannels = useChatStore((s) => s.setChannels)
  // The checklist exists for Twitch. Live channels in it need the go-live permission; without it the list still shows (and
  // lets you untick) the channels already in the box.
  const canList = platform === 'twitch'
  const canSuggest = useChatStore((s) => platform === 'twitch' && s.auth.status === 'signed-in' && !!s.auth.canReadFollows)
  const live = useLiveStore((s) => s.live)

  const [draft, setDraft] = useState(saved) // what's currently typed
  const [caret, setCaret] = useState(saved.length)
  const [open, setOpen] = useState(false) // is the list showing?
  const [active, setActive] = useState(-1) // highlighted row, once the user moves with arrows/mouse
  const [navigated, setNavigated] = useState(false)
  // True while the user is typing an entry: the half-typed name filters the list. Opening the list (click or button)
  // or ticking a row makes it false: then the list shows everything and all channels in the box count as ticked.
  const [typing, setTyping] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const pendingCaret = useRef<number | undefined>(undefined)
  const copy = COPY[platform] ?? { label: platform, placeholder: '', hint: '' }
  const id = `channels-${platform}`

  const clean = (text: string) => parseSources(platform, text).join(', ')

  // If the saved value changes from elsewhere (e.g. loaded at startup), reflect it in the box. A change
  // that is just our own cleaned-up version of what is typed leaves the text alone (keeps a trailing ", ").
  useEffect(() => setDraft((d) => (clean(d) === saved ? d : saved)), [saved]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Clean the text (drops invalid entries, tidies separators) and save it. */
  const save = (text: string) => setChannels(platform, clean(text))

  const token = tokenAt(draft, caret)
  const rows = canList && open ? buildChecklist(canSuggest ? live : [], draft, caret, typing) : []
  // While typing, the best unticked match is highlighted so Tab can take it; arrows/mouse move the highlight.
  const firstOther = rows.findIndex((r) => !r.checked)
  const current = navigated ? active : typing && token.text && firstOther >= 0 ? firstOther : -1
  const showList = canList && open

  // After picking a suggestion, put the cursor after it (the text changed, so wait for the render).
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = undefined
  }, [draft])

  // Keep the highlighted row visible when arrowing through a long list.
  useEffect(() => {
    if (current >= 0) document.getElementById(`${id}-opt-${current}`)?.scrollIntoView({ block: 'nearest' })
  }, [current, id])

  /** Tick or untick a channel. The list stays open and the change is saved at once. */
  const toggle = (login: string) => {
    const next = toggleChannel(draft, caret, login, typing)
    pendingCaret.current = next.caret
    setDraft(next.draft)
    setCaret(next.caret)
    setTyping(false)
    setNavigated(false)
    save(next.draft)
    input.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (canList && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const count = (open ? rows : buildChecklist(canSuggest ? live : [], draft, caret, typing)).length
      if (!count) return
      if (!open) {
        setOpen(true)
        setNavigated(true)
        setActive(e.key === 'ArrowDown' ? 0 : count - 1)
        return
      }
      // Down from "nothing highlighted" lands on the first row, Up on the last; both wrap around.
      const from = current < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : current
      setNavigated(true)
      setActive((from + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
      return
    }
    if (showList && e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    // Tab takes the highlighted match (only while the list is showing and something is typed or chosen).
    if (showList && e.key === 'Tab' && !e.shiftKey && rows.length && (token.text || navigated) && current >= 0 && rows[current]) {
      e.preventDefault()
      toggle(rows[current].login)
      return
    }
    if (e.key === 'Enter') {
      // Enter ticks only a row the user moved to; otherwise it means "use what I typed".
      if (showList && navigated && current >= 0 && rows[current]) {
        e.preventDefault()
        toggle(rows[current].login)
      } else {
        e.currentTarget.blur() // blur() triggers the save
      }
    }
  }

  return (
    <div className="channels" title={copy.hint}>
      <label className="channels-label" htmlFor={id}>
        {copy.label}
      </label>
      <div className="channels-field" data-list={canList}>
        <input
          id={id}
          ref={input}
          className="channels-input"
          value={draft}
          placeholder={copy.placeholder}
          spellCheck={false}
          autoComplete="off"
          {...(canList && {
            role: 'combobox',
            'aria-expanded': showList,
            'aria-controls': `${id}-list`,
            'aria-autocomplete': 'list' as const,
            'aria-activedescendant': showList && current >= 0 ? `${id}-opt-${current}` : undefined
          })}
          onChange={(e) => {
            setDraft(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setNavigated(false)
            setTyping(true)
            setOpen(true)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={() => {
            setOpen(true)
            setTyping(false)
          }}
          onBlur={() => {
            setOpen(false)
            setNavigated(false)
            setTyping(false)
            setDraft(clean(draft)) // show the tidied version
            save(draft)
          }}
          onKeyDown={onKeyDown}
        />
        {canList && (
          <button
            type="button"
            className="channels-toggle"
            tabIndex={-1}
            aria-label={canSuggest ? `Choose channels (${live.length} followed channels live)` : 'Choose channels'}
            onMouseDown={(e) => e.preventDefault()} // keep the input focused
            onClick={() => {
              // Closes the list if it is showing; otherwise opens it with everything.
              setOpen(!showList)
              setTyping(false)
              setNavigated(false)
              input.current?.focus()
            }}
          >
            {canSuggest && live.length > 0 && <span className="channels-live-dot" aria-hidden="true" />}
            {canSuggest && live.length > 0 ? `${live.length} live` : ''} &#9662;
          </button>
        )}
        {showList && (
          <ul ref={list} id={`${id}-list`} className="suggest" role="listbox" aria-multiselectable="true" aria-label="Channels in your feed">
            {rows.length === 0 && (
              <li className="suggest-empty">
                {canSuggest ? 'No channels yet, and none of the channels you follow are live right now. Type a name above.' : 'No channels yet. Type a name above.'}
              </li>
            )}
            {rows.map((r, i) => (
              <li
                key={r.login}
                id={`${id}-opt-${i}`}
                className="suggest-item"
                role="option"
                aria-selected={r.checked}
                data-active={i === current}
                data-checked={r.checked}
                onMouseDown={(e) => {
                  e.preventDefault() // don't blur the input before the click lands
                  toggle(r.login)
                }}
                onMouseMove={() => {
                  if (!navigated || active !== i) {
                    setNavigated(true)
                    setActive(i)
                  }
                }}
              >
                <span className="suggest-check" aria-hidden="true">
                  {r.checked ? '✓' : ''}
                </span>
                <span className="suggest-name">{r.name}</span>
                <span className="suggest-game">{r.live ? r.game || 'No category' : 'Not live'}</span>
                {r.live && <span className="suggest-viewers">{viewers(r.viewers)}</span>}
              </li>
            ))}
            {!canSuggest && (
              <li className="suggest-empty" role="presentation">
                To also pick from the channels you follow, allow go-live alerts in Settings &rarr; Accounts.
              </li>
            )}
          </ul>
        )}
      </div>
      {status.state === 'error' && <span className="channels-error">{status.detail}</span>}
    </div>
  )
}
