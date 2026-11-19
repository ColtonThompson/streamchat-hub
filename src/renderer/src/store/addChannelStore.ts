/**
 * renderer/src/store/addChannelStore.ts   (is the "Add channel" window open?)
 *
 * WHAT: A tiny store so more than one place can open the window: the "Add channel" button in the top bar and the
 * button in the empty feed. The window itself is components/AddChannelModal.tsx (rendered once, in App.tsx).
 */
import { create } from 'zustand'
import type { Platform } from '../../../shared/types'

interface AddChannelState {
  open: boolean
  /** Which platform is selected when it opens. */
  platform: Platform
  show: (platform?: Platform) => void
  hide: () => void
}

export const useAddChannelStore = create<AddChannelState>((set) => ({
  open: false,
  platform: 'twitch',
  show: (platform) => set((s) => ({ open: true, platform: platform ?? s.platform })),
  hide: () => set({ open: false })
}))
