/**
 * renderer/src/lib/permissions.ts   (what each Twitch permission is for, and what is missing)
 *
 * WHAT: Twitch only lets the app do what you approved when signing in, and the extras are optional groups. This
 *   file is the one place that says which feature needs which group, so that
 *     - Settings -> Accounts can list every permission with a tick/cross and what it enables, and
 *     - the banner above the chat (PermissionBanner.tsx) can say "you are reading your own channel but polls and
 *       redemptions can't show yet" at the moment it matters, instead of the feature silently doing nothing.
 *
 * It is pure (no React), so it is easy to test. The groups themselves are defined in main/twitch/auth.ts;
 * `auth` here is the AuthState the main process pushes (its `can...` flags).
 *
 * TO ADD A PERMISSION GROUP: add its flag to AuthState and LoginOptions (shared/types.ts), then an entry below.
 */
import type { AuthState, LoginOptions, Platform } from '../../../shared/types'


export interface PermissionInfo {
  id: PermissionId
  label: string
  /** What turning it on gives you, in plain words. */
  enables: string
  granted: (auth: AuthState) => boolean
}

export const PERMISSIONS: PermissionInfo[] = [
  {
    id: 'moderation',
    label: 'Moderation tools',
    enables: 'Delete messages, time out and ban from the chat, and see the message pinned in channels you moderate.',
    granted: (a) => !!a.canModerate
  },
  {
    id: 'polls',
    label: 'Polls & predictions',
    enables: 'Live poll and prediction cards above the chat. Your own channel only.',
    granted: (a) => !!a.canReadPolls
  },
  {
    id: 'redemptions',
    label: 'Reward redemptions',
    enables: 'Channel Points rewards that viewers redeem show up as events in the chat. Your own channel only.',
    granted: (a) => !!a.canReadRedemptions
  },
  {
    id: 'follows',
    label: 'Go-live alerts',
    enables: 'Desktop notifications when a channel you follow goes live, and picking live channels in the Twitch box.',
    granted: (a) => !!a.canReadFollows
  }
]

/** Every permission with whether it is granted. */
export function permissionStatus(auth: AuthState): { info: PermissionInfo; granted: boolean }[] {
  return PERMISSIONS.map((info) => ({ info, granted: info.granted(auth) }))
}

/** The permissions not granted yet. Empty when signed out: you must sign in before any of them can be asked for. */
export function missingPermissions(auth: AuthState): PermissionInfo[] {
  return auth.status === 'signed-in' ? PERMISSIONS.filter((p) => !p.granted(auth)) : []
}

/** Login options that ask for exactly these groups (groups already granted are always kept by the sign-in). */
export function loginOptionsFor(ids: PermissionId[]): LoginOptions {
  return Object.fromEntries(ids.map((id) => [id, true])) as LoginOptions
}

export interface PermissionNotice {
  /** Stable id of this situation, used to remember that the user said "not now". It changes when the situation does. */
  key: string
  text: string
  ids: PermissionId[]
}

const join = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0])

/**
 * A notice for something the user is trying to do right now that their permissions cannot do yet. Today that is
 * reading their OWN channel (the only place polls, predictions and redemptions exist) without those permissions.
 * `twitchChannels` is the text of the Twitch box.
 */
export function permissionNotice(auth: AuthState, enabled: Record<Platform, boolean>, twitchChannels: string): PermissionNotice | null {
  if (auth.status !== 'signed-in' || !auth.login || !enabled.twitch) return null
  const reading = twitchChannels.toLowerCase().split(/[\s,]+/).map((t) => t.replace(/^#/, '')).includes(auth.login.toLowerCase())
  if (!reading) return null

  const ids: PermissionId[] = []
  const what: string[] = []
  if (!auth.canReadPolls) {
    ids.push('polls')
    what.push('polls and predictions')
  }
  if (!auth.canReadRedemptions) {
    ids.push('redemptions')
    what.push('reward redemptions')
  }
  if (!ids.length) return null
  return {
    key: `own-channel:${ids.join('+')}`,
    text: `You are reading your own channel, but its ${join(what)} can't show yet. They need an extra permission from Twitch.`,
    ids
  }
}
