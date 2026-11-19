/**
 * renderer/src/components/ChannelsMenu.tsx   (the "Channels" button and its list)
 *
 * WHAT: One button in the top bar, "Channels" with a count, that opens a list of every channel in your feed. Each row
 * shows its connection status, and has two buttons: a star to choose whose title and viewer count the bar above the chat
 * shows (see lib/streaminfo.ts), and a bin to leave the channel (a "Left ..." divider is added to the chat). Esc or a
 * click outside closes the list. Adding is done with the separate "Add channel" button.
 */
import { useEffect, useRef, useState } from 'react'
import { sourceLabel } from '../lib/channelbreaks'
import { PLATFORM_META } from '../lib/platforms'
import { allChannels, channelKey, primaryChannel } from '../lib/streaminfo'
import { useAddChannelStore } from '../store/addChannelStore'
import { useChatStore } from '../store/chatStore'

export function ChannelsMenu() {
  const channels = useChatStore((s) => s.channels)
  const status = useChatStore((s) => s.status)
  const titleSource = useChatStore((s) => s.titleSource)
  const setTitleSource = useChatStore((s) => s.setTitleSource)
  const removeChannel = useChatStore((s) => s.removeChannel)
  const showAdd = useAddChannelStore((s) => s.show)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const list = allChannels(channels)
  const primary = primaryChannel(channels, titleSource)

  // Close on Esc or a click outside.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // Nothing left to list: close.
  useEffect(() => {
    if (open && list.length === 0) setOpen(false)
  }, [open, list.length])

  return (
    <div className="channels-menu" ref={root}>
      <button className="tool" type="button" aria-haspopup="true" aria-expanded={open} disabled={list.length === 0} onClick={() => setOpen((o) => !o)} title={list.length ? 'The channels in your feed' : 'No channels yet'}>
        Channels
        <span className="channels-count">{list.length}</span>
        <span aria-hidden="true">&#9662;</span>
      </button>
      {open && (
        <div className="channels-pop" role="dialog" aria-label="Channels in your feed">
          <ul className="channels-rows">
            {list.map((c) => {
              const st = status[c.platform]
              const label = sourceLabel(c.platform, c.source)
              const isTitle = !!primary && channelKey(primary) === channelKey(c)
              return (
                <li key={channelKey(c)} className="channels-row" style={{ ['--accent' as string]: PLATFORM_META[c.platform].color }}>
                  <span className="channels-dot" data-state={st.state} title={`${PLATFORM_META[c.platform].label}: ${st.detail ?? st.state}`} />
                  <span className="channels-name" title={label}>
                    {label}
                  </span>
                  <button
                    type="button"
                    className="channels-act"
                    data-on={isTitle}
                    aria-pressed={isTitle}
                    aria-label={isTitle ? `${label}: its title is shown above the chat` : `Show the title of ${label} above the chat`}
                    title={isTitle ? 'Its title is shown above the chat' : 'Show this stream’s title above the chat'}
                    onClick={() => setTitleSource(channelKey(c))}
                  >
                    {isTitle ? '★' : '☆'}
                  </button>
                  <button type="button" className="channels-act" data-danger="true" aria-label={`Leave ${label}`} title={`Leave ${label}`} onClick={() => removeChannel(c.platform, c.source)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            className="channels-add"
            onClick={() => {
              setOpen(false)
              showAdd()
            }}
          >
            + Add channel
          </button>
        </div>
      )}
    </div>
  )
}
