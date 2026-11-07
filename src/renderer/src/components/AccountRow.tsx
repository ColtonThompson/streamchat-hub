/**
 * renderer/src/components/AccountRow.tsx
 *
 * WHAT: The Twitch account section in the top bar. It shows whichever of these applies:
 *   - not set up       a note: add your Twitch client ID to .env
 *   - signed out       [Sign in to Twitch]
 *   - waiting          the code to type on twitch.tv/activate, and [Cancel]
 *   - signed in        "Signed in as X", [Sign out], and either "Moderation tools on" or
 *                      [Enable moderation tools] (which re-authorizes with extra permissions)
 *
 * All real work happens in the main process (main/twitch/auth.ts); this component only reads
 * `auth` from the store and calls `window.api.auth.*`.
 */
import { useChatStore } from '../store/chatStore'

export function AccountRow() {
  const auth = useChatStore((s) => s.auth)

  if (!auth.configured) {
    return (
      <p className="account-note">
        Twitch sign-in isn&rsquo;t set up yet. Add your Twitch client ID to <code>.env</code> (see the README).
      </p>
    )
  }

  if (auth.status === 'signed-in') {
    return (
      <div className="account">
        <span>
          Signed in as <strong>{auth.login}</strong>
        </span>
        <button className="tool" onClick={() => void window.api.auth.logout()}>
          Sign out
        </button>
        {auth.canModerate ? (
          <span className="account-ok">Moderation tools on</span>
        ) : (
          <button
            className="tool"
            title="Asks Twitch for permission to delete messages, time out and ban. Only useful in channels where you are a moderator."
            onClick={() => void window.api.auth.login(true)} // true = also request moderation permissions
          >
            Enable moderation tools
          </button>
        )}
        {auth.error && <span className="account-error">{auth.error}</span>}
      </div>
    )
  }

  if (auth.status === 'pending') {
    return (
      <div className="account">
        <span>
          Enter <strong className="code">{auth.userCode}</strong> on Twitch to finish signing in
        </span>
        {/* cancel() keeps an existing session; logout() would end it. */}
        <button className="tool" onClick={() => void window.api.auth.cancel()}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="account">
      <button className="tool" onClick={() => void window.api.auth.login()}>
        Sign in to Twitch
      </button>
      {auth.error && <span className="account-error">{auth.error}</span>}
    </div>
  )
}
