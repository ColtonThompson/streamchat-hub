/**
 * renderer/src/store/streamInfoStore.ts   (title and viewers of the one stream being read)
 *
 * WHAT: Holds the latest `StreamInfo` pushed by the main process (main/streaminfo.ts), and keeps the main process
 * told WHICH stream to follow: `useStreamInfoSync()` (called from App.tsx) works out the stream from the settings, the
 * channel list and the chosen title source (lib/streaminfo.ts) and sends it, or `null` when the setting is off or there
 * are no channels.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { StreamInfo } from '../../../shared/types'
import { streamInfoTarget } from '../lib/streaminfo'
import { useChatStore } from './chatStore'
import { useSettingsStore } from './settingsStore'

interface StreamInfoStore {
  info: StreamInfo | null
}

export const useStreamInfoStore = create<StreamInfoStore>(() => ({ info: null }))

export function subscribeToStreamInfo(): () => void {
  return window.api.streamInfo.onChange((info) => useStreamInfoStore.setState({ info }))
}

/** Tell the main process which single stream (if any) to follow, whenever that changes. */
export function useStreamInfoSync(): void {
  const show = useSettingsStore((s) => s.showStreamInfo)
  const channels = useChatStore((s) => s.channels)
  const titleSource = useChatStore((s) => s.titleSource)
  const target = streamInfoTarget(show, channels, titleSource)
  const key = target ? `${target.platform}:${target.source}` : ''
  useEffect(() => {
    void window.api.streamInfo.watch(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
