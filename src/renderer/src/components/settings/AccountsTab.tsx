/**
 * renderer/src/components/settings/AccountsTab.tsx
 *
 * WHAT: One card per platform showing its sign-in state. Only Twitch has a real sign-in so far; the
 *       others explain that they are not connected yet.
 *
 * TO ADD A PLATFORM'S LOGIN: create a component like TwitchAccount.tsx for it and add a line in the
 * `AccountCard` switch below. The card frame (coloured edge, name) comes for free.
 *
 * (Which CHANNELS to read is not here: that box stays on the main screen because you change it often.)
 */
import { PLATFORMS, type Platform } from '../../../../shared/types'
import { PLATFORM_META } from '../../lib/platforms'
import { TwitchAccount } from './TwitchAccount'

function AccountCard({ platform }: { platform: Platform }) {
  const meta = PLATFORM_META[platform]

  // Choose the platform-specific content.
  let content
  switch (platform) {
    case 'twitch':
      content = <TwitchAccount />
      break
    default:
      content = (
        <p className="setting-help">
          {meta.label} isn&rsquo;t connected yet. Switching it on shows sample chat so you can try out the app.
        </p>
      )
  }

  return (
    // `--accent` is the platform colour; the card's left edge and dot use it (see .account-card in styles.css).
    <section className="account-card" style={{ ['--accent' as string]: meta.color }}>
      <h3 className="account-card-title">
        <span className="account-dot" aria-hidden="true" />
        {meta.label}
      </h3>
      {content}
    </section>
  )
}

export function AccountsTab() {
  return (
    <>
      <p className="setting-help">
        Reading chat never needs an account. Signing in unlocks sending messages, badge images, and (where you are a
        moderator) moderation tools.
      </p>
      {PLATFORMS.map((p) => (
        <AccountCard key={p} platform={p} />
      ))}
    </>
  )
}
