/**
 * renderer/src/components/ChattersPanel.tsx   (the list of who has chatted, beside the chat)
 *
 * WHAT: A small vertical-ellipsis button at the top right of the chat opens a panel on the right with everyone who has
 * chatted this session, in sections: platform, then role (Broadcaster, Moderator, VIP, Viewer), names A to Z. The same
 * button closes it. Roles come from the badges on each person's messages (lib/chatters.ts), so someone is listed, with
 * their role, once they have sent a message. With moderation tools on (Twitch), clicking a name opens their message history
 * panel (UserPanel.tsx) for the channel they last chatted in, just like clicking one of their messages. A line separates the platforms, and each platform's heading is a button that
 * collapses or expands its section (the count stays visible). Platforms with no channels are left out. "Clear" empties
 * the list too. Whether the panel is open, and which platforms are collapsed, is remembered between launches.
 */
import { useMemo } from 'react'
import { PLATFORM_META } from '../lib/platforms'
import { groupChatters, ROLE_LABEL, roleDetail } from '../lib/chatters'
import { modTargetForChatter } from '../lib/modpanel'
import { useModStore } from '../store/modStore'
import { useChatStore } from '../store/chatStore'
import { IconButton } from './IconButton'

const DOTS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
)

export function ChattersPanel() {
  const open = useChatStore((s) => s.chattersOpen)
  const toggle = useChatStore((s) => s.toggleChatters)
  const chatters = useChatStore((s) => s.chatters)
  const enabled = useChatStore((s) => s.enabled)
  const collapsed = useChatStore((s) => s.chattersCollapsed)
  const toggleSection = useChatStore((s) => s.toggleChattersPlatform)
  const canModerate = useChatStore((s) => s.auth.canModerate)
  const myId = useChatStore((s) => s.auth.userId)

  // Only worked out while the panel is open.
  const groups = useMemo(() => (open ? groupChatters(chatters.values(), (p) => enabled[p]) : []), [open, chatters, enabled])

  if (!open) {
    return (
      <div className="chatters-toggle">
        <IconButton label="Show who has chatted" align="end" pressed={false} onClick={toggle}>
          {DOTS}
        </IconButton>
      </div>
    )
  }

  const total = groups.reduce((n, g) => n + g.total, 0)
  return (
    <aside className="chatters" aria-label="Chatters">
      <header className="chatters-head">
        <h2 className="chatters-title">
          Chatters <span className="chatters-total">{total}</span>
        </h2>
        <IconButton label="Hide the chatters list" align="end" pressed onClick={toggle}>
          {DOTS}
        </IconButton>
      </header>
      <div className="chatters-body">
        {groups.length === 0 && <p className="chatters-empty">No one has chatted yet. People appear here, with their role, once they send a message.</p>}
        {groups.map((g) => {
          const isCollapsed = collapsed.includes(g.platform)
          const label = PLATFORM_META[g.platform].label
          return (
          <section key={g.platform} className="chatters-platform" data-collapsed={isCollapsed} style={{ ['--accent' as string]: PLATFORM_META[g.platform].color }}>
            <h3 className="chatters-platform-name">
              <button type="button" className="chatters-fold" aria-expanded={!isCollapsed} aria-label={`${label} chatters, ${g.total}`} title={isCollapsed ? `Show ${label} chatters` : `Hide ${label} chatters`} onClick={() => toggleSection(g.platform)}>
                <svg className="chatters-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
                {label} <span>{g.total}</span>
              </button>
            </h3>
            {!isCollapsed && g.roles.map((r) => (
              <div key={r.role} className="chatters-role" data-role={r.role}>
                <h4 className="chatters-role-name">
                  {ROLE_LABEL[r.role]} <span>{r.chatters.length}</span>
                </h4>
                <ul className="chatters-list">
                  {r.chatters.map((c) => {
                    const target = modTargetForChatter(c, { canModerate, userId: myId })
                    return (
                      <li key={`${c.platform}|${c.id ?? c.name}`} className="chatters-name">
                        {target ? (
                          <button type="button" className="chatters-user" title={`${roleDetail(c)}. Click for their messages in #${target.channelId}.`} onClick={() => useModStore.getState().open(target)}>
                            {c.name}
                          </button>
                        ) : (
                          <span title={roleDetail(c)}>{c.name}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
          )
        })}
      </div>
    </aside>
  )
}
