/**
 * renderer/src/store/modStore.ts   (which user the moderation panel is open for)
 *
 * WHAT: A tiny store: `target` is the person whose panel is open (or null). MessageRow calls `open` when a moderator
 * clicks a message; UserPanel reads it and calls `close`. The panel remembers which element had focus so it can give
 * focus back when it closes.
 */
import { create } from 'zustand'
import type { ModTarget } from '../lib/modpanel'

interface ModStore {
  target: ModTarget | null
  returnFocus: HTMLElement | null
  open: (target: ModTarget) => void
  close: () => void
}

export const useModStore = create<ModStore>((set) => ({
  target: null,
  returnFocus: null,
  open: (target) => set({ target, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null }),
  close: () => set({ target: null })
}))
