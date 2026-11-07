/**
 * main/emotes/providers/index.ts
 *
 * WHAT: The list of emote providers EmoteService uses.
 *
 * PRIORITY: when two providers have an emote with the same name, the one EARLIER in this list wins.
 * Reorder it to change that. To add a provider, import it and add it to the array.
 */
import { bttv } from './bttv'
import { ffz } from './ffz'
import { sevenTv } from './seventv'

export const defaultProviders = [sevenTv, bttv, ffz]
