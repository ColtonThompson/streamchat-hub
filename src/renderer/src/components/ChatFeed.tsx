/**
 * renderer/src/components/ChatFeed.tsx   (the scrolling list of messages)
 *
 * WHAT: Shows the messages, with these jobs:
 *   1. FILTERING: hides messages from platforms that are switched off, event rows when "Show events"
 *      is off, and chat lines matching the user's blacklist (Settings -> Chat).
 *   2. SHADING: every other row gets a slightly lighter background so rows are easy to tell apart.
 *   3. DISPLAY OPTIONS: passes each row the timestamp style and the theme background (used to keep
 *      usernames readable).
 *   4. VIRTUALIZING: only the rows currently on screen exist in the page (react-virtuoso). Without
 *      this, thousands of rows (each with images) would make the app sluggish.
 *
 * Filtering never deletes anything: filtered messages stay in memory, so turning a filter off (or
 * removing a blacklist term) brings them straight back.
 *
 * SCROLLING: the list follows new messages until YOU scroll away (wheel up, swipe, Page Up/Home/Up,
 * dragging the scrollbar). Then it stops and shows a "Jump to latest" button; reaching the bottom again
 * or pressing the button resumes following. Content growing under you (emote images loading and rows
 * re-wrapping) never switches following off, because only user input does. See `followRef` below.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { parseChannels } from '../../../shared/channels'
import { compileBlacklist } from '../lib/blacklist'
import { buildRows, newShading, type ShadingMemory } from '../lib/rows'
import { THEMES } from '../lib/themes'
import { timeStyleOf } from '../lib/time'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { MessageRow } from './MessageRow'

export function ChatFeed() {
  const messages = useChatStore((s) => s.messages)
  const enabled = useChatStore((s) => s.enabled)
  const showEvents = useChatStore((s) => s.showEvents)
  const twitchChannels = useChatStore((s) => s.channels.twitch)
  const blacklist = useSettingsStore((s) => s.blacklist)
  const timestamps = useSettingsStore((s) => s.timestamps)
  const timestampSeconds = useSettingsStore((s) => s.timestampSeconds)
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme)
  // Your Twitch login, lowercased: lets rows give a stronger highlight to @mentions of you.
  const me = useChatStore((s) => s.auth.login)?.toLowerCase()

  // When several Twitch channels are listed, rows get a "#channel" tag so you can tell them apart.
  const multiChannel = useMemo(() => parseChannels(twitchChannels).length > 1, [twitchChannels])
  const timeStyle = timeStyleOf(timestamps, timestampSeconds)
  const themeBg = THEMES[resolvedTheme].vars['--bg']
  /** The test function for the current blacklist; rebuilt only when the list changes. */
  const isBlacklisted = useMemo(() => compileBlacklist(blacklist), [blacklist])

  const ref = useRef<VirtuosoHandle>(null)

  /**
   * FOLLOWING: should the list keep scrolling to the newest message?
   *
   * It starts true and is switched OFF only by something the USER does (wheel up, swipe, Page Up/Home/
   * Up-arrow, dragging the scrollbar away from the bottom). It switches back ON when they get back to
   * the bottom or press "Jump to latest".
   *
   * WHY NOT just ask Virtuoso "are we at the bottom?": rows grow AFTER they are drawn (an emote image
   * finishes loading and the line wraps onto a second line). A few of those in one batch push the real
   * bottom further away than `atBottomThreshold`, Virtuoso reports "not at the bottom", following turned
   * itself off, and the feed stopped tracking even though the user never scrolled. Now growth is simply
   * followed (see `totalListHeightChanged` below).
   *
   * `followRef` is the always-current value used by the scroll logic; `isFollowing` mirrors it as React
   * state only so the "Jump to latest" button appears and disappears.
   */
  const followRef = useRef(true)
  const [isFollowing, setIsFollowing] = useState(true)
  const setFollowing = useCallback((value: boolean) => {
    followRef.current = value
    setIsFollowing(value) // React ignores this when the value is unchanged, so calling it often is cheap
  }, [])

  const detachScroller = useRef<(() => void) | undefined>(undefined)
  /**
   * Virtuoso hands us its scrolling element (via `scrollerRef`). We listen on it for USER scrolling so we
   * can tell "the user moved away" apart from "the content grew". Called again with null on unmount,
   * which removes the listeners.
   */
  const attachScroller = useCallback(
    (el: HTMLElement | Window | null) => {
      detachScroller.current?.()
      detachScroller.current = undefined
      if (!(el instanceof HTMLElement)) return

      let dragging = false // is the user holding the scrollbar?
      let lastIntent = 0 // when the user last tried to scroll up (ms); used to ignore the scroll events it causes
      const leave = () => {
        lastIntent = performance.now()
        setFollowing(false)
      }
      const onWheel = (e: WheelEvent) => e.deltaY < 0 && leave() // wheel/trackpad scrolling UP
      const onTouchMove = () => leave()
      const onKey = (e: KeyboardEvent) => ['PageUp', 'ArrowUp', 'Home'].includes(e.key) && leave()
      // Pressing on the scrollbar itself (the target is the scroller, not a row) means dragging it.
      const onPointerDown = (e: PointerEvent) => {
        dragging = e.target === el
      }
      const onPointerUp = () => {
        dragging = false
      }
      const onScroll = () => {
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight // pixels left below the view
        if (dragging) setFollowing(gap <= 4)
        // Reached the very bottom by scrolling down: follow again. The 150 ms guard ignores the first
        // scroll events of an upward gesture, which can still be within a few pixels of the bottom.
        else if (gap <= 4 && performance.now() - lastIntent > 150) setFollowing(true)
      }

      el.addEventListener('wheel', onWheel, { passive: true })
      el.addEventListener('touchmove', onTouchMove, { passive: true })
      el.addEventListener('keydown', onKey)
      el.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('pointerup', onPointerUp)
      el.addEventListener('scroll', onScroll, { passive: true })
      detachScroller.current = () => {
        el.removeEventListener('wheel', onWheel)
        el.removeEventListener('touchmove', onTouchMove)
        el.removeEventListener('keydown', onKey)
        el.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('pointerup', onPointerUp)
        el.removeEventListener('scroll', onScroll)
      }
    },
    [setFollowing]
  )

  /** Remembers each message's shade between renders (why: see lib/rows.ts). */
  const shading = useRef<ShadingMemory>(newShading(blacklist))

  /** useMemo: recompute the row list only when its inputs change, not on every render. */
  const rows = useMemo(
    () => buildRows(messages, { enabled, showEvents, blacklist, isBlacklisted }, shading),
    [messages, enabled, showEvents, blacklist, isBlacklisted]
  )

  if (rows.length === 0) {
    // Two different reasons for an empty feed deserve two different messages.
    return messages.length > 0 ? (
      <div className="empty">
        <p className="empty-title">Nothing to show</p>
        <p>Your platform toggles, event filter or blacklist are hiding every message.</p>
      </div>
    ) : (
      <div className="empty">
        <p className="empty-title">No chat yet</p>
        <p>Turn on a platform above to start reading its chat here.</p>
      </div>
    )
  }

  return (
    <div className="feed">
      <Virtuoso
        ref={ref}
        data={rows}
        computeItemKey={(_, r) => r.msg.id} // stable keys let React reuse row components
        itemContent={(_, r) => (
          <MessageRow
            msg={r.msg}
            alt={r.alt}
            showChannel={r.msg.platform === 'twitch' && multiChannel}
            timeStyle={timeStyle}
            themeBg={themeBg}
            me={me}
          />
        )}
        scrollerRef={attachScroller}
        // Read the ref (not state) so the answer is never a render behind.
        followOutput={() => (followRef.current ? 'auto' : false)}
        // Virtuoso reaching the bottom is a reliable "resume" signal; "left the bottom" is ignored on
        // purpose, since it also fires when rows merely grow.
        atBottomStateChange={(atBottom) => atBottom && setFollowing(true)}
        atBottomThreshold={80}
        // Rows changed height (an image loaded, a line wrapped): if following, re-pin to the true bottom.
        totalListHeightChanged={() => {
          if (followRef.current) ref.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
        }}
        initialTopMostItemIndex={rows.length - 1}
      />
      {!isFollowing && (
        <button
          className="jump"
          onClick={() => {
            setFollowing(true)
            ref.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
          }}
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
