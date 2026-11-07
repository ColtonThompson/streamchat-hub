/**
 * renderer/src/components/settings/SettingsPanel.tsx   (the settings screen)
 *
 * WHAT: A full-window panel that slides over the chat, with four tabs:
 *   Appearance (theme)  |  Chat (timestamps, blacklist)  |  Accounts (platform sign-ins)  |  About (version, updates)
 * Each tab's content is its own component in this folder; this file is only the frame.
 *
 * OPENING/CLOSING: the "Settings" button in the top bar calls `openPanel()`. It closes with the Close
 * button or the Escape key. The state (`panelOpen`, `tab`) lives in settingsStore.ts.
 *
 * KEYBOARD AND SCREEN-READER SUPPORT (worth keeping when you edit):
 *   - `role="dialog"` + `aria-modal` tell assistive tech this panel is in front of the page.
 *   - Tabs follow the standard pattern: the left/right arrow keys move between tabs, and only the
 *     selected tab is in the Tab-key order ("roving tabindex").
 *   - Focus moves into the panel when it opens and returns to the button you used when it closes.
 *
 * TO ADD A TAB: add it to `SettingsTab` (store/settingsStore.ts) and to `TABS` below, create its
 * component, and add a line in the switch at the bottom of this component.
 */
import { useEffect, useRef } from 'react'
import { useSettingsStore, type SettingsTab } from '../../store/settingsStore'
import { AboutTab } from './AboutTab'
import { AccountsTab } from './AccountsTab'
import { AppearanceTab } from './AppearanceTab'
import { ChatTab } from './ChatTab'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'chat', label: 'Chat' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'about', label: 'About' }
]

export function SettingsPanel() {
  const open = useSettingsStore((s) => s.panelOpen)
  const tab = useSettingsStore((s) => s.tab)
  const setTab = useSettingsStore((s) => s.setTab)
  const close = useSettingsStore((s) => s.closePanel)
  const closeButton = useRef<HTMLButtonElement>(null)

  // While open: focus the panel, close on Escape, and give focus back afterwards.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.() // runs when the panel closes
    }
  }, [open, close])

  if (!open) return null

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-head">
        <h2 id="settings-title" className="settings-title">
          Settings
        </h2>
        <button ref={closeButton} className="settings-close" onClick={close}>
          Close
        </button>
      </div>

      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={(e) => {
          // Left/right arrows move to the neighbouring tab (wrapping around at the ends).
          const i = TABS.findIndex((t) => t.id === tab)
          const next =
            e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length] : undefined
          if (!next) return
          e.preventDefault()
          setTab(next.id)
          document.getElementById(`settings-tab-${next.id}`)?.focus()
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`settings-tab-${t.id}`}
            className="settings-tab"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="settings-tabpanel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-body" role="tabpanel" id="settings-tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'chat' && <ChatTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}
