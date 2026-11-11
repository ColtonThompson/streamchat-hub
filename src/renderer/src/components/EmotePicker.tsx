/**
 * renderer/src/components/EmotePicker.tsx   (the emote button's popup above the message box)
 *
 * WHAT: Opens from the smiley button next to the message box and lists the emotes for the channel you are sending to,
 * in sections (the channel's, Twitch's, other channels you can use, then 7TV / BTTV / FFZ). Type to search; click an
 * emote to put its name in your message at the cursor. The popup stays open so you can add several; Esc, a click
 * outside, or the button closes it.
 *
 * WHICH EMOTES: with the optional "Your emotes" permission (Settings -> Accounts) the list is exactly what you can use
 * there. Without it the channel's emotes are all listed (some need a subscription) and a hint offers to turn it on.
 * The sections come from the main process (MessageBus.listEmotes, built in main/emotes/picker.ts).
 *
 * Big sets (thousands of 7TV emotes) show their first 240 and a "Show more" button; searching looks through everything.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EmoteGroup } from '../../../shared/types'
import { filterGroups } from '../lib/emotepicker'
import { loginOptionsFor } from '../lib/permissions'
import { useChatStore } from '../store/chatStore'

const FIRST_SHOWN = 240

interface Props {
  channel: string
  onPick: (name: string) => void
  onClose: () => void
}

export function EmotePicker({ channel, onPick, onClose }: Props) {
  const canReadEmotes = useChatStore((s) => !!s.auth.canReadEmotes)
  const [groups, setGroups] = useState<EmoteGroup[]>()
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  // (Re)load whenever the channel or the permission changes.
  useEffect(() => {
    let live = true
    setGroups(undefined)
    setFailed(false)
    window.api.emotes
      .list('twitch', channel)
      .then((g) => live && setGroups(g))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [channel, canReadEmotes])

  useEffect(() => search.current?.focus(), [])

  // Close on Esc or a click outside (the toggle button handles its own click, so ignore it here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (root.current && t && !root.current.contains(t) && !t.closest('[data-emote-toggle]')) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const shown = useMemo(() => (groups ? filterGroups(groups, query) : []), [groups, query])
  const searching = query.trim() !== ''

  return (
    <div ref={root} className="ep" role="dialog" aria-label="Emotes">
      <input
        ref={search}
        className="channels-input ep-search"
        type="search"
        value={query}
        placeholder="Search emotes"
        aria-label="Search emotes"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ep-body">
        {failed && <p className="ep-empty">Couldn&rsquo;t load emotes. Check your connection and reopen this.</p>}
        {!failed && !groups && <p className="ep-empty">Loading emotes…</p>}
        {groups && shown.length === 0 && <p className="ep-empty">{searching ? `No emotes match “${query.trim()}”.` : 'No emotes found for this channel yet.'}</p>}
        {shown.map((g) => {
          const all = searching || expanded.has(g.id) || g.emotes.length <= FIRST_SHOWN
          const list = all ? g.emotes : g.emotes.slice(0, FIRST_SHOWN)
          return (
            <section key={g.id} className="ep-group">
              <h4 className="ep-title">
                {g.title} <span className="ep-count">{g.emotes.length}</span>
              </h4>
              {g.note && <p className="ep-note">{g.note}</p>}
              <div className="ep-grid">
                {list.map((e) => (
                  <button key={e.name} className="ep-emote" title={e.name} aria-label={e.name} onClick={() => onPick(e.name)}>
                    <img src={e.url} alt="" loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
              {!all && (
                <button className="tool ep-more" onClick={() => setExpanded((s) => new Set(s).add(g.id))}>
                  Show {g.emotes.length - FIRST_SHOWN} more
                </button>
              )}
            </section>
          )
        })}
      </div>
      {!canReadEmotes && (
        <p className="ep-hint">
          Showing everything in this channel. <button className="ep-link" onClick={() => void window.api.auth.login(loginOptionsFor(['emotes']))}>Turn on “Your emotes”</button> to see only the ones you can use.
        </p>
      )}
    </div>
  )
}
