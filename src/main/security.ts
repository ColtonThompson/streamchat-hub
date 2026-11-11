/**
 * main/security.ts   (the small rules that keep the app window locked down; pure, no Electron imports)
 *
 * Each follows Electron's security checklist (electronjs.org/docs/latest/tutorial/security):
 *   - `safeExternalUrl`   item 15: only hand http(s) links to the OS browser. Anything else (file:, javascript:,
 *                         custom protocol handlers like ms-msdt:) can run programs, so it is refused.
 *   - `isAppUrl`          item 13: the window may only ever show the app's own page; every other navigation is blocked.
 *   - `isTrustedSender`   item 17: IPC requests are accepted only from the app's own page, not from any other frame.
 *   - `isTwitchLoginUrl`  the sign-in page the app opens must really be on twitch.tv over https.
 */

/** The URL if it is a plain http(s) link, else undefined. */
export function safeExternalUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 4096) return undefined
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Is `url` the app's own page? In a packaged build that is the bundled `index.html` (file: URL); in development it
 * is the dev server (`devUrl`, from ELECTRON_RENDERER_URL), compared by origin.
 */
export function isAppUrl(url: string, devUrl?: string): boolean {
  try {
    const u = new URL(url)
    if (devUrl) return u.origin === new URL(devUrl).origin
    return u.protocol === 'file:' && /\/renderer\/index\.html$/.test(u.pathname)
  } catch {
    return false
  }
}

/** For an IPC event's `senderFrame`: true only when it is the app's top-level page. */
export function isTrustedSender(frame: { url: string; parent?: unknown } | null | undefined, devUrl?: string): boolean {
  return !!frame && !frame.parent && isAppUrl(frame.url, devUrl)
}

/** Twitch's device sign-in page: https on twitch.tv (or a subdomain). */
export function isTwitchLoginUrl(raw: unknown): boolean {
  const safe = safeExternalUrl(raw)
  if (!safe) return false
  const u = new URL(safe)
  return u.protocol === 'https:' && (u.hostname === 'twitch.tv' || u.hostname.endsWith('.twitch.tv'))
}
