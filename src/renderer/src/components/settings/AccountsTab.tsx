/**
 * renderer/src/components/settings/AccountsTab.tsx
 *
 * WHAT: A row of sub-tabs, one per platform, and under it that platform's page: its sign-in state and (as they are
 *       added) its own settings. Only Twitch has a real sign-in so far; the others explain that they are not
 *       connected yet. The selected platform is kept in the settings store (`accountsPlatform`) so other parts of
 *       the app can open Settings straight to one platform.
 *
 * TO ADD A PLATFORM'S LOGIN: create a component like TwitchAccount.tsx for it and add a line in the
 * `AccountCard` switch below. The frame (coloured edge, name) comes for free.
 *
 * (Which CHANNELS to read is not here: that box stays on the main screen because you change it often.)
 */
import type { KeyboardEvent } from 'react'
import { PLATFORMS, type Platform } from '../../../../shared/types'
import { PLATFORM_META } from '../../lib/platforms'
import { useSettingsStore } from '../../store/settingsStore'
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
  const selected = useSettingsStore((s) => s.accountsPlatform)
  const select = useSettingsStore((s) => s.setAccountsPlatform)

  // Left/right arrows move between the platform tabs (wrapping), like the main settings tabs.
  function onKeyDown(e: KeyboardEvent) {
    const i = PLATFORMS.indexOf(selected)
    const next = e.key === 'ArrowRight' ? PLATFORMS[(i + 1) % PLATFORMS.length] : e.key === 'ArrowLeft' ? PLATFORMS[(i - 1 + PLATFORMS.length) % PLATFORMS.length] : undefined
    if (!next) return
    e.preventDefault()
    select(next)
    document.getElementById(`accounts-tab-${next}`)?.focus()
  }

  return (
    <>
      <p className="setting-help">
        Reading chat never needs an account. Signing in unlocks sending messages, badge images, and (where you are a
        moderator) moderation tools.
      </p>
      <div className="subtabs" role="tablist" aria-label="Platforms" onKeyDown={onKeyDown}>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            id={`accounts-tab-${p}`}
            className="subtab"
            role="tab"
            aria-selected={selected === p}
            aria-controls="accounts-tabpanel"
            tabIndex={selected === p ? 0 : -1}
            style={{ ['--accent' as string]: PLATFORM_META[p].color }}
            onClick={() => select(p)}
          >
            <span className="account-dot" aria-hidden="true" />
            {PLATFORM_META[p].label}
          </button>
        ))}
      </div>
      <div id="accounts-tabpanel" role="tabpanel" aria-labelledby={`accounts-tab-${selected}`}>
        <AccountCard platform={selected} />
      </div>
    </>
  )
}
