/**
 * renderer/src/lib/chatters.ts   (who has chatted, and what role they have)
 *
 * WHAT: Pure helpers (no React, no store) behind the chatters list on the right of the chat (ChattersPanel.tsx).
 *   - `roleOf` reads a chat line's badges and says whether the sender is the broadcaster, a moderator, a VIP or a normal
 *     viewer. Twitch sends badges like "broadcaster/1", "moderator/1", "vip/1"; YouTube's are "owner" and "moderator".
 *   - `chatterUpdate` keeps one entry per person (the chat store calls it for every chat line), remembering their role
 *     in each channel. A person's roles are only known from their messages, so someone is listed once they have chatted.
 *   - `groupChatters` turns the entries into the sections shown: platform -> role -> names, A to Z.
 *
 * ROLES are per channel (a moderator in one channel can be a viewer in another), so each entry keeps one role per
 * channel and is listed under the highest one; hovering the name shows the detail.
 *
 * Staff and admins are not given a section of their own: they show as viewers unless they also hold one of the roles below.
 */
import { channelTag } from '../../../shared/channels'
import { PLATFORMS, type ChatMessage, type Platform } from '../../../shared/types'

export type Role = 'broadcaster' | 'moderator' | 'vip' | 'viewer'

/** Highest first: the order of the sections. */
export const ROLES: Role[] = ['broadcaster', 'moderator', 'vip', 'viewer']

export const ROLE_LABEL: Record<Role, string> = { broadcaster: 'Broadcaster', moderator: 'Moderator', vip: 'VIP', viewer: 'Viewer' }

/** One person. `roles` maps a channel (as `channelTag` writes it) to their latest role there. */
export interface Chatter {
  platform: Platform
  name: string
  /** The platform's user id (Twitch numeric id), when the message had one. Needed to open their moderation panel. */
  id?: string
  roles: Record<string, Role>
  /** The channel their latest message was in (`ChatMessage.channelId`): where clicking their name opens the panel. */
  last: string
}

/** The most chatters remembered; the ones seen first are forgotten first. Keeps memory bounded in a marathon stream. */
export const MAX_CHATTERS = 10_000

/** The role a chat line's sender has in the channel it was sent in. */
export function roleOf(msg: Pick<ChatMessage, 'platform' | 'channelId' | 'author'>): Role {
  const ids = msg.author.badges.map((b) => b.id.split('/')[0])
  if (ids.includes('broadcaster') || ids.includes('owner')) return 'broadcaster'
  // On Twitch the channel's name is the broadcaster's name, even if the badge were missing.
  if (msg.platform === 'twitch' && msg.author.name.toLowerCase() === msg.channelId) return 'broadcaster'
  if (ids.includes('moderator') || ids.includes('lead_moderator')) return 'moderator'
  if (ids.includes('vip')) return 'vip'
  return 'viewer'
}

/** The key one person is stored under: platform plus their id (names can repeat on YouTube; Twitch has ids too). */
export const chatterKey = (msg: Pick<ChatMessage, 'platform' | 'author'>): string => `${msg.platform}|${msg.author.id ?? msg.author.name.toLowerCase()}`

/**
 * The entry for this line's sender after it, or `undefined` when nothing changed (same name, same role in that channel,
 * same channel as their previous message).
 * Event rows and lines with no sender name are not chatters.
 */
export function chatterUpdate(existing: Chatter | undefined, msg: ChatMessage): Chatter | undefined {
  if (msg.event || !msg.author.name) return undefined
  const channel = channelTag(msg)
  const role = roleOf(msg)
  if (existing && existing.name === msg.author.name && existing.roles[channel] === role && existing.last === msg.channelId) return undefined
  return { platform: msg.platform, name: msg.author.name, id: msg.author.id, roles: { ...existing?.roles, [channel]: role }, last: msg.channelId }
}

/** The highest role across a person's channels. */
export function topRole(c: Chatter): Role {
  const have = Object.values(c.roles)
  return ROLES.find((r) => have.includes(r)) ?? 'viewer'
}

/** "Moderator in #a, Viewer in #b" (or just the role when there is a single channel). */
export function roleDetail(c: Chatter): string {
  const entries = Object.entries(c.roles)
  if (entries.length === 1) return ROLE_LABEL[entries[0][1]]
  return entries.map(([channel, role]) => `${ROLE_LABEL[role]} in ${channel}`).join(', ')
}

export interface RoleGroup {
  role: Role
  chatters: Chatter[]
}
export interface PlatformGroup {
  platform: Platform
  total: number
  roles: RoleGroup[]
}

/** Platform -> role -> names A to Z (ignoring case). Platforms with nobody, and empty roles, are left out. `show` filters platforms. */
export function groupChatters(chatters: Iterable<Chatter>, show: (platform: Platform) => boolean = () => true): PlatformGroup[] {
  const buckets = new Map<Platform, Map<Role, Chatter[]>>()
  for (const c of chatters) {
    if (!show(c.platform)) continue
    const byRole = buckets.get(c.platform) ?? new Map<Role, Chatter[]>()
    const role = topRole(c)
    byRole.set(role, [...(byRole.get(role) ?? []), c])
    buckets.set(c.platform, byRole)
  }
  const byName = (a: Chatter, b: Chatter) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name)
  return PLATFORMS.filter((p) => buckets.has(p)).map((platform) => {
    const byRole = buckets.get(platform)!
    const roles = ROLES.filter((r) => byRole.has(r)).map((role) => ({ role, chatters: byRole.get(role)!.sort(byName) }))
    return { platform, total: roles.reduce((n, r) => n + r.chatters.length, 0), roles }
  })
}
