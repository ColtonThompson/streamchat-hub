/**
 * renderer/src/store/streamInfoStore.ts   (live status, title and viewers of the channels in the feed)
 *
 * WHAT: Holds the latest `StreamInfo` list pushed by the main process (main/streaminfo.ts), and keeps the main process told
 * WHICH channels to check: `useStreamInfoSync()` (called from App.tsx) sends every channel in the feed. It also turns
 * changes into notes in the chat ("#nightleaf went live: ...", "... went offline", "... changed the title: ...", see
 * lib/streaminfo.ts `streamChanges`), and asks for a fresh check whenever the window gets focus again.
 *
 * The Settings checkbox "Show stream title and viewer count" only decides whether the bar above the chat is drawn; the
 * checking itself always runs while there are channels, because the Channels menu and the notes need it.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { StreamInfo } from '../../../shared/types'
import { makeStreamNote } from '../lib/channelbreaks'
import { channelKey, streamChanges, watchTargets } from '../lib/streaminfo'
import { useChatStore } from './chatStore'

interface StreamInfoStore {
  infos: StreamInfo[]
}

export const useStreamInfoStore = create<StreamInfoStore>(() => ({ infos: [] }))

export function subscribeToStreamInfo(): () => void {
  return window.api.streamInfo.onChange((infos) => {
    const prev = useStreamInfoStore.getState().infos
    useStreamInfoStore.setState({ infos })
    const notes = streamChanges(prev, infos).map((c) => ({ kind: 'message' as const, message: makeStreamNote(c.info.platform, c.info.source, c.kind, c.info.title) }))
    if (notes.length) useChatStore.getState().addItems(notes)
  })
}

/** Tell the main process which channels to check, whenever the list changes; look again when the window is focused. */
export function useStreamInfoSync(): void {
  const channels = useChatStore((s) => s.channels)
  const targets = watchTargets(channels)
  const key = targets.map(channelKey).join('|')
  useEffect(() => {
    void window.api.streamInfo.watch(targets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    const again = () => void window.api.streamInfo.refresh()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])
}
