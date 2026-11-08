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
 * TWITCH SUGGESTIONS: when the go-live permission is on (Settings -> Accounts), the Twitch box is a
 * "combobox": it offers the followed channels that are live right now (with game and viewers).
 *   - typing filters the list (names starting with what you typed first); Tab takes the top match
 *   - Up/Down arrows move through the list, Enter picks the highlighted one, Esc closes it
 *   - clicking a row picks it; the "live" button on the right opens the whole list
 * Picking a channel saves it straight away (it joins at once if Twitch is on). Plain Enter never picks
 * a suggestion unless you moved to it with the arrows, so typing a full name and pressing Enter always
 * means what you typed. The matching rules are in lib/suggest.ts.
 *
 * TO ADD A BOX FOR ANOTHER PLATFORM: add its label/placeholder to `COPY` below and render
 * `<ChannelInput platform="..." />` in PlatformBar.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { parseSources } from '../../../shared/channels'
import type { LiveChannel, Platform } from '../../../shared/types'
import { applySuggestion, suggest, tokenAt } from '../lib/suggest'
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
  const canSuggest = useChatStore((s) => platform === 'twitch' && s.auth.status === 'signed-in' && !!s.auth.canReadFollows)
  const live = useLiveStore((s) => s.live)

  const [draft, setDraft] = useState(saved) // what's currently typed
  const [caret, setCaret] = useState(saved.length)
  const [open, setOpen] = useState(false) // is the list showing?
  const [active, setActive] = useState(-1) // highlighted row, once the user moves with arrows/mouse
  const [navigated, setNavigated] = useState(false)
  // Opened with the "N live" button: show EVERY live channel not already added, ignoring the typed text.
  // Typing (or leaving the box) goes back to filtering by what is typed.
  const [browse, setBrowse] = useState(false)
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

  // What the suggestions are computed from. Browsing looks at an empty entry after everything typed so far,
  // so every channel already listed is left out and a pick is appended at the end instead of replacing text.
  const base = draft.replace(/[\s,]+$/, '')
  const view = browse ? { text: base ? `${base}, ` : '', caret: base ? base.length + 2 : 0 } : { text: draft, caret }
  const token = tokenAt(view.text, view.caret)
  const items: LiveChannel[] = canSuggest && open ? suggest(live, view.text, view.caret) : []
  // With text typed, the best match is highlighted so Tab can take it; arrows/mouse move the highlight.
  const current = navigated ? active : token.text && items.length ? 0 : -1
  const showList = canSuggest && open && (items.length > 0 || !token.text) // an empty entry shows a note when nothing is left to offer

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

  const pick = (c: LiveChannel) => {
    const next = applySuggestion(view.text, view.caret, c.login)
    pendingCaret.current = next.caret
    setDraft(next.draft)
    setCaret(next.caret)
    setOpen(false)
    setNavigated(false)
    setBrowse(false)
    save(next.draft)
    input.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (canSuggest && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const count = suggest(live, view.text, view.caret).length
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
    // Tab takes the top suggestion (only while the list is showing and something is typed or chosen).
    if (showList && e.key === 'Tab' && !e.shiftKey && items.length && (token.text || navigated)) {
      e.preventDefault()
      pick(items[Math.max(current, 0)])
      return
    }
    if (e.key === 'Enter') {
      // Enter picks only a row the user moved to; otherwise it means "use what I typed".
      if (showList && navigated && current >= 0 && items[current]) {
        e.preventDefault()
        pick(items[current])
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
      <div className="channels-field" data-list={canSuggest}>
        <input
          id={id}
          ref={input}
          className="channels-input"
          value={draft}
          placeholder={copy.placeholder}
          spellCheck={false}
          autoComplete="off"
          {...(canSuggest && {
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
            setBrowse(false)
            setOpen(true)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setNavigated(false)
            setBrowse(false)
            setDraft(clean(draft)) // show the tidied version
            save(draft)
          }}
          onKeyDown={onKeyDown}
        />
        {canSuggest && (
          <button
            type="button"
            className="channels-toggle"
            tabIndex={-1}
            aria-label={`Show live channels you follow (${live.length} live)`}
            onMouseDown={(e) => e.preventDefault()} // keep the input focused
            onClick={() => {
              // Closes the list if it is showing; otherwise opens it with everything that is live.
              const opening = !showList
              setOpen(opening)
              setBrowse(opening)
              setNavigated(false)
              input.current?.focus()
            }}
          >
            {live.length > 0 && <span className="channels-live-dot" aria-hidden="true" />}
            {live.length > 0 ? `${live.length} live` : ''} &#9662;
          </button>
        )}
        {showList && (
          <ul ref={list} id={`${id}-list`} className="suggest" role="listbox" aria-label="Live channels you follow">
            {items.length === 0 && (
              <li className="suggest-empty">
                {live.length === 0 ? 'None of the channels you follow are live right now.' : 'Every live channel you follow is already in the box.'}
              </li>
            )}
            {items.map((c, i) => (
              <li
                key={c.login}
                id={`${id}-opt-${i}`}
                className="suggest-item"
                role="option"
                aria-selected={i === current}
                title={c.title}
                onMouseDown={(e) => {
                  e.preventDefault() // don't blur the input before the click lands
                  pick(c)
                }}
                onMouseMove={() => {
                  if (!navigated || active !== i) {
                    setNavigated(true)
                    setActive(i)
                  }
                }}
              >
                <span className="suggest-name">{c.name}</span>
                <span className="suggest-game">{c.game || 'No category'}</span>
                <span className="suggest-viewers">{viewers(c.viewers)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {status.state === 'error' && <span className="channels-error">{status.detail}</span>}
    </div>
  )
}
